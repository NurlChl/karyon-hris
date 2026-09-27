import { checkPermission } from "@/lib/rbac";
import { employeeRecordScopeFilter } from "@/lib/rbac/scope";
type ComplaintPrincipal = { id: string; employeeId: string | null; branchId?: string | null; divisionId?: string | null };

/** Restrict handler access using the reporter's stored organisation membership. */
export async function complaintHandlerScope(user: ComplaintPrincipal, action: "read" | "write") {
  const permission = await checkPermission(user.id, "complaint", action);
  return employeeRecordScopeFilter({ user: { employeeId: user.employeeId, branchId: user.branchId ?? null,
    divisionId: user.divisionId ?? null }, permission }, "reporterId");
}

export function canReadComplaintQueue(role: string, target: string) {
  return role === "SUPERADMIN" || role === "AUDIT" ||
    (role === "SPV" && target === "spv") ||
    (role === "HRD" && target === "hrd") ||
    (role === "DIREKSI" && target === "direksi");
}

/** Anonymous attachments never expose their storage key to handlers or owners. */
export function complaintAttachmentHref(id: string, anonymous: boolean, attachment: string) {
  if (anonymous && attachment && !/^https?:\/\//i.test(attachment)) {
    return `/api/v1/complaints/attachment?id=${encodeURIComponent(id)}`;
  }
  return null;
}
