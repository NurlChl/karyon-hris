import { RecordId } from "@/lib/postgres";
import { z } from "zod";
import { quotaModeOf } from "@/lib/hr/leave-policy";
import { attachmentRefHref } from "@/lib/uploads";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireUser, parseBody, pagination, BadRequest, NotFound, Forbidden } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { decide, type RefType, REF_TYPE_LABEL } from "@/lib/approval/engine";
import { formatDate, wibStartOfDay, wibTimeOnDay } from "@/lib/time";
import ApprovalInstance from "@/models/ApprovalInstance";
import LeaveRequest from "@/models/LeaveRequest";
import LeaveType from "@/models/LeaveType";
import LeaveBalance from "@/models/LeaveBalance";
import Attendance from "@/models/Attendance";
import AttendanceCorrection from "@/models/AttendanceCorrection";
import HolidaySwapRequest from "@/models/HolidaySwapRequest";
import Employee from "@/models/Employee";
import { CORRECTION_REASON_LABELS } from "@/lib/hr/labels";

/* ------------------------------------------------------------------ */
/* GET — the approver's queue                                           */
/* ------------------------------------------------------------------ */

export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "inbox"; // inbox | history

  const roles = ctx.user.role === "SUPERADMIN" ? null : [ctx.user.role];

  // Both views are limited to requests the caller's role takes part in. The
  // history view used to filter on status alone, so any signed-in employee
  // could list every decided request in the company — leave reasons, signed
  // links to evidence such as medical letters, and now face photos.
  const filter: Record<string, unknown> =
    view === "history"
      ? {
          status: { $in: ["approved", "rejected"] },
          ...(roles ? { stepsStatus: { $elemMatch: { approverRole: { $in: roles } } } } : {}),
        }
      : {
          status: "pending",
          ...(roles
            ? { stepsStatus: { $elemMatch: { status: "pending", approverRole: { $in: roles } } } }
            : {}),
        };

  // A supervisor's queue is their division's; instances that carry the
  // division are narrowed in the query, older ones are checked below.
  if (ctx.user.role === "SPV" && ctx.user.divisionId) {
    filter.$or = [{ divisionId: new RecordId(ctx.user.divisionId) }, { divisionId: null }];
  }

  const { page, limit, skip } = pagination(req, 25, 100);
  filter.refType = { $ne: "face_change" };
  const total = await ApprovalInstance.countDocuments(filter);
  const instances = await ApprovalInstance.find(filter)
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean<
      Array<{
        _id: RecordId;
        refType: string;
        refId: RecordId;
        currentStep: number;
        status: string;
        stepsStatus: Array<{ stepNumber: number; approverRole: string; status: string; comment?: string; actionedAt?: Date }>;
        history: Array<{ action: string; comment?: string; timestamp: Date }>;
        createdAt: Date;
        updatedAt: Date;
      }>
    >();

  // Batch-load each referenced request type once instead of querying per row —
  // the previous implementation issued two queries inside the loop (N+1).
  const byType: Record<string, RecordId[]> = {};
  for (const inst of instances) (byType[inst.refType] ??= []).push(inst.refId);

  const [leaves, corrections, swaps, faceChanges] = await Promise.all([
    byType.leave?.length
      ? LeaveRequest.find({ _id: { $in: byType.leave } })
          .populate("employeeId", "name employeeId divisionId branchId")
          .populate("leaveTypeId", "name")
          .lean()
      : [],
    byType.correction?.length
      ? AttendanceCorrection.find({ _id: { $in: byType.correction } })
          .populate("employeeId", "name employeeId divisionId branchId")
          .lean()
      : [],
    byType.holiday_swap?.length
      ? HolidaySwapRequest.find({ _id: { $in: byType.holiday_swap } })
          .populate("employeeId", "name employeeId divisionId branchId")
          .lean()
      : [],
    [], // Biometric requests belong to the Pro module.
  ]);

  const index = new Map<string, Record<string, unknown>>();
  for (const doc of [...leaves, ...corrections, ...swaps, ...faceChanges] as Array<Record<string, unknown>>) {
    index.set(String(doc._id), doc);
  }

  const items = [];
  for (const inst of instances) {
    const source = index.get(String(inst.refId));
    if (!source) continue;

    const employee = source.employeeId as
      | { _id: RecordId; name: string; employeeId: string; divisionId?: RecordId }
      | undefined;

    const activeStep = inst.stepsStatus.find((s) => s.status === "pending" && s.stepNumber === inst.currentStep);

    // An SPV only ever sees their own division, in the queue and in history.
    if (
      ctx.user.role === "SPV" &&
      employee?.divisionId &&
      ctx.user.divisionId !== employee.divisionId.toString()
    ) {
      continue;
    }

    items.push({
      _id: inst._id,
      refType: inst.refType,
      refTypeLabel: REF_TYPE_LABEL[inst.refType as RefType] ?? inst.refType,
      refId: inst.refId,
      status: inst.status,
      currentStep: inst.currentStep,
      activeApproverRole: activeStep?.approverRole ?? null,
      canAct: view === "inbox" && (ctx.user.role === "SUPERADMIN" || activeStep?.approverRole === ctx.user.role),
      requesterName: employee?.name ?? "Karyawan",
      requesterNip: employee?.employeeId ?? "-",
      createdAt: inst.createdAt,
      updatedAt: inst.updatedAt,
      steps: inst.stepsStatus,
      history: inst.history,
      details: await describe(inst.refType as RefType, source),
    });
  }

  return apiSuccess(items, "Berhasil memuat antrean persetujuan", { page, limit, total });
});

