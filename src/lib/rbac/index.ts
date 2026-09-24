import User from "@/models/User";
import RolePermission from "@/models/RolePermission";
import { connectToDatabase } from "../db";
import { currentApiKey } from "../integrations/request-context";

export interface PermissionResult {
  allowed: boolean;
  scope: "all" | "branch" | "division" | "self" | "reports";
}

/** Denied with the narrowest possible scope — the safe default everywhere. */
const DENY: PermissionResult = { allowed: false, scope: "self" };

/** Live permission snapshot; grants are not cached between requests. */
interface CacheEntry {
  roleName: string;
  permissions: Map<string, { actions: string[]; scope: string }>;
}

/**
 * Whether the API key of the current request (if any) was granted
 * `module:action`. Requests without a key are unaffected.
 */
export function apiKeyAllows(module: string, action: string): boolean {
  const key = currentApiKey();
  if (!key) return true;
  return key.scopes.includes(`${module}:${action}`) || (module === "employees" && action === "read" && key.scopes.includes("employees.read"));
}

/** Kept for existing callers; live grants no longer require invalidation. */
export function invalidatePermissionCache(_userId?: string) {}

async function loadPermissions(userId: string): Promise<CacheEntry | null> {
  await connectToDatabase();

  const user = await User.findById(userId)
    .populate("roleId", "name")
    .select("roleId isActive")
    .lean<{ roleId?: { _id: unknown; name?: string }; isActive?: boolean } | null>();

  // A deactivated account keeps a valid JWT until it expires, so the permission
  // check is the second line of defence after `authorize`.
  if (!user || user.isActive === false || !user.roleId?.name) return null;

  const rows = await RolePermission.find({ roleId: user.roleId._id })
    .select("module actions scope")
    .lean<Array<{ module: string; actions: string[]; scope: string }>>();

  return {
    roleName: user.roleId.name,
    permissions: new Map(rows.map((r) => [r.module, { actions: r.actions, scope: r.scope }])),
  };
}

/**
 * Resolves whether a user may perform `action` on `module`, and how wide a slice
 * of data that grant covers.
 *
 * The matrix lives in the `role_permissions` collection rather than in code, so
 * changes made in the CMS apply without a redeploy.
 */
export async function checkPermission(
  userId: string,
  module: string,
  action: string
): Promise<PermissionResult> {
  // An API key narrows what its creator may do in this request. Checks about
  // other users (e.g. routing an approval to an approver) are not narrowed.
  const key = currentApiKey();
  if (key && key.userId === userId && !apiKeyAllows(module, action)) return DENY;
  try {
    // Read live grants: a process-local TTL cannot reliably revoke permissions
    // across multiple instances after an administrator changes a role.
    const entry = await loadPermissions(userId);
    if (!entry) return DENY;

    // Superadmin is absolute and deliberately bypasses the table — the roles
    // endpoint refuses to edit its matrix for exactly this reason.
    if (entry.roleName === "SUPERADMIN") {
      return { allowed: true, scope: "all" };
    }

    const permission = entry.permissions.get(module);
    if (!permission || !permission.actions.includes(action)) return DENY;
    if (!["all", "branch", "division", "self", "reports"].includes(permission.scope)) return DENY;
    if (permission.scope === "reports" && module !== "discipline") return DENY;

    return { allowed: true, scope: permission.scope as PermissionResult["scope"] };
  } catch (err) {
    // Failing closed is the only safe behaviour: an unreachable database must
    // not be read as "everyone is allowed".
    console.error("[RBAC] permission check failed:", (err as Error).message);
    return DENY;
  }
}

/** Convenience for call sites that only need a yes/no. */
export async function can(userId: string, module: string, action: string): Promise<boolean> {
  return (await checkPermission(userId, module, action)).allowed;
}
