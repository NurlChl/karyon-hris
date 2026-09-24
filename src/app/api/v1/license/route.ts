import { z } from "zod";
import { apiSuccess, wrapRouteHandler } from "@/lib/api";
import { BadRequest, enforceRateLimit, Forbidden, parseBody, requireUser } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { EDITION, getEntitlements } from "@/lib/licensing/server";
import { PRO_FEATURE_LABELS } from "@/lib/licensing/features";
import { activateLicense, activationSummary, createUpgradeCode, LicenseServerError, licenseServer, renewLease } from "@/lib/licensing/activation";

function serverOrigin() {
  try { return licenseServer(); } catch { return null; }
}

export const GET = wrapRouteHandler(async (req) => {
  await requireUser(req);
  const license = await getEntitlements();
  const response = apiSuccess({ ...license, edition: EDITION, featureLabels: PRO_FEATURE_LABELS, activation: await activationSummary(), licenseServer: serverOrigin() });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("activate"), licenseKey: z.string().trim().min(16).max(256) }).strict(),
  z.object({ action: z.literal("upgrade-code") }).strict(),
  z.object({ action: z.literal("refresh") }).strict(),
]);

/**
 * Superadmin only. `activate` binds a license key to this installation and
 * website origin; `upgrade-code` returns a 15-minute one-time code for
 * `install.sh --upgrade-code`; `refresh` renews the signed lease now.
 */
export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  if (ctx.user.role !== "SUPERADMIN") throw Forbidden("Hanya Superadmin yang dapat mengelola lisensi.");
  const body = await parseBody(req, action);
  enforceRateLimit("license-action", ctx.user.id, { max: 10, windowMs: 10 * 60_000 });
  try {
    if (body.action === "activate") {
      await activateLicense(body.licenseKey);
      void logActivity({ userId: ctx.user.id, action: "LICENSE_ACTIVATED", module: "settings", after: { keyHint: body.licenseKey.slice(-4) }, ip: ctx.ip, userAgent: ctx.userAgent });
      return apiSuccess({ activation: await activationSummary() }, "Lisensi berhasil diaktifkan untuk instalasi ini.");
    }
    if (body.action === "refresh") {
      await renewLease();
      return apiSuccess({ activation: await activationSummary() }, "Status lisensi diperbarui dari server lisensi.");
    }
    const code = await createUpgradeCode();
    const server = licenseServer();
    void logActivity({ userId: ctx.user.id, action: "LICENSE_UPGRADE_CODE", module: "settings", after: { expiresAt: code.expiresAt }, ip: ctx.ip, userAgent: ctx.userAgent });
    return apiSuccess({
      ...code,
      command: `curl -fsSL ${server}/install.sh | sh -s -- --upgrade-code ${code.code}`,
      localCommand: `sh install.sh --upgrade-code ${code.code} --license-server ${server}`,
    }, "Kode upgrade dibuat. Berlaku 15 menit dan hanya sekali pakai.");
  } catch (error) {
    if (error instanceof LicenseServerError) throw BadRequest(error.message);
    throw error;
  }
});
