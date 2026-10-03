/** Roles allowed anywhere under /admin. */
export const ADMIN_ROLES = new Set(["SUPERADMIN", "DIREKSI", "HRD", "AUDIT", "GA", "SPV"]);

/** Where a given role lands after signing in. */
export function landingFor(role: string | undefined): string {
  if (role && ADMIN_ROLES.has(role)) return "/admin";
  return "/portal/attendance";
}

/**
 * A `callbackUrl` a signed-in user may be sent back to: same-site, never an
 * auth page (that would loop), and only into areas the role can open.
 */
export function safeCallback(value: string | null | undefined, role: string | undefined): string | null {
  if (!value || value.length > 512 || !/^\/(?!\/)/.test(value) || /[\\\x00-\x20]/.test(value)) return null;
  let url: URL;
  try { url = new URL(value, "http://same.invalid"); } catch { return null; }
  if (url.origin !== "http://same.invalid") return null;
  const path = url.pathname;
  const under = (root: string) => path === root || path.startsWith(`${root}/`);
  const allowed = under("/portal") || under("/docs") || under("/print")
    || (role !== undefined && ADMIN_ROLES.has(role) && (under("/admin") || under("/api-docs")));
  return allowed ? `${path}${url.search}` : null;
}