async function describe(refType: RefType, doc: Record<string, unknown>) {
  if (refType === "leave") {
    const evidence = doc.evidenceUrl as string;
    return {
      title:
        ((doc.leaveTypeId as { name?: string } | undefined)?.name ?? "Izin/Cuti") +
        (doc.customPurpose ? `: ${doc.customPurpose as string}` : ""),
      period: `${formatDate(doc.startDate as Date)} – ${formatDate(doc.endDate as Date)}`,
      duration: `${doc.chargedDays ?? "-"} hari kerja`,
      reason: doc.reason as string,
      evidenceUrl: await attachmentRefHref(evidence),
    };
  }
  if (refType === "correction") {
    const evidence = doc.evidenceUrl as string;
    return {
      title: doc.isOverQuota ? "Koreksi Absen (melebihi kuota)" : "Koreksi Absen",
      period: formatDate(doc.date as Date),
      duration: `${doc.clockInTime} – ${doc.clockOutTime}`,
      reason: `${CORRECTION_REASON_LABELS[doc.reasonType as string] ?? doc.reasonType}: ${doc.reasonNote}`,
      evidenceUrl: await attachmentRefHref(evidence),
    };
  }
  if (refType === "face_change") throw Forbidden("Persetujuan biometrik memerlukan HRIS Pro.");

  return {
    title: "Tukar Libur",
    period: `Masuk ${formatDate(doc.holidayDate as Date)} → libur ${formatDate(doc.replacementDate as Date)}`,
    duration: doc.isHalfDay ? `Setengah hari (${doc.session})` : "Sehari penuh",
    reason: (doc.reason as string) || "-",
    evidenceUrl: "",
  };
}

/* ------------------------------------------------------------------ */
/* POST — approve / reject                                              */
/* ------------------------------------------------------------------ */

