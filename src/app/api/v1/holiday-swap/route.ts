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
  NotFound,
} from "@/lib/guard";
import { RATE_RULES } from "@/lib/rate-limit";
import { logActivity } from "@/lib/audit/logger";
import { getSettings } from "@/lib/settings";
import { createApprovalInstance, cancelInstance, isUntouched } from "@/lib/approval/engine";
import { holidayMap } from "@/lib/hr/calendar";
import {
  formatDate,
  normalizeDateKey,
  wibDateKey,
  wibStartOfDay,
  inclusiveDayCount,
  isWeekendKey,
} from "@/lib/time";
import HolidaySwapRequest from "@/models/HolidaySwapRequest";
import NationalHoliday from "@/models/NationalHoliday";
import LeaveRequest from "@/models/LeaveRequest";
import ApprovalInstance from "@/models/ApprovalInstance";
import Employee from "@/models/Employee";

/**
 * Tukar libur — an employee volunteers to work a public holiday in exchange for
 * a different day off. Every constraint below is driven by CMS settings; none
 * of the thresholds are hardcoded.
 */

export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  if (!ctx.user.employeeId) return apiSuccess({ requests: [], holidays: [], rules: null });

  const settings = await getSettings();
  const todayKey = wibDateKey();
  const yearEnd = `${todayKey.slice(0, 4)}-12-31`;

  const { page, limit, skip } = pagination(req, 20, 100);
  const [requests, holidays, total] = await Promise.all([
    HolidaySwapRequest.find({ employeeId: ctx.user.employeeId })
      .populate("approvalInstanceId", "status currentStep stepsStatus")
      .sort({ holidayDate: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    NationalHoliday.find({
      isActive: true,
      type: "libur_nasional",
      dateKey: { $gte: todayKey, $lte: yearEnd },
    })
      .sort({ dateKey: 1 })
      .lean(),
    HolidaySwapRequest.countDocuments({ employeeId: ctx.user.employeeId }),
  ]);

  // Holidays already claimed are shown greyed out rather than omitted, so the
  // employee can see why they cannot pick them again.
  // Read from all active requests, not just the page being shown.
  const active = await HolidaySwapRequest.find({
    employeeId: ctx.user.employeeId,
    status: { $in: ["pending", "approved"] },
  })
    .select("holidayDate")
    .lean<Array<{ holidayDate: Date }>>();
  const claimed = new Set(active.map((r) => wibDateKey(new Date(r.holidayDate))));

  return apiSuccess(
    {
      requests,
      holidays: holidays.map((h) => ({ ...h, alreadyRequested: claimed.has(h.dateKey) })),
      rules: {
        leadDays: Number(settings.holiday_swap_lead_days),
        allowHalfDay: Boolean(settings.holiday_swap_allow_half_day),
        maxConsecutive: Number(settings.holiday_swap_max_consecutive),
        blockSameDivision: Boolean(settings.holiday_swap_block_same_division),
      },
    },
    "Berhasil memuat data tukar libur",
    { page, limit, total }
  );
});

