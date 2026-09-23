import { RecordId } from "@/lib/postgres";
import database from "@/lib/postgres";
import ApprovalFlow from "@/models/ApprovalFlow";
import ApprovalInstance from "@/models/ApprovalInstance";
import Employee from "@/models/Employee";
import { connectToDatabase } from "@/lib/db";
import { notifyUsers, resolveRecipientsByRole, resolveRecipientForEmployee } from "@/lib/notification/notify";

/**
 * The polymorphic approval engine shared by leave, attendance corrections, and
 * holiday swaps. A module creates an instance, then only ever calls `decide`;
 * routing, notification, and completion callbacks all live here so the three
 * modules cannot drift apart in behaviour.
 */

export type RefType = "leave" | "correction" | "holiday_swap" | "face_change";

export interface StepDef {
  stepNumber: number;
  approverRole: string;
  isMandatory: boolean;
}

/** Used when the CMS has no flow configured for a transaction type yet. */
const FALLBACK_STEPS: Record<RefType, StepDef[]> = {
  leave: [
    { stepNumber: 1, approverRole: "SPV", isMandatory: true },
    { stepNumber: 2, approverRole: "HRD", isMandatory: true },
  ],
  correction: [
    { stepNumber: 1, approverRole: "SPV", isMandatory: true },
    { stepNumber: 2, approverRole: "HRD", isMandatory: true },
  ],
  holiday_swap: [
    { stepNumber: 1, approverRole: "SPV", isMandatory: true },
    { stepNumber: 2, approverRole: "HRD", isMandatory: true },
  ],
  // The supervisor is the person who actually knows the employee's face, so
  // they are the one who can tell whether the new photos are the same person.
  face_change: [{ stepNumber: 1, approverRole: "SPV", isMandatory: true }],
};

export const REF_TYPE_LABEL: Record<RefType, string> = {
  leave: "Pengajuan Izin/Cuti",
  correction: "Koreksi Absen",
  holiday_swap: "Tukar Libur",
  face_change: "Penggantian Wajah Presensi",
};

export const REF_TYPE_LINK: Record<RefType, string> = {
  leave: "/portal/leave",
  correction: "/portal/attendance",
  holiday_swap: "/portal/holiday-swap",
  face_change: "/portal/profile?tab=face",
};

export async function getFlowSteps(refType: RefType): Promise<StepDef[]> {
  await connectToDatabase();
  const flow = await ApprovalFlow.findOne({ transactionType: refType }).lean<{
    steps?: StepDef[];
  } | null>();
  const steps = flow?.steps?.length ? [...flow.steps] : FALLBACK_STEPS[refType];
  return steps.sort((a, b) => a.stepNumber - b.stepNumber);
}

export interface CreateInstanceArgs {
  refType: RefType;
  refId: RecordId | string;
  employeeId: RecordId | string;
  submitterUserId: string;
  /** Human summary shown to approvers in the notification. */
  summary: string;
}

/**
 * Opens an approval instance and notifies the first approver group.
 * Returns the instance id so the caller can store it on its own document.
 */
export async function createApprovalInstance({
  refType,
  refId,
  employeeId,
  submitterUserId,
  summary,
}: CreateInstanceArgs): Promise<RecordId> {
  await connectToDatabase();
  const steps = await getFlowSteps(refType);

  const requester = await Employee.findById(employeeId).select("divisionId").lean<{ divisionId?: RecordId } | null>();
  const instance = await ApprovalInstance.create({
    refType,
    refId,
    employeeId,
    divisionId: requester?.divisionId ?? null,
    currentStep: steps[0]?.stepNumber ?? 1,
    status: "pending",
    stepsStatus: steps.map((s) => ({
      stepNumber: s.stepNumber,
      approverRole: s.approverRole,
      status: "pending",
    })),
    history: [
      {
        action: "SUBMITTED",
        userId: submitterUserId,
        timestamp: new Date(),
        comment: summary,
      },
    ],
  });

  await notifyStep(instance.currentStep, instance, employeeId, summary);
  return instance._id as RecordId;
}

async function notifyStep(
  stepNumber: number,
  instance: { _id: unknown; refType: string; stepsStatus: Array<{ stepNumber: number; approverRole: string }> },
  employeeId: RecordId | string,
  summary: string
) {
  const step = instance.stepsStatus.find((s) => s.stepNumber === stepNumber);
  if (!step) return;

  const employee = await Employee.findById(employeeId)
    .select("name divisionId branchId")
    .lean<{ name: string; divisionId?: RecordId; branchId?: RecordId } | null>();

  // An SPV step is scoped to the requester's own division; other roles are
  // company-wide.
  const scoped = step.approverRole === "SPV";
  const recipients = await resolveRecipientsByRole(step.approverRole, {
    divisionId: scoped ? employee?.divisionId?.toString() ?? null : null,
  });

  await notifyUsers(recipients, {
    kind: "approval_request",
    title: `Persetujuan dibutuhkan: ${REF_TYPE_LABEL[instance.refType as RefType]}`,
    body: `${employee?.name ?? "Karyawan"} — ${summary}`,
    href: "/admin/approvals",
    refType: instance.refType,
    refId: instance._id as RecordId,
  });
}

export interface DecisionResult {
  status: "pending" | "approved" | "rejected";
  /** True once the last mandatory step has passed. */
  completed: boolean;
  message: string;
}

export interface DecideArgs {
  instanceId: string;
  userId: string;
  userRole: string;
  action: "approve" | "reject";
  comment?: string;
  employeeId: RecordId | string;
  summary: string;
  /** Runs inside the decision once the flow reaches its terminal state. */
  onFinalized?: (status: "approved" | "rejected") => Promise<void>;
}

