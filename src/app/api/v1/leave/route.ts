import { RecordId } from "@/lib/postgres";
import { z } from "zod";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import {
  requireUser,
  requireEmployee,
  parseBody,
  pagination,
  enforceRateLimit,
  BadRequest,
  Conflict,
  Forbidden,
  NotFound,
} from "@/lib/guard";
import { RATE_RULES } from "@/lib/rate-limit";
import { logActivity } from "@/lib/audit/logger";
import { getSettings } from "@/lib/settings";
import { countLeaveDays } from "@/lib/hr/calendar";
import { createApprovalInstance, cancelInstance, isUntouched } from "@/lib/approval/engine";
import {
  formatDate,
  normalizeDateKey,
  wibDateKey,
  wibStartOfDay,
  wibEndOfDay,
  inclusiveDayCount,
} from "@/lib/time";
import { attachmentInputSchema } from "@/lib/attachments";
import { attachmentRefHref, resolveSingleAttachment } from "@/lib/uploads";
import { describeQuota, perRequestLimit, quotaModeOf } from "@/lib/hr/leave-policy";
import LeaveType from "@/models/LeaveType";
import LeaveBalance from "@/models/LeaveBalance";
import LeaveRequest from "@/models/LeaveRequest";
import ApprovalInstance from "@/models/ApprovalInstance";
import Employee from "@/models/Employee";

/* ------------------------------------------------------------------ */
/* GET                                                                  */
/* ------------------------------------------------------------------ */

export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const type = new URL(req.url).searchParams.get("type") ?? "balance";

  if (type === "types") {
    const employee = ctx.user.employeeId
      ? await Employee.findById(ctx.user.employeeId).select("gender").lean<{ gender?: string } | null>()
      : null;

    const query: Record<string, unknown> = { isActive: { $ne: false } };
    if (employee?.gender) {
      // Maternity/paternity types are filtered out rather than shown and then
      // rejected on submit.
      query.$or = [{ genderRestriction: "any" }, { genderRestriction: employee.gender }];
    }
    const leaveTypes = await LeaveType.find(query).sort({ sortOrder: 1, name: 1 }).lean<Array<Record<string, unknown>>>();
    // The rule is sent already worded, so the portal and the API never disagree
    // about what "3 hari" means.
    const year = new Date().getFullYear();
    const used = ctx.user.employeeId
      ? await LeaveRequest.aggregate<{ _id: RecordId; n: number }>([
          {
            $match: {
              employeeId: new RecordId(ctx.user.employeeId),
              status: { $in: ["pending", "approved"] },
              startDate: { $gte: wibStartOfDay(`${year}-01-01`), $lte: wibEndOfDay(`${year}-12-31`) },
            },
          },
          { $group: { _id: "$leaveTypeId", n: { $sum: 1 } } },
        ])
      : [];
    const usedBy = new Map(used.map((u) => [String(u._id), u.n]));
    return apiSuccess(
      leaveTypes.map((t) => ({
        ...t,
        quotaMode: quotaModeOf(t as never),
        rule: describeQuota(t as never),
        eventsThisYear: usedBy.get(String(t._id)) ?? 0,
      })),
      "Berhasil memuat jenis izin/cuti"
    );
    return apiSuccess(leaveTypes, "Berhasil memuat jenis izin/cuti");
  }

  if (!ctx.user.employeeId) {
    return apiSuccess({ balances: [], history: [] }, "Akun ini tidak tertaut ke data karyawan");
  }

  const year = new Date().getFullYear();
  const balances = await ensureBalances(ctx.user.employeeId, year);

  const { page, limit, skip } = pagination(req, 20, 100);
  const [history, historyTotal] = await Promise.all([
    LeaveRequest.find({ employeeId: ctx.user.employeeId })
      .populate("leaveTypeId", "name colorTone")
      .populate({ path: "approvalInstanceId", select: "status currentStep stepsStatus" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    LeaveRequest.countDocuments({ employeeId: ctx.user.employeeId }),
  ]);
  const pendingCount = await LeaveRequest.countDocuments({ employeeId: ctx.user.employeeId, status: "pending" });

  // Stored keys are not openable URLs; each attachment gets a signed link.
  const withLinks = await Promise.all(
    history.map(async (h) => ({ ...h, evidenceUrl: await attachmentRefHref(h.evidenceUrl as string | undefined) }))
  );

  return apiSuccess({ balances, history: withLinks, year, pendingCount }, "Berhasil memuat data cuti", { page, limit, total: historyTotal });
});