const createSchema = z.object({
  holidayDate: z.string().min(8),
  replacementDate: z.string().min(8),
  isHalfDay: z.boolean().default(false),
  session: z.enum(["full", "morning", "afternoon"]).default("full"),
  reason: z.string().trim().max(500).optional(),
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireEmployee(req);
  enforceRateLimit("holiday-swap", ctx.employeeId, RATE_RULES.write);

  const body = await parseBody(req, createSchema);
  const settings = await getSettings();

  const holidayKey = normalizeDateKey(body.holidayDate);
  const replacementKey = normalizeDateKey(body.replacementDate);
  const todayKey = wibDateKey();

  /* --- the chosen day must really be a public holiday ---------------- */
  const holiday = await NationalHoliday.findOne({
    dateKey: holidayKey,
    isActive: true,
    type: "libur_nasional",
  }).lean<{ name: string } | null>();
  if (!holiday) {
    throw BadRequest(
      `${formatDate(holidayKey)} bukan hari libur nasional yang terdaftar, sehingga tidak dapat ditukar.`
    );
  }

  /* --- lead time ------------------------------------------------------ */
  const leadDays = inclusiveDayCount(todayKey, holidayKey) - 1;
  if (leadDays < 0) {
    throw BadRequest("Tanggal merah yang dipilih sudah lewat.");
  }
  const requiredLead = Number(settings.holiday_swap_lead_days);
  if (leadDays < requiredLead) {
    throw BadRequest(
      `Tukar libur harus diajukan minimal H-${requiredLead} sebelum tanggal merah. ` +
        `Pengajuan Anda baru H-${leadDays}.`
    );
  }

  /* --- replacement day sanity ---------------------------------------- */
  if (inclusiveDayCount(todayKey, replacementKey) - 1 < 0) {
    throw BadRequest("Tanggal pengganti harus di masa mendatang.");
  }
  if (isWeekendKey(replacementKey)) {
    throw BadRequest("Tanggal pengganti harus jatuh pada hari kerja, bukan akhir pekan.");
  }
  const replacementHoliday = await holidayMap(replacementKey, replacementKey);
  if (replacementHoliday.has(replacementKey)) {
    throw BadRequest(
      `${formatDate(replacementKey)} sudah merupakan hari libur (${replacementHoliday.get(replacementKey)?.name}), sehingga tidak dapat dipakai sebagai pengganti.`
    );
  }

  /* --- half day ------------------------------------------------------- */
  if (body.isHalfDay && !settings.holiday_swap_allow_half_day) {
    throw BadRequest("Tukar libur setengah hari sedang dinonaktifkan oleh HRD.");
  }

  /* --- one claim per holiday ------------------------------------------ */
  const existing = await HolidaySwapRequest.findOne({
    employeeId: ctx.employeeId,
    holidayDate: wibStartOfDay(holidayKey),
    status: { $in: ["pending", "approved"] },
  }).lean();
  if (existing) {
    throw Conflict(`Anda sudah mengajukan tukar libur untuk ${holiday.name} (${formatDate(holidayKey)}).`);
  }

  /* --- consecutive-holiday cap ---------------------------------------- */
  const maxConsecutive = Number(settings.holiday_swap_max_consecutive);
  if (maxConsecutive > 0) {
    const windowStart = new Date(wibStartOfDay(holidayKey).getTime() - 7 * 86400_000);
    const windowEnd = new Date(wibStartOfDay(holidayKey).getTime() + 7 * 86400_000);
    const nearby = await HolidaySwapRequest.countDocuments({
      employeeId: ctx.employeeId,
      status: { $in: ["pending", "approved"] },
      holidayDate: { $gte: windowStart, $lte: windowEnd },
    });
    if (nearby >= maxConsecutive) {
      throw Conflict(
        `Anda sudah menukar ${nearby} tanggal merah dalam rentang berdekatan. ` +
          `Batas yang berlaku adalah ${maxConsecutive} tanggal.`
      );
    }
  }

  /* --- division clash on the replacement day --------------------------- */
  const employee = await Employee.findById(ctx.employeeId).select("name divisionId").lean<{
    name: string;
    divisionId?: RecordId;
  } | null>();

  if (settings.holiday_swap_block_same_division && employee?.divisionId) {
    const colleagues = await Employee.find({
      divisionId: employee.divisionId,
      _id: { $ne: ctx.employeeId },
      status: "active",
    })
      .select("_id")
      .lean<Array<{ _id: RecordId }>>();

    if (colleagues.length) {
      const clash = await HolidaySwapRequest.findOne({
        employeeId: { $in: colleagues.map((c) => c._id) },
        replacementDate: wibStartOfDay(replacementKey),
        status: { $in: ["pending", "approved"] },
      }).lean();
      if (clash) {
        throw Conflict(
          `Rekan satu divisi sudah mengambil ${formatDate(replacementKey)} sebagai hari pengganti. ` +
            `Pilih tanggal lain agar divisi tidak kosong.`
        );
      }
    }
  }

  /* --- must not collide with an existing leave ------------------------- */
  const leaveClash = await LeaveRequest.findOne({
    employeeId: ctx.employeeId,
    status: { $in: ["pending", "approved"] },
    startDate: { $lte: wibStartOfDay(replacementKey) },
    endDate: { $gte: wibStartOfDay(replacementKey) },
  }).lean();
  if (leaveClash) {
    throw Conflict(`Anda sudah memiliki pengajuan cuti pada ${formatDate(replacementKey)}.`);
  }

  /* --- persist --------------------------------------------------------- */
  const request = await HolidaySwapRequest.create({
    employeeId: ctx.employeeId,
    holidayDate: wibStartOfDay(holidayKey),
    replacementDate: wibStartOfDay(replacementKey),
    isHalfDay: body.isHalfDay,
    session: body.isHalfDay ? body.session : "full",
    reason: body.reason?.trim() ?? "",
    status: "pending",
  });

  const summary = `Masuk pada ${holiday.name} (${formatDate(holidayKey)}), libur pengganti ${formatDate(replacementKey)}`;
  const instanceId = await createApprovalInstance({
    refType: "holiday_swap",
    refId: request._id as RecordId,
    employeeId: ctx.employeeId,
    submitterUserId: ctx.user.id,
    summary,
  });
  request.approvalInstanceId = instanceId;
  await request.save();

  void logActivity({
    userId: ctx.user.id,
    action: "CREATE_HOLIDAY_SWAP",
    module: "holiday_swap",
    after: { holidayKey, replacementKey, isHalfDay: body.isHalfDay },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    request.toObject(),
    `Pengajuan tukar libur terkirim. Ingat: hak libur pengganti hanya berlaku bila Anda benar-benar absen masuk pada ${formatDate(holidayKey)}.`,
    undefined,
    201
  );
});

export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await requireEmployee(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw BadRequest("ID pengajuan wajib disertakan.");

  const request = await HolidaySwapRequest.findOne({ _id: id, employeeId: ctx.employeeId });
  if (!request) throw NotFound("Pengajuan tukar libur tidak ditemukan.");
  if (request.status !== "pending") {
    throw Conflict("Hanya pengajuan berstatus menunggu yang dapat dibatalkan.");
  }

  if (request.approvalInstanceId) {
    const instance = await ApprovalInstance.findById(request.approvalInstanceId).lean<{
      stepsStatus: Array<{ status: string }>;
    } | null>();
    if (instance && !isUntouched(instance)) {
      throw Conflict("Pengajuan sudah diproses approver dan tidak dapat dibatalkan sendiri.");
    }
    await cancelInstance(request.approvalInstanceId, ctx.user.id);
  }

  request.status = "cancelled";
  await request.save();

  return apiSuccess({ id }, "Pengajuan tukar libur dibatalkan.");
});
