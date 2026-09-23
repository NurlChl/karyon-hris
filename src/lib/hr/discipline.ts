export const DISCIPLINE_ACTIONS = ["coaching", "warning", "sp1", "sp2", "sp3", "termination", "resignation", "other"] as const;
export const DISCIPLINE_LABELS: Record<typeof DISCIPLINE_ACTIONS[number], string> = {
  coaching: "Pembinaan", warning: "Teguran", sp1: "SP1", sp2: "SP2", sp3: "SP3", termination: "PHK / pemutusan hubungan kerja", resignation: "Pengunduran diri", other: "Tindakan lain",
};
export function canTransitionDiscipline(from: string, to: string) {
  return (from === "open" && ["issued", "rejected"].includes(to)) || (from === "issued" && to === "closed");
}

import type { ScopeContext } from "../rbac/scope";
/** IDs come from the live authenticated principal, never from posted scope fields. */
export function disciplineEmployeeFilter(ctx: ScopeContext, mutation = false): Record<string, unknown> {
  if (!ctx.permission.allowed) return { _id: { $in: [] } };
  const scope = ctx.permission.scope;
  let base: Record<string, unknown> = { _id: { $in: [] } };
  if (scope === "all") base = {};
  else if (scope === "reports" && ctx.user.employeeId) base = { supervisorId: ctx.user.employeeId };
  else if (scope === "self" && ctx.user.employeeId) base = { _id: ctx.user.employeeId };
  else if (scope === "branch" && ctx.user.branchId) base = { branchId: ctx.user.branchId };
  else if (scope === "division" && ctx.user.divisionId) base = { divisionId: ctx.user.divisionId };
  return mutation ? { $and: [base, { _id: { $ne: ctx.user.employeeId } }] } : base;
}
