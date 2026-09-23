import "server-only";
import { COMMUNITY_ENTITLEMENTS, PRO_FEATURES, effectiveEntitlements, type EntitlementSnapshot, type ProFeature } from "./features";

let cached: { at: number; value: EntitlementSnapshot } | null = null;
const CACHE_MS = 30_000;

function isSnapshot(value: unknown): value is EntitlementSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<EntitlementSnapshot>;
  return ["community", "pro", "enterprise"].includes(String(row.plan))
    && ["active", "grace", "expired", "unlicensed"].includes(String(row.status))
    && Array.isArray(row.features)
    && row.features.every((feature) => PRO_FEATURES.includes(feature as ProFeature));
}

export async function getEntitlements(force = false): Promise<EntitlementSnapshot> {
  if (process.env.NODE_ENV !== "production" && process.env.LICENSE_BYPASS_FOR_DEVELOPMENT === "true") {
    return { plan: "pro", status: "active", features: [...PRO_FEATURES], expiresAt: null, graceUntil: null, installationId: "development", source: "development" };
  }
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return effectiveEntitlements(cached.value);
  const url = process.env.HRIS_AGENT_URL?.replace(/\/$/, "");
  const token = process.env.HRIS_AGENT_TOKEN;
  if (!url || !token) return COMMUNITY_ENTITLEMENTS;
  try {
    const response = await fetch(`${url}/v1/entitlements`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
    });
    const value: unknown = await response.json();
    if (!response.ok || !isSnapshot(value)) throw new Error("Respons agent tidak valid");
    cached = { at: Date.now(), value };
    return effectiveEntitlements(value);
  } catch (error) {
    console.error("[LICENSE] Agent tidak dapat dihubungi:", error instanceof Error ? error.message : "unknown");
    return cached ? effectiveEntitlements(cached.value) : COMMUNITY_ENTITLEMENTS;
  }
}

export async function requireProFeature(feature: ProFeature) {
  const license = await getEntitlements();
  if (!["active", "grace"].includes(license.status) || !license.features.includes(feature)) {
    const { Forbidden } = await import("@/lib/guard");
    throw Forbidden(`Fitur ini memerlukan paket Pro aktif (${feature}). Data yang sudah ada tetap aman dan dapat diekspor.`);
  }
  return license;
}
