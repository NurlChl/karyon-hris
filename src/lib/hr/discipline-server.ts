import { RecordId } from "@/lib/postgres";
import database from "@/lib/postgres";
import { sha256 } from "@/lib/crypto";
import { requirePermission, type GuardContext } from "@/lib/guard";
import Employee from "@/models/Employee";
import { disciplineEmployeeFilter } from "./discipline";
export { disciplineEmployeeFilter } from "./discipline";
import { logActivity } from "@/lib/audit/logger";
import DisciplineCase from "@/models/DisciplineCase";
import type { SettingsSnapshot } from "@/lib/settings";
import type { DecisionEvidence } from "./policy-evidence";

export async function requireDisciplineAdmin(req: Request, action: "read" | "write" | "approve") {
  return requirePermission(req, "discipline", action);
}

export async function disciplineCaseFilter(ctx: GuardContext, mutation = false) {
  const employeeIds = await Employee.distinct("_id", disciplineEmployeeFilter(ctx, mutation));
  return { employeeId: { $in: employeeIds } };
}

export async function queueCapReview(employeeId: string, actorId: string, evidence: DecisionEvidence, settings: SettingsSnapshot) {
  if (!settings.payroll_cap_sanction_enabled || !evidence.capExceeded) return;
  const sourceKey = `payroll-cap:${employeeId}:${evidence.period}`;
  const _id = new RecordId(sha256(sourceKey).slice(0, 24));
  const result = await DisciplineCase.updateOne({ _id }, { $setOnInsert: {
    _id, sourceKey, employeeId, category: "attendance", title: `Tinjauan batas potongan ${evidence.period}`,
    description: String(settings.payroll_cap_sanction_note || "Tinjau bukti dan klarifikasi karyawan sebelum memutuskan tindakan."),
    action: String(settings.payroll_cap_sanction_action), createdBy: actorId,
    occurredAt: new Date(), snapshot: evidence, status: "open", revision: 0,
    history: [{ actorId, status: "open", note: "Usulan otomatis dari perhitungan payroll; perlu klarifikasi dan keputusan HR.", at: new Date() }],
  } }, { upsert: true, runValidators: true });
  if (result.upsertedCount) void logActivity({ userId: actorId, action: "DISCIPLINE_REVIEW_QUEUED", module: "employees", after: { caseId: String(_id) } });
}