/**
 * Records one approver's decision and advances (or terminates) the flow.
 *
 * The instance is re-read and its active step re-checked under the caller's
 * role every time, so two approvers pressing the button simultaneously cannot
 * both consume the same step.
 */
export async function decide({
  instanceId,
  userId,
  userRole,
  action,
  comment,
  employeeId,
  summary,
  onFinalized,
}: DecideArgs): Promise<DecisionResult> {
  await connectToDatabase();
  const now = new Date();

  const instance = await ApprovalInstance.findById(instanceId);
  if (!instance) throw Object.assign(new Error("Persetujuan tidak ditemukan."), { name: "HttpError", status: 404, code: "NOT_FOUND" });
  if (instance.status !== "pending") {
    throw Object.assign(new Error("Pengajuan ini sudah selesai diproses."), {
      name: "HttpError",
      status: 409,
      code: "ALREADY_DECIDED",
    });
  }

  const idx = instance.stepsStatus.findIndex(
    (s: { status: string; stepNumber: number }) =>
      s.status === "pending" && s.stepNumber === instance.currentStep
  );
  if (idx === -1) {
    throw Object.assign(new Error("Tidak ada langkah persetujuan yang aktif."), {
      name: "HttpError",
      status: 409,
      code: "NO_ACTIVE_STEP",
    });
  }

  const step = instance.stepsStatus[idx];
  // SUPERADMIN can unblock a stuck flow; everyone else must match the step role.
  if (userRole !== step.approverRole && userRole !== "SUPERADMIN") {
    throw Object.assign(
      new Error(`Langkah ini menunggu persetujuan peran ${step.approverRole}.`),
      { name: "HttpError", status: 403, code: "FORBIDDEN" }
    );
  }

  instance.stepsStatus[idx].status = action === "approve" ? "approved" : "rejected";
  instance.stepsStatus[idx].actionedBy = userId;
  instance.stepsStatus[idx].actionedAt = now;
  instance.stepsStatus[idx].comment = comment ?? "";

  instance.history.push({
    action: action === "approve" ? "APPROVED" : "REJECTED",
    userId,
    timestamp: now,
    comment: comment ?? "",
  });

  let completed = false;
  let message: string;

  if (action === "reject") {
    instance.status = "rejected";
    completed = true;
    message = "Pengajuan ditolak dan pemohon telah diberi tahu.";
  } else {
    const next = instance.stepsStatus
      .filter((s: { stepNumber: number }) => s.stepNumber > instance.currentStep)
      .sort((a: { stepNumber: number }, b: { stepNumber: number }) => a.stepNumber - b.stepNumber)[0];

    if (next) {
      instance.currentStep = next.stepNumber;
      message = `Disetujui. Diteruskan ke ${next.approverRole} untuk persetujuan berikutnya.`;
    } else {
      instance.status = "approved";
      completed = true;
      message = "Pengajuan disetujui sepenuhnya.";
    }
  }

  await instance.save();

  if (completed && onFinalized) {
    await onFinalized(instance.status as "approved" | "rejected");
  }

  // Notify: the next approver if the flow continues, the requester if it ended.
  if (!completed) {
    await notifyStep(instance.currentStep, instance, employeeId, summary);
    // The requester hears about progress too, not only the final outcome, so a
    // leave approved by the supervisor on Monday is not a mystery until Friday.
    const nextRole = instance.stepsStatus.find(
      (s: { stepNumber: number }) => s.stepNumber === instance.currentStep
    )?.approverRole;
    const requester = await resolveRecipientForEmployee(employeeId);
    await notifyUsers(requester, {
      kind: "approval_result",
      title: `${REF_TYPE_LABEL[instance.refType as RefType]} disetujui ${step.approverRole}`,
      body: `${summary}. Sekarang menunggu persetujuan ${nextRole ?? "berikutnya"}.${comment ? ` Catatan: "${comment}"` : ""}`,
      href: REF_TYPE_LINK[instance.refType as RefType],
      refType: instance.refType,
      refId: instance._id as RecordId,
      emailOptOut: true,
    });
  } else {
    const recipients = await resolveRecipientForEmployee(employeeId);
    const label = REF_TYPE_LABEL[instance.refType as RefType];
    await notifyUsers(recipients, {
      kind: "approval_result",
      title:
        instance.status === "approved"
          ? `${label} Anda disetujui`
          : `${label} Anda ditolak`,
      body:
        instance.status === "approved"
          ? `${summary} telah disetujui sepenuhnya.`
          : `${summary} ditolak oleh ${step.approverRole}.${comment ? ` Catatan: "${comment}"` : ""}`,
      href: REF_TYPE_LINK[instance.refType as RefType],
      refType: instance.refType,
      refId: instance._id as RecordId,
    });
  }

  return { status: instance.status as DecisionResult["status"], completed, message };
}

/** Cancels a still-untouched instance — used when a requester withdraws. */
export async function cancelInstance(instanceId: RecordId | string, userId: string) {
  await connectToDatabase();
  const instance = await ApprovalInstance.findById(instanceId);
  if (!instance) return;
  instance.status = "rejected";
  instance.history.push({
    action: "CANCELLED",
    userId,
    timestamp: new Date(),
    comment: "Dibatalkan oleh pemohon",
  });
  await instance.save();
}

/** True when no approver has acted yet, so the requester may still withdraw. */
export function isUntouched(instance: { stepsStatus: Array<{ status: string }> }): boolean {
  return instance.stepsStatus.every((s) => s.status === "pending");
}
