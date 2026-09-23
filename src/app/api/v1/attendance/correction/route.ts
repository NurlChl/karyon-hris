import { RecordId } from "@/lib/postgres";
import { z } from "zod";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import {
  requireUser,
  requireEmployee,
  parseBody,
  enforceRateLimit,
  BadRequest,
  Conflict,
  Forbidden,
  NotFound,
  employeeRecordScopeFilter,
} from "@/lib/guard";
import { checkPermission } from "@/lib/rbac";
import { RATE_RULES } from "@/lib/rate-limit";
import { logActivity } from "@/lib/audit/logger";
import { getSettings } from "@/lib/settings";
import { attachmentInputSchema } from "@/lib/attachments";
import { resolveSingleAttachment } from "@/lib/uploads";
import ApprovalFlow from "@/models/ApprovalFlow";
import ApprovalInstance from "@/models/ApprovalInstance";
import AttendanceCorrection from "@/models/AttendanceCorrection";
import Employee from "@/models/Employee";
import {
  formatDate,
  normalizeDateKey,
  wibDateKey,
  wibStartOfDay,
  wibStartOfMonth,
  wibEndOfMonth,
  inclusiveDayCount,
} from "@/lib/time";
import { notifyUsers, resolveRecipientsByRole } from "@/lib/notification/notify";
import { CORRECTION_REASON_LABELS } from "@/lib/hr/labels";

/* ------------------------------------------------------------------ */
/* GET                                                                  */
/* ------------------------------------------------------------------ */

export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const url = new URL(req.url);
  const wantsAll = url.searchParams.get("scope") === "all";
  const employeeFilter = url.searchParams.get("employeeId");

  let filter: Record<string, unknown>;

  if (wantsAll || employeeFilter) {
    const perm = await checkPermission(ctx.user.id, "attendance", "read");
    if (!perm.allowed) throw Forbidden("Anda tidak memiliki izin membaca koreksi absen karyawan lain.");
    filter = { ...(await employeeRecordScopeFilter({ ...ctx, permission: perm })) };
    if (employeeFilter) filter.$and = [{ employeeId: employeeFilter }];
  } else {
    // The previous version resolved the employee by matching the login email
    // against `officeEmail`, which silently failed for every account whose
    // login address differed. The session already carries the employee id.
    if (!ctx.user.employeeId) return apiSuccess({ corrections: [], quota: null });
    filter = { employeeId: ctx.user.employeeId };
  }

  const corrections = await AttendanceCorrection.find(filter)
    .populate("employeeId", "name employeeId")
    .populate("approvalInstanceId", "status currentStep stepsStatus")
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  let quota: { used: number; max: number; remaining: number } | null = null;
  if (ctx.user.employeeId) {
    quota = await quotaFor(ctx.user.employeeId, wibDateKey());
  }

  return apiSuccess({ corrections, quota }, "Berhasil memuat data koreksi absensi");
});

async function quotaFor(employeeId: string, dayKey: string) {
  const settings = await getSettings();
  const max = Number(settings.max_absen_correction);
  const used = await AttendanceCorrection.countDocuments({
    employeeId,
    date: { $gte: wibStartOfMonth(dayKey.slice(0, 7)), $lte: wibEndOfMonth(dayKey.slice(0, 7)) },
    status: { $in: ["pending", "approved"] },
  });
  return { used, max, remaining: Math.max(0, max - used) };
}

/* ------------------------------------------------------------------ */
/* POST                                                                 */
/* ------------------------------------------------------------------ */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format jam harus HH:MM");

