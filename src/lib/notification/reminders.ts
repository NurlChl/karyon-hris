import { RecordId } from "@/lib/postgres";
import database from "@/lib/postgres";
import Notification from "@/models/Notification";
import Attendance from "@/models/Attendance";
import ApprovalInstance from "@/models/ApprovalInstance";
import CandidateStageHistory from "@/models/CandidateStageHistory";
import Candidate from "@/models/Candidate";
import Employee from "@/models/Employee";
import "@/models/LeaveRequest";
import "@/models/AttendanceCorrection";
import "@/models/HolidaySwapRequest";
import "@/models/FaceChangeRequest";
import {
  notifyUsers,
  resolveRecipientForEmployee,
  resolveRecipientsByRole,
} from "@/lib/notification/notify";
import { formatDate, formatTime, wibDateKey, wibEndOfDay, wibParts, wibStartOfDay } from "@/lib/time";

/**
 * Reminders the daily cron sends.
 *
 * Each one exists because somebody would otherwise find out too late: a missed
 * clock-out only surfaces at payroll, an approval left for days blocks a leave
 * that has already started, an interviewer learns about an interview when the
 * candidate is at reception.
 *
 * Every reminder is keyed per day (`refType` below), so a second cron run on the
 * same day sends nothing new.
 */

type Recipient = Awaited<ReturnType<typeof resolveRecipientForEmployee>>[number];

/** Drops recipients who already got this reminder today. */
async function notYetToday(recipients: Recipient[], refType: string) {
  if (!recipients.length) return recipients;
  const already = await Notification.find({
    userId: { $in: recipients.map((r) => r.userId) },
    refType,
    createdAt: { $gte: wibStartOfDay() },
  })
    .select("userId")
    .lean<Array<{ userId: RecordId }>>();
  const done = new Set(already.map((n) => String(n.userId)));
  return recipients.filter((r) => !done.has(String(r.userId)));
}

function unique(recipients: Recipient[]) {
  const seen = new Set<string>();
  return recipients.filter((r) => (seen.has(String(r.userId)) ? false : (seen.add(String(r.userId)), true)));
}

/** Yesterday's attendance with a clock-in and no clock-out. */
export async function remindMissingClockOut() {
  const yesterday = new Date(wibStartOfDay().getTime() - 12 * 3600_000);
  const rows = await Attendance.find({
    date: { $gte: wibStartOfDay(yesterday), $lte: wibEndOfDay(yesterday) },
    clockIn: { $ne: null },
    $or: [{ clockOut: null }, { clockOut: { $exists: false } }],
  })
    .select("employeeId clockIn")
    .limit(2000)
    .lean<Array<{ employeeId: RecordId; clockIn: Date }>>();

  const key = `reminder:clockout:${wibDateKey(yesterday)}`;
  let sent = 0;
  for (const row of rows) {
    const recipients = await notYetToday(await resolveRecipientForEmployee(row.employeeId), key);
    if (!recipients.length) continue;
    await notifyUsers(recipients, {
      kind: "attendance",
      title: "Presensi pulang kemarin belum tercatat",
      body:
        `Anda absen masuk ${formatDate(yesterday)} pukul ${formatTime(row.clockIn)} tetapi tidak ada absen pulang. ` +
        "Ajukan koreksi absen agar jam kerja dan lembur terhitung benar.",
      href: "/portal/attendance?koreksi=1",
      refType: key,
    });
    sent++;
  }
  return { sent };
}

/** Approval steps that have waited more than two days, as one digest per approver. */
export async function remindStaleApprovals() {
  const cutoff = new Date(Date.now() - 48 * 3600_000);
  const stale = await ApprovalInstance.find({ status: "pending", updatedAt: { $lt: cutoff } })
    .select("refType refId currentStep stepsStatus employeeId divisionId")
    .limit(1000)
    .lean<
      Array<{
        refType: string;
        refId: RecordId;
        employeeId?: RecordId | null;
        divisionId?: RecordId | null;
        currentStep: number;
        stepsStatus: Array<{ stepNumber: number; approverRole: string }>;
      }>
    >();

  // Instances created before the requester was stored on them: read it from
  // the request document itself.
  const REF_MODELS: Record<string, string> = {
    leave: "LeaveRequest",
    correction: "AttendanceCorrection",
    holiday_swap: "HolidaySwapRequest",
    face_change: "FaceChangeRequest",
  };
  async function requesterDivision(inst: (typeof stale)[number]) {
    if (inst.divisionId) return String(inst.divisionId);
    let employeeId = inst.employeeId;
    if (!employeeId) {
      const modelName = REF_MODELS[inst.refType];
      const model = modelName ? database.models[modelName] : null;
      const doc = model ? await model.findById(inst.refId).select("employeeId").lean<{ employeeId?: RecordId } | null>() : null;
      employeeId = doc?.employeeId ?? null;
    }
    if (!employeeId) return null;
    const emp = await Employee.findById(employeeId).select("divisionId").lean<{ divisionId?: RecordId } | null>();
    return emp?.divisionId ? String(emp.divisionId) : null;
  }

  // Count per role (and per division for SPV, whose queue is division-scoped).
  const buckets = new Map<string, { role: string; divisionId: string | null; count: number }>();
  for (const inst of stale) {
    const step = inst.stepsStatus.find((s) => s.stepNumber === inst.currentStep);
    if (!step) continue;
    let divisionId: string | null = null;
    if (step.approverRole === "SPV") {
      divisionId = await requesterDivision(inst);
      // Without a division an SPV reminder would reach every supervisor.
      if (!divisionId) continue;
    }
    const k = `${step.approverRole}:${divisionId ?? "*"}`;
    const b = buckets.get(k) ?? { role: step.approverRole, divisionId, count: 0 };
    b.count++;
    buckets.set(k, b);
  }

  const key = `reminder:approvals:${wibDateKey()}`;
  let sent = 0;
  for (const b of buckets.values()) {
    const recipients = await notYetToday(await resolveRecipientsByRole(b.role, { divisionId: b.divisionId }), key);
    if (!recipients.length) continue;
    await notifyUsers(recipients, {
      kind: "approval_request",
      title: `${b.count} pengajuan menunggu Anda lebih dari 2 hari`,
      body: "Pengajuan cuti, koreksi absen, atau tukar libur ini tertahan di langkah Anda. Karyawan belum bisa memastikan rencananya sampai diputuskan.",
      href: "/admin/approvals",
      refType: key,
    });
    sent += recipients.length;
  }
  return { pending: stale.length, sent };
}

