import { checkPermission, type PermissionResult } from "@/lib/rbac";

type PayslipRecord = { employeeId: unknown; status: string };

/** The same owner/publication and company-wide payroll rule as payroll/document. */
export async function canReadStoredPayslip(user: { id: string; employeeId: string | null },
  payroll: PayslipRecord, resolvePermission: typeof checkPermission = checkPermission) {
  if (String(payroll.employeeId) === user.employeeId) return payroll.status !== "draft";
  const permission: PermissionResult = await resolvePermission(user.id, "payroll", "read");
  return permission.allowed && permission.scope === "all";
}
