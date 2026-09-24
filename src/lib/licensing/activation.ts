import "server-only";
import { randomBytes } from "node:crypto";
import { connectToDatabase } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { getSettings } from "@/lib/settings";
import Setting from "@/models/Setting";

/**
 * In-app license activation: the HRIS server talks to the license website
 * directly, no agent needed. State (installation id, activation secret, signed
 * lease) is stored encrypted with ENCRYPTION_KEY in one settings row that the
 * generic settings API never exposes.
 *
 * Community stores the activation so the upgrade command can be issued; only
 * the Pro build turns the signed lease into enabled features.
 */

export const ACTIVATION_SETTING_KEY = "license_activation";

interface ActivationState {
  installationId: string;
  activationSecret: string;
  lease: string;
  siteOrigin: string;
  updatedAt: string;
}

export class LicenseServerError extends Error {}

/** The license website; HTTPS only, plain HTTP only on loopback for development. */
export function licenseServer(): string {
  const raw = process.env.HRIS_LICENSE_SERVER?.trim();
  if (!raw) throw new LicenseServerError("Alamat server lisensi (HRIS_LICENSE_SERVER) belum diisi pada instalasi ini.");
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new LicenseServerError("HRIS_LICENSE_SERVER wajib HTTPS.");
  return url.origin;
}

export function siteOrigin(): string {
  const raw = process.env.NEXTAUTH_URL;
  if (!raw) throw new LicenseServerError("NEXTAUTH_URL belum diisi; lisensi terikat pada alamat website HRIS.");
  return new URL(raw).origin;
}

export async function readActivation(): Promise<ActivationState | null> {
  await connectToDatabase();
  const row = await Setting.findOne({ key: ACTIVATION_SETTING_KEY }).lean<{ value?: unknown } | null>();
  if (typeof row?.value !== "string" || !row.value) return null;
  try { return JSON.parse(decrypt(row.value)) as ActivationState; } catch { return null; }
}

async function writeActivation(state: ActivationState) {
  await connectToDatabase();
  await Setting.findOneAndUpdate(
    { key: ACTIVATION_SETTING_KEY },
    { $set: { value: encrypt(JSON.stringify(state)), description: "Aktivasi lisensi Pro (terenkripsi)" } },
    { upsert: true }
  );
}

async function call<T>(path: string, body: unknown, notFound = "Server lisensi tidak mengenali instalasi ini. Aktifkan ulang license key."): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${licenseServer()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof LicenseServerError) throw error;
    throw new LicenseServerError("Server lisensi tidak dapat dihubungi. Periksa koneksi internet server HRIS.");
  }
  const json = (await response.json().catch(() => ({}))) as { data?: T; error?: string };
  if (response.status === 404) throw new LicenseServerError(notFound);
  if (!response.ok) throw new LicenseServerError(typeof json.error === "string" ? json.error : `Server lisensi menolak permintaan (${response.status}).`);
  return json.data as T;
}

/** Activates a license key for this installation and origin. Re-activation reuses the stored secret. */
export async function activateLicense(licenseKey: string) {
  const current = await readActivation();
  const settings = await getSettings();
  const installationId = current?.installationId ?? `inst${randomBytes(16).toString("hex")}`;
  const origin = siteOrigin();
  const data = await call<{ activationSecret: string; lease: string }>("/api/licenses/activate", {
    licenseKey,
    installationId,
    instanceName: String(settings.company_name ?? "HRIS").slice(0, 120) || "HRIS",
    siteOrigin: origin,
    ...(current?.activationSecret ? { activationSecret: current.activationSecret } : {}),
  }, "License key tidak dikenal. Salin ulang dari menu Langganan di website lisensi.");
  await writeActivation({ installationId, activationSecret: data.activationSecret, lease: data.lease, siteOrigin: origin, updatedAt: new Date().toISOString() });
}

let renewing: Promise<void> | null = null;
/** Fetches a fresh lease; concurrent callers share one request. */
export function renewLease(): Promise<void> {
  if (!renewing) {
    renewing = (async () => {
      const current = await readActivation();
      if (!current) return;
      const data = await call<{ lease: string }>("/api/licenses/lease", { installationId: current.installationId, activationSecret: current.activationSecret, siteOrigin: siteOrigin() });
      await writeActivation({ ...current, lease: data.lease, updatedAt: new Date().toISOString() });
    })().finally(() => { renewing = null; });
  }
  return renewing;
}

/** One-time code for `install.sh --upgrade-code`, valid 15 minutes. */
export async function createUpgradeCode() {
  const current = await readActivation();
  if (!current) throw new LicenseServerError("Aktifkan license key terlebih dahulu.");
  return call<{ code: string; expiresAt: string }>("/api/licenses/upgrade-code", { installationId: current.installationId, activationSecret: current.activationSecret, siteOrigin: siteOrigin() });
}

/** Unverified view of the stored lease for display only; the Pro build verifies the signature. */
export async function activationSummary() {
  const current = await readActivation();
  if (!current) return { activated: false as const };
  let claims: { plan?: string; features?: string[]; exp?: number; graceUntil?: number } = {};
  try { claims = JSON.parse(Buffer.from(current.lease.split(".")[1] ?? "", "base64url").toString("utf8")); } catch { /* malformed lease shows as unknown */ }
  return {
    activated: true as const,
    installationId: current.installationId,
    siteOrigin: current.siteOrigin,
    plan: claims.plan ?? null,
    features: Array.isArray(claims.features) ? claims.features : [],
    leaseExpiresAt: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
    graceUntil: claims.graceUntil ? new Date(claims.graceUntil * 1000).toISOString() : null,
    updatedAt: current.updatedAt,
  };
}