const createSchema = z
  .object({
    date: z.string().min(8),
    clockInTime: hhmm,
    clockOutTime: hhmm,
    breakOutTime: hhmm.optional().or(z.literal("")),
    breakInTime: hhmm.optional().or(z.literal("")),
    reasonType: z.enum(["lupa_tap", "kendala_aplikasi", "dinas_luar", "lainnya"]),
    reasonNote: z
      .string()
      .trim()
      .min(15, "Jelaskan alasan minimal 15 karakter agar approver dapat menilai")
      .max(1000),
    evidence: z.string().optional(),
    attachment: attachmentInputSchema.optional(),
  })
  .refine((v) => v.clockOutTime > v.clockInTime, {
    message: "Jam pulang harus lebih besar dari jam masuk",
    path: ["clockOutTime"],
  });

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireEmployee(req);
  enforceRateLimit("correction-create", ctx.employeeId, RATE_RULES.write);

  const body = await parseBody(req, createSchema);
  const settings = await getSettings();

  const dayKey = normalizeDateKey(body.date);
  const todayKey = wibDateKey();

  /* --- date window -------------------------------------------------- */
  const daysAgo = inclusiveDayCount(dayKey, todayKey) - 1;
  if (daysAgo < 0) {
    throw BadRequest("Koreksi absen hanya untuk tanggal yang sudah lewat atau hari ini.");
  }
  const maxBackdate = Number(settings.correction_max_backdate_days);
  if (daysAgo > maxBackdate) {
    throw BadRequest(
      `Koreksi absen hanya dapat diajukan untuk ${maxBackdate} hari terakhir. Tanggal ${formatDate(dayKey)} sudah ${daysAgo} hari lalu.`
    );
  }

  /* --- one active request per day ----------------------------------- */
  const duplicate = await AttendanceCorrection.findOne({
    employeeId: ctx.employeeId,
    date: wibStartOfDay(dayKey),
    status: { $in: ["pending", "approved"] },
  }).lean<{ status: string } | null>();
  if (duplicate) {
    throw Conflict(
      `Anda sudah memiliki pengajuan koreksi ${duplicate.status === "approved" ? "yang disetujui" : "yang menunggu persetujuan"} untuk tanggal ${formatDate(dayKey)}.`
    );
  }

  /* --- quota, and the escalated flow when it is exceeded -------------- */
  const quota = await quotaFor(ctx.employeeId, dayKey);
  const overQuota = quota.used >= quota.max;

  // Over-quota requests do not get auto-rejected outright; per the spec they
  // escalate to HRD -> Audit -> Direksi so a genuine emergency still has a path.
  const configuredFlow = await ApprovalFlow.findOne({ transactionType: "correction" }).lean<{
    steps?: Array<{ stepNumber: number; approverRole: string }>;
  } | null>();

  const steps = overQuota
    ? [
        { stepNumber: 1, approverRole: "HRD", status: "pending" },
        { stepNumber: 2, approverRole: "AUDIT", status: "pending" },
        { stepNumber: 3, approverRole: "DIREKSI", status: "pending" },
      ]
    : (configuredFlow?.steps?.length
        ? configuredFlow.steps
        : [
            { stepNumber: 1, approverRole: "SPV" },
            { stepNumber: 2, approverRole: "HRD" },
          ]
      )
        .slice()
        .sort((a, b) => a.stepNumber - b.stepNumber)
        .map((s) => ({ stepNumber: s.stepNumber, approverRole: s.approverRole, status: "pending" }));

  /* --- evidence ------------------------------------------------------ */
  let evidenceKey = "";
  evidenceKey = await resolveSingleAttachment({
    input: body.attachment,
    legacyDataUrl: body.evidence,
    context: "correction",
    ownerUserId: ctx.user.id,
    destination: `corrections/${ctx.employeeId}`,
  });

  const correction = await AttendanceCorrection.create({
    employeeId: ctx.employeeId,
    date: wibStartOfDay(dayKey),
    clockInTime: body.clockInTime,
    clockOutTime: body.clockOutTime,
    breakOutTime: body.breakOutTime || undefined,
    breakInTime: body.breakInTime || undefined,
    reasonType: body.reasonType,
    reasonNote: body.reasonNote.trim(),
    evidenceUrl: evidenceKey,
    isOverQuota: overQuota,
    status: "pending",
  });

  const summary =
    `Koreksi absen ${formatDate(dayKey)} menjadi ${body.clockInTime}–${body.clockOutTime}` +
    ` (${CORRECTION_REASON_LABELS[body.reasonType]})`;

  const instance = await ApprovalInstance.create({
    refType: "correction",
    refId: correction._id,
    currentStep: steps[0].stepNumber,
    status: "pending",
    stepsStatus: steps,
    history: [
      {
        action: "SUBMITTED",
        userId: ctx.user.id,
        timestamp: new Date(),
        comment: overQuota
          ? `Melebihi kuota bulanan (${quota.used}/${quota.max}) — memerlukan persetujuan darurat HRD → Audit → Direksi.`
          : `${summary} (kuota ${quota.used + 1}/${quota.max}).`,
      },
    ],
  });

  correction.approvalInstanceId = instance._id as RecordId;
  await correction.save();

  const employee = await Employee.findById(ctx.employeeId).select("name divisionId").lean<{
    name: string;
    divisionId?: RecordId;
  } | null>();

  const recipients = await resolveRecipientsByRole(steps[0].approverRole, {
    divisionId: steps[0].approverRole === "SPV" ? employee?.divisionId?.toString() ?? null : null,
  });
  await notifyUsers(recipients, {
    kind: "approval_request",
    title: "Persetujuan dibutuhkan: Koreksi Absen",
    body: `${employee?.name ?? "Karyawan"} — ${summary}`,
    href: "/admin/approvals",
    refType: "correction",
    refId: instance._id as RecordId,
  });

  void logActivity({
    userId: ctx.user.id,
    action: "CREATE_ATTENDANCE_CORRECTION",
    module: "attendance",
    after: { dayKey, overQuota, reasonType: body.reasonType },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { correction: correction.toObject(), quota: { ...quota, used: quota.used + 1 } },
    overQuota
      ? `Pengajuan terkirim, namun kuota koreksi bulan ini sudah terpakai ${quota.used}/${quota.max}. ` +
          `Pengajuan diarahkan ke persetujuan berlapis HRD → Audit → Direksi.`
      : `Pengajuan koreksi absen terkirim (kuota terpakai ${quota.used + 1}/${quota.max}).`,
    undefined,
    201
  );
});

/* ------------------------------------------------------------------ */
/* DELETE — withdraw                                                    */
/* ------------------------------------------------------------------ */

export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await requireEmployee(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw BadRequest("ID pengajuan wajib disertakan.");

  const correction = await AttendanceCorrection.findOne({ _id: id, employeeId: ctx.employeeId });
  if (!correction) throw NotFound("Pengajuan koreksi tidak ditemukan.");
  if (correction.status !== "pending") {
    throw Conflict("Hanya pengajuan berstatus menunggu yang dapat dibatalkan.");
  }

  if (correction.approvalInstanceId) {
    const instance = await ApprovalInstance.findById(correction.approvalInstanceId);
    if (instance && instance.stepsStatus.some((s: { status: string }) => s.status !== "pending")) {
      throw Conflict("Pengajuan sudah mulai diproses approver dan tidak dapat dibatalkan sendiri.");
    }
    if (instance) {
      instance.status = "rejected";
      instance.history.push({
        action: "CANCELLED",
        userId: ctx.user.id,
        timestamp: new Date(),
        comment: "Dibatalkan oleh pemohon",
      });
      await instance.save();
    }
  }

  correction.status = "cancelled";
  await correction.save();

  return apiSuccess({ id }, "Pengajuan koreksi absen dibatalkan.");
});