const decisionSchema = z.object({
  instanceId: z.string().regex(/^[0-9a-fA-F]{24}$/, "ID persetujuan tidak valid"),
  action: z.enum(["approve", "reject"]),
  comment: z.string().trim().max(1000).optional(),
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const body = await parseBody(req, decisionSchema);

  // A rejection without a reason is unusable for the employee receiving it.
  if (body.action === "reject" && (!body.comment || body.comment.length < 5)) {
    throw BadRequest("Alasan penolakan wajib diisi minimal 5 karakter agar pemohon memahami keputusannya.");
  }

  const instance = await ApprovalInstance.findById(body.instanceId).lean<{
    refType: string;
    refId: RecordId;
  } | null>();
  if (!instance) throw NotFound("Data persetujuan tidak ditemukan.");

  const refType = instance.refType as RefType;
  const { employeeId, summary } = await loadRef(refType, instance.refId);

  // Nobody approves their own request. Without this a supervisor could submit
  // leave, a correction, or — worst — a replacement of their own enrolled face,
  // then clear it from their own inbox a second later.
  if (ctx.user.employeeId && String(employeeId) === ctx.user.employeeId) {
    throw Forbidden(
      "Anda tidak dapat memutuskan pengajuan milik Anda sendiri. Pengajuan ini harus diputuskan oleh atasan atau HRD lain."
    );
  }

  const result = await decide({
    instanceId: body.instanceId,
    userId: ctx.user.id,
    userRole: ctx.user.role,
    action: body.action,
    comment: body.comment,
    employeeId,
    summary,
    onFinalized: async (status) => {
      await finalize(refType, instance.refId, status, body.comment ?? "");
    },
  });

  void logActivity({
    userId: ctx.user.id,
    action: body.action === "approve" ? "APPROVE_REQUEST" : "REJECT_REQUEST",
    module: refType,
    after: { instanceId: body.instanceId, result: result.status, comment: body.comment },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(result, result.message);
});

async function loadRef(refType: RefType, refId: RecordId) {
  if (refType === "leave") {
    const doc = await LeaveRequest.findById(refId).populate("leaveTypeId", "name").lean<{
      employeeId: RecordId;
      startDate: Date;
      endDate: Date;
      chargedDays: number;
      customPurpose?: string;
      leaveTypeId?: { name?: string };
    } | null>();
    if (!doc) throw NotFound("Pengajuan cuti tidak ditemukan.");
    return {
      employeeId: doc.employeeId,
      summary: `${doc.leaveTypeId?.name ?? "Cuti"}${doc.customPurpose ? `: ${doc.customPurpose}` : ""} ${formatDate(doc.startDate)} – ${formatDate(doc.endDate)} (${doc.chargedDays} hari)`,
    };
  }
  if (refType === "correction") {
    const doc = await AttendanceCorrection.findById(refId).lean<{
      employeeId: RecordId;
      date: Date;
      clockInTime: string;
      clockOutTime: string;
    } | null>();
    if (!doc) throw NotFound("Pengajuan koreksi tidak ditemukan.");
    return {
      employeeId: doc.employeeId,
      summary: `Koreksi absen ${formatDate(doc.date)} (${doc.clockInTime}–${doc.clockOutTime})`,
    };
  }
  if (refType === "face_change") throw Forbidden("Persetujuan biometrik memerlukan HRIS Pro.");

  const doc = await HolidaySwapRequest.findById(refId).lean<{
    employeeId: RecordId;
    holidayDate: Date;
    replacementDate: Date;
  } | null>();
  if (!doc) throw NotFound("Pengajuan tukar libur tidak ditemukan.");
  return {
    employeeId: doc.employeeId,
    summary: `Tukar libur ${formatDate(doc.holidayDate)} ke ${formatDate(doc.replacementDate)}`,
  };
}

/**
 * Applies the real-world effect of a completed decision.
 * Runs only once, when the flow reaches a terminal state.
 */
async function finalize(
  refType: RefType,
  refId: RecordId,
  status: "approved" | "rejected",
  comment: string
) {
  if (refType === "leave") {
    const leaveReq = await LeaveRequest.findById(refId);
    if (!leaveReq || leaveReq.status !== "pending") return;

    leaveReq.status = status;
    await leaveReq.save();

    const leaveType = await LeaveType.findById(leaveReq.leaveTypeId).lean<{ deductsBalance?: boolean; quotaMode?: "annual" | "per_event" | "none"; quotaDays: number } | null>();
    if (!leaveType || quotaModeOf(leaveType) === "annual") {
      const days = leaveReq.chargedDays ?? 0;
      // Approved: the reserved days become used. Rejected: they go back to the
      // employee. Either way `pendingDays` must be released exactly once.
      await LeaveBalance.updateOne(
        {
          employeeId: leaveReq.employeeId,
          leaveTypeId: leaveReq.leaveTypeId,
          year: new Date(leaveReq.startDate).getFullYear(),
        },
        status === "approved"
          ? { $inc: { pendingDays: -days, usedDays: days } }
          : { $inc: { pendingDays: -days, remainingDays: days } }
      );
    }
    return;
  }

  if (refType === "correction") {
    const correction = await AttendanceCorrection.findById(refId);
    if (!correction || correction.status !== "pending") return;

    correction.status = status;
    await correction.save();
    if (status !== "approved") return;

    const dayStart = wibStartOfDay(correction.date);
    const existing = await Attendance.findOne({
      employeeId: correction.employeeId,
      date: dayStart,
    });

    const patch: Record<string, unknown> = {
      clockIn: wibTimeOnDay(correction.date, correction.clockInTime),
      clockOut: wibTimeOnDay(correction.date, correction.clockOutTime),
      isLate: false,
      lateMinutes: 0,
      isEarlyLeave: false,
      earlyLeaveMinutes: 0,
      needsReview: false,
      note: `Koreksi absen disetujui${comment ? ` — ${comment}` : ""}. Alasan pemohon: ${correction.reasonNote}`,
    };
    if (correction.breakOutTime) patch.breakOut = wibTimeOnDay(correction.date, correction.breakOutTime);
    if (correction.breakInTime) patch.breakIn = wibTimeOnDay(correction.date, correction.breakInTime);

    if (existing) {
      // Keep the original GPS evidence; a correction fixes times, not location.
      Object.assign(existing, patch);
      await existing.save();
    } else {
      // No tap at all that day. Create the record from the employee's branch
      // coordinates rather than the hardcoded Jakarta monument the previous
      // implementation used, which made every corrected day look like a
      // Monas check-in.
      const employee = await Employee.findById(correction.employeeId)
        .populate("branchId", "lat lng")
        .lean<{ branchId?: { _id: RecordId; lat: number; lng: number } } | null>();

      await Attendance.create({
        employeeId: correction.employeeId,
        date: dayStart,
        gpsLat: employee?.branchId?.lat ?? 0,
        gpsLng: employee?.branchId?.lng ?? 0,
        branchId: employee?.branchId?._id,
        photoUrl: [],
        isManualFallback: true,
        ...patch,
      });
    }
    return;
  }

  if (refType === "holiday_swap") {
    await HolidaySwapRequest.updateOne({ _id: refId, status: "pending" }, { status });
    return;
  }

  if (refType === "face_change") throw Forbidden("Persetujuan biometrik memerlukan HRIS Pro.");
}
