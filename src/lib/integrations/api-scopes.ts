import { RBAC_ACTIONS, RBAC_MODULES } from "@/lib/rbac/modules";

/**
 * API key scopes mirror the RBAC matrix as `module:action`. Settings is never
 * grantable: a key must not mint keys, change roles, or read secrets.
 * `employees.read` is the original directory-only scope, kept for existing keys.
 */
export const API_KEY_EXCLUDED_MODULES = ["settings"] as const;

export const API_KEY_SCOPES = [
  "employees.read",
  ...RBAC_MODULES.filter((m) => !(API_KEY_EXCLUDED_MODULES as readonly string[]).includes(m.id)).flatMap((m) =>
    RBAC_ACTIONS.map((a) => `${m.id}:${a.id}`)
  ),
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const permissionScope = (module: string, action: string) => `${module}:${action}`;

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(value);
}

/** `module:action` → its parts; null for the legacy directory scope or unknown values. */
export function parseScope(scope: string): { module: string; action: string } | null {
  const [module, action, extra] = scope.split(":");
  if (extra !== undefined || !module || !action || !isApiKeyScope(scope)) return null;
  return { module, action };
}

/** Keys are shown once; this is the only accepted shape of the secret. */
export const API_KEY_PATTERN = /^hris_[A-Za-z0-9_-]{40,}$/;

/** Returns the bearer API key of a request, or null when the request carries none. */
export function bearerApiKey(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match && match[1].startsWith("hris_") ? match[1] : null;
}