/**
 * Creates any missing balance rows for the year.
 *
 * Prorata types are allocated in proportion to the months remaining after the
 * join date, which is what the spec asks for and what the previous version
 * ignored (it always granted the full annual quota).
 */
async function ensureBalances(employeeId: string, year: number) {
  const [allTypes, employee] = await Promise.all([
    LeaveType.find({ isActive: { $ne: false } }).lean<
      Array<{ _id: RecordId; name: string; quotaDays: number; accrualMode: string; deductsBalance: boolean; quotaMode?: "annual" | "per_event" | "none" }>
    >(),
    Employee.findById(employeeId).select("joinDate").lean<{ joinDate?: Date } | null>(),
  ]);

  // Only yearly-balance types have a balance. A per-occurrence type showing
  // "3 of 3 days left" invited exactly the misreading this rule set removes.
  const types = allTypes.filter((t) => quotaModeOf(t) === "annual");

  const existing = await LeaveBalance.find({ employeeId, year }).lean<
    Array<{ leaveTypeId: RecordId }>
  >();
  const have = new Set(existing.map((b) => b.leaveTypeId.toString()));

  const missing = types.filter((t) => !have.has(t._id.toString()));
  if (missing.length) {
    const joinDate = employee?.joinDate ? new Date(employee.joinDate) : null;
    const joinedThisYear = joinDate && joinDate.getFullYear() === year;

    await LeaveBalance.insertMany(
      missing.map((t) => {
        let allocated = t.quotaDays;
        if (t.accrualMode === "prorata" && joinedThisYear && joinDate) {
          const remainingMonths = 12 - joinDate.getMonth();
          allocated = Math.floor((t.quotaDays * remainingMonths) / 12);
        }
        return {
          employeeId,
          leaveTypeId: t._id,
          year,
          allocatedDays: allocated,
          remainingDays: allocated,
          usedDays: 0,
          pendingDays: 0,
        };
      }),
      { ordered: false }
    ).catch(() => {
      /* a concurrent request may have inserted the same rows — harmless */
    });
  }

  return LeaveBalance.find({ employeeId, year }).populate("leaveTypeId").lean();
}

/* ------------------------------------------------------------------ */
/* POST — submit a request                                              */
/* ------------------------------------------------------------------ */

