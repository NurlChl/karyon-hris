import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requirePermission, parseBody } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { generatePassword, readPolicy, writePolicy } from "@/lib/auth/initial-password";
import { getSettings } from "@/lib/settings";

/**
 * Initial passwords per role. Readable and writable only by holders of
 * `settings:write`, and every read is audited: the response contains the
 * plaintext values HR hands out.
 */
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "settings", "write");
  const [policy, settings] = await Promise.all([readPolicy(), getSettings()]);

  void logActivity({
    userId: ctx.user.id,
    action: "VIEW_INITIAL_PASSWORDS",
    module: "settings",
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess({
    roles: Object.entries(policy)
      .map(([role, p]) => ({ role, mode: p.mode, password: p.password }))
      .sort((a, b) => a.role.localeCompare(b.role)),
    forceChange: Boolean(settings.force_password_change_on_first_login),
    minLength: Number(settings.password_min_length),
    suggestion: generatePassword(),
  });
});

const bodySchema = z.object({
  roles: z
    .array(
      z.object({
        role: z.string().trim().min(2).max(40),
        mode: z.enum(["fixed", "random"]),
        password: z.string().max(128).default(""),
      })
    )
    .min(1),
});

export const PUT = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "settings", "write");
  const body = await parseBody(req, bodySchema);
  const current = await readPolicy();

  const next = { ...current };
  const changed: string[] = [];
  for (const r of body.roles) {
    if (!current[r.role]) continue; // unknown or unconfigurable role
    const before = current[r.role];
    const after = { mode: r.mode, password: r.mode === "fixed" ? r.password : "" };
    if (before.mode !== after.mode || (after.mode === "fixed" && before.password !== after.password)) {
      changed.push(r.role);
    }
    next[r.role] = after;
  }

  await writePolicy(next, changed);

  if (changed.length) {
    // Which roles changed and to which mode; never the passwords themselves.
    void logActivity({
      userId: ctx.user.id,
      action: "UPDATE_INITIAL_PASSWORDS",
      module: "settings",
      after: Object.fromEntries(changed.map((role) => [role, next[role].mode])),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  return apiSuccess(
    { changed },
    changed.length
      ? `Kata sandi awal diperbarui untuk ${changed.join(", ")}. Berlaku untuk akun yang dibuat mulai sekarang; akun yang sudah ada tidak berubah.`
      : "Tidak ada perubahan."
  );
});