/** Tomorrow's interviews: the interviewer and HRD each get one list. */
export async function remindTomorrowInterviews() {
  const tomorrow = new Date(wibStartOfDay().getTime() + 36 * 3600_000);
  const interviews = await CandidateStageHistory.find({
    type: "interview",
    scheduledAt: { $gte: wibStartOfDay(tomorrow), $lte: wibEndOfDay(tomorrow) },
  })
    .select("candidateId scheduledAt location interviewerId interviewerName stage")
    .sort({ scheduledAt: 1 })
    .limit(300)
    .lean<
      Array<{
        candidateId: RecordId;
        scheduledAt: Date;
        location?: string;
        interviewerId?: RecordId | null;
        stage: string;
      }>
    >();
  if (!interviews.length) return { interviews: 0 };

  const candidates = await Candidate.find({
    _id: { $in: interviews.map((i) => i.candidateId) },
    status: { $ne: "rejected" },
    employeeId: null,
  })
    .select("name")
    .lean<Array<{ _id: RecordId; name: string }>>();
  const nameOf = new Map(candidates.map((c) => [String(c._id), c.name]));
  const live = interviews.filter((i) => nameOf.has(String(i.candidateId)));
  if (!live.length) return { interviews: 0 };

  const line = (i: (typeof live)[number]) =>
    `${formatTime(i.scheduledAt)} ${nameOf.get(String(i.candidateId))}${i.location ? ` (${i.location})` : ""}`;
  const key = `reminder:interviews:${wibDateKey(tomorrow)}`;

  // Per interviewer.
  const byInterviewer = new Map<string, typeof live>();
  for (const i of live) {
    if (!i.interviewerId) continue;
    const k = String(i.interviewerId);
    byInterviewer.set(k, [...(byInterviewer.get(k) ?? []), i]);
  }
  for (const [employeeId, list] of byInterviewer) {
    const recipients = await notYetToday(await resolveRecipientForEmployee(employeeId), key);
    if (!recipients.length) continue;
    await notifyUsers(recipients, {
      kind: "recruitment",
      title: `Besok Anda mewawancarai ${list.length} pelamar`,
      body: list.map(line).join(" · "),
      href: list.length === 1 ? `/admin/recruitment/${String(list[0].candidateId)}` : "/admin/recruitment?interview=upcoming&sort=interview",
      refType: key,
    });
  }

  // HRD overview.
  const hrd = await notYetToday(await resolveRecipientsByRole("HRD"), key);
  if (hrd.length) {
    await notifyUsers(hrd, {
      kind: "recruitment",
      title: `${live.length} wawancara dijadwalkan besok`,
      body: live.slice(0, 6).map(line).join(" · ") + (live.length > 6 ? ` dan ${live.length - 6} lainnya` : ""),
      href: "/admin/recruitment?interview=upcoming&sort=interview",
      refType: key,
      emailOptOut: true,
    });
  }
  return { interviews: live.length };
}

/** Weekly on Monday: new hires whose records HR has not completed after 3 days. */
export async function remindIncompleteNewHires() {
  if (wibParts().weekday !== 1) return { skipped: "bukan hari Senin" };
  const count = await Employee.countDocuments({
    isNewHire: true,
    createdAt: { $lt: new Date(Date.now() - 3 * 86_400_000) },
  });
  if (!count) return { count: 0 };

  const key = `reminder:newhires:${wibDateKey()}`;
  const recipients = await notYetToday(unique(await resolveRecipientsByRole("HRD")), key);
  if (recipients.length) {
    await notifyUsers(recipients, {
      kind: "system",
      title: `${count} data karyawan baru belum lengkap`,
      body: "NIK, rekening, atau alamat masih kosong. Payroll dan pelaporan BPJS memerlukan data ini.",
      href: "/admin/employees?baru=1",
      refType: key,
    });
  }
  return { count };
}