const createSchema = z.object({
  leaveTypeId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Jenis cuti tidak valid"),
  startDate: z.string().min(8),
  endDate: z.string().min(8),
  reason: z.string().trim().min(10, "Alasan minimal 10 karakter agar approver dapat menilai").max(1000),
  /** Uploaded file token or pasted link, from the shared upload flow. */
  attachment: attachmentInputSchema.optional(),
  /** Inline data URL; still accepted from older app versions. */
  evidence: z.string().optional(),
  /** Required for an "other" type: what the leave is for. */
  customPurpose: z.string().trim().max(120).optional(),
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireEmployee(req);
  enforceRateLimit("leave-create", ctx.employeeId, RATE_RULES.write);

  const body = await parseBody(req, createSchema);
  const settings = await getSettings();

  const startKey = normalizeDateKey(body.startDate);
  const endKey = normalizeDateKey(body.endDate);
  if (inclusiveDayCount(startKey, endKey) < 1) {
    throw BadRequest("Tanggal selesai tidak boleh lebih awal dari tanggal mulai.");
  }

  const leaveType = await LeaveType.findById(body.leaveTypeId);
  if (!leaveType || leaveType.isActive === false) {
    throw NotFound("Jenis izin/cuti tidak ditemukan atau sedang dinonaktifkan.");
  }

  const employee = await Employee.findById(ctx.employeeId).select("gender name divisionId");
  if (!employee) throw NotFound("Data karyawan tidak ditemukan.");

  if (leaveType.genderRestriction !== "any" && employee.gender !== leaveType.genderRestriction) {
    throw Forbidden(`Jenis "${leaveType.name}" tidak tersedia untuk profil Anda.`);
  }

  /* --- lead time ---------------------------------------------------- */
  const todayKey = wibDateKey();
  const leadDays = inclusiveDayCount(todayKey, startKey) - 1;
  if (leadDays < leaveType.minLeadDays) {
    throw BadRequest(
      `"${leaveType.name}" harus diajukan minimal H-${leaveType.minLeadDays} sebelum tanggal mulai. ` +
        `Pengajuan Anda baru H-${Math.max(0, leadDays)}.`
    );
  }

  /* --- duration ----------------------------------------------------- */
  const breakdown = await countLeaveDays(startKey, endKey);
  if (breakdown.chargedDays < 1) {
    throw BadRequest(
      "Rentang tanggal yang dipilih seluruhnya jatuh pada akhir pekan atau hari libur nasional, sehingga tidak perlu mengajukan cuti."
    );
  }
  const quotaMode = quotaModeOf(leaveType);
  const limit = perRequestLimit(leaveType);
  if (limit > 0 && breakdown.chargedDays > limit) {
    throw BadRequest(
      quotaMode === "per_event"
        ? `"${leaveType.name}" maksimal ${limit} hari setiap kali terjadi. Anda mengajukan ${breakdown.chargedDays} hari. ` +
            "Bila peristiwanya terjadi lagi di lain waktu, ajukan sebagai pengajuan terpisah."
        : `"${leaveType.name}" maksimal ${limit} hari per pengajuan. Anda mengajukan ${breakdown.chargedDays} hari.`
    );
  }

  if (quotaMode === "per_event" && leaveType.maxEventsPerYear > 0) {
    const year = Number(startKey.slice(0, 4));
    const taken = await LeaveRequest.countDocuments({
      employeeId: ctx.employeeId,
      leaveTypeId: leaveType._id,
      status: { $in: ["pending", "approved"] },
      startDate: { $gte: wibStartOfDay(`${year}-01-01`), $lte: wibEndOfDay(`${year}-12-31`) },
    });
    if (taken >= leaveType.maxEventsPerYear) {
      throw Conflict(
        `"${leaveType.name}" dapat diajukan ${leaveType.maxEventsPerYear} kali per tahun dan sudah terpakai ${taken} kali di ${year}. ` +
          "Hubungi HRD bila ada keadaan khusus."
      );
    }
  }

  if (leaveType.isOther && (body.customPurpose ?? "").length < 3) {
    throw BadRequest("Tuliskan keperluan izin Anda, misalnya \"Mengurus dokumen kependudukan\".");
  }

  /* --- overlap ------------------------------------------------------ */
  if (!settings.leave_allow_overlap) {
    const clash = await LeaveRequest.findOne({
      employeeId: ctx.employeeId,
      status: { $in: ["pending", "approved"] },
      startDate: { $lte: wibEndOfDay(endKey) },
      endDate: { $gte: wibStartOfDay(startKey) },
    })
      .populate("leaveTypeId", "name")
      .lean<{ startDate: Date; endDate: Date; leaveTypeId?: { name?: string } } | null>();

    if (clash) {
      throw Conflict(
        `Tanggal ini beririsan dengan pengajuan "${clash.leaveTypeId?.name ?? "cuti"}" Anda ` +
          `(${formatDate(clash.startDate)} – ${formatDate(clash.endDate)}). Batalkan dulu pengajuan tersebut.`
      );
    }
  }

  /* --- evidence ----------------------------------------------------- */
  let evidenceKey = "";
  const evidenceThreshold = Number(settings.leave_evidence_min_days);
  const evidenceRequired =
    leaveType.requiresEvidence && breakdown.chargedDays >= evidenceThreshold;

  if (evidenceRequired && !body.evidence && !body.attachment) {
    throw BadRequest(
      `"${leaveType.name}" dengan durasi ${breakdown.chargedDays} hari wajib melampirkan bukti (misalnya surat dokter).`
    );
  }
  evidenceKey = await resolveSingleAttachment({
    input: body.attachment,
    legacyDataUrl: body.evidence,
    context: "leave",
    ownerUserId: ctx.user.id,
    destination: `leaves/${ctx.employeeId}`,
  });

  /* --- balance ------------------------------------------------------ */
  const year = Number(startKey.slice(0, 4));
  await ensureBalances(ctx.employeeId, year);

  let balance = null;
  if (quotaMode === "annual") {
    // A conditional update is the atomic reservation: it only succeeds when the
    // balance is still sufficient, so two concurrent submissions cannot both
    // spend the last day.
    balance = await LeaveBalance.findOneAndUpdate(
      {
        employeeId: ctx.employeeId,
        leaveTypeId: leaveType._id,
        year,
        remainingDays: { $gte: breakdown.chargedDays },
      },
      { $inc: { remainingDays: -breakdown.chargedDays, pendingDays: breakdown.chargedDays } },
      { new: true }
    );

    if (!balance) {
      const current = await LeaveBalance.findOne({
        employeeId: ctx.employeeId,
        leaveTypeId: leaveType._id,
        year,
      }).lean<{ remainingDays: number } | null>();
      throw Conflict(
        `Saldo "${leaveType.name}" tidak mencukupi. Sisa saldo Anda ${current?.remainingDays ?? 0} hari, ` +
          `sedangkan pengajuan ini memerlukan ${breakdown.chargedDays} hari kerja.`
      );
    }
  }

  /* --- persist + route to approvers --------------------------------- */
  let leaveReq;
  try {
    leaveReq = await LeaveRequest.create({
      employeeId: ctx.employeeId,
      leaveTypeId: leaveType._id,
      startDate: wibStartOfDay(startKey),
      endDate: wibStartOfDay(endKey),
      chargedDays: breakdown.chargedDays,
      calendarDays: breakdown.calendarDays,
      reason: body.reason.trim(),
      customPurpose: leaveType.isOther ? body.customPurpose : "",
      evidenceUrl: evidenceKey,
      status: "pending",
    });

    const typeLabel = leaveType.isOther && body.customPurpose ? `${leaveType.name}: ${body.customPurpose}` : leaveType.name;
    const summary = `${typeLabel} ${formatDate(startKey)} – ${formatDate(endKey)} (${breakdown.chargedDays} hari)`;
    const instanceId = await createApprovalInstance({
      refType: "leave",
      refId: leaveReq._id as RecordId,
      employeeId: ctx.employeeId,
      submitterUserId: ctx.user.id,
      summary,
    });

    leaveReq.approvalInstanceId = instanceId;
    await leaveReq.save();
  } catch (err) {
    // Never leave the balance reserved for a request that failed to be created.
    if (balance) {
      await LeaveBalance.updateOne(
        { _id: balance._id },
        { $inc: { remainingDays: breakdown.chargedDays, pendingDays: -breakdown.chargedDays } }
      );
    }
    throw err;
  }

  void logActivity({
    userId: ctx.user.id,
    action: "CREATE_LEAVE_REQUEST",
    module: "leave",
    after: {
      leaveType: leaveType.name,
      startKey,
      endKey,
      chargedDays: breakdown.chargedDays,
    },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  const skippedNote = breakdown.skipped.length
    ? ` ${breakdown.skipped.length} hari tidak dipotong (akhir pekan/libur nasional).`
    : "";

  return apiSuccess(
    { request: leaveReq.toObject(), breakdown },
    `Pengajuan ${leaveType.name} sebanyak ${breakdown.chargedDays} hari terkirim dan menunggu persetujuan.${skippedNote}`,
    undefined,
    201
  );
});

/* ------------------------------------------------------------------ */
/* DELETE — withdraw a request that nobody has actioned yet             */
/* ------------------------------------------------------------------ */

export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await requireEmployee(req);
  const settings = await getSettings();
  if (!settings.leave_allow_cancel_pending) {
    throw Forbidden("Pembatalan pengajuan mandiri sedang dinonaktifkan oleh HRD.");
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw BadRequest("ID pengajuan wajib disertakan.");

  const leaveReq = await LeaveRequest.findOne({ _id: id, employeeId: ctx.employeeId });
  if (!leaveReq) throw NotFound("Pengajuan tidak ditemukan.");
  if (leaveReq.status !== "pending") {
    throw Conflict("Hanya pengajuan berstatus menunggu yang dapat dibatalkan.");
  }

  if (leaveReq.approvalInstanceId) {
    const instance = await ApprovalInstance.findById(leaveReq.approvalInstanceId).lean<{
      stepsStatus: Array<{ status: string }>;
    } | null>();
    if (instance && !isUntouched(instance)) {
      throw Conflict(
        "Pengajuan sudah mulai diproses approver, sehingga tidak dapat dibatalkan sendiri. Hubungi HRD."
      );
    }
    await cancelInstance(leaveReq.approvalInstanceId, ctx.user.id);
  }

  leaveReq.status = "cancelled";
  await leaveReq.save();

  const leaveType = await LeaveType.findById(leaveReq.leaveTypeId).lean<{ deductsBalance?: boolean; quotaMode?: "annual" | "per_event" | "none"; quotaDays: number } | null>();
  if (!leaveType || quotaModeOf(leaveType) === "annual") {
    await LeaveBalance.updateOne(
      {
        employeeId: ctx.employeeId,
        leaveTypeId: leaveReq.leaveTypeId,
        year: new Date(leaveReq.startDate).getFullYear(),
      },
      {
        $inc: {
          remainingDays: leaveReq.chargedDays ?? 0,
          pendingDays: -(leaveReq.chargedDays ?? 0),
        },
      }
    );
  }

  void logActivity({
    userId: ctx.user.id,
    action: "CANCEL_LEAVE_REQUEST",
    module: "leave",
    after: { id },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess({ id }, "Pengajuan dibatalkan dan saldo cuti Anda dikembalikan.");
});
