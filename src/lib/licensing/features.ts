export const PRO_FEATURES = [
  "face.advanced",
  "payroll.advanced",
  "discipline.workflow",
  "organization.multi_branch",
  "analytics.advanced",
  "automation.advanced",
  "integration.api",
  "integration.webhook",
  "integration.sso",
  "agent.lifecycle",
] as const;

export type ProFeature = (typeof PRO_FEATURES)[number];

export const PRO_FEATURE_LABELS: Record<ProFeature, string> = {
  "face.advanced": "Face recognition dan perlindungan anti-spoof",
  "payroll.advanced": "Advanced payroll dan policy simulator",
  "discipline.workflow": "Bukti keputusan dan disciplinary workflow",
  "organization.multi_branch": "Multi-cabang",
  "analytics.advanced": "Analitik lanjutan",
  "automation.advanced": "Otomatisasi dan scheduler lanjutan",
  "integration.api": "Integrasi API",
  "integration.webhook": "Webhook",
  "integration.sso": "Single Sign-On",
  "agent.lifecycle": "Backup, update, dan rollback otomatis",
};

export interface EntitlementSnapshot {
  plan: "community" | "pro" | "enterprise";
  status: "active" | "grace" | "expired" | "unlicensed";
  features: ProFeature[];
  expiresAt: string | null;
  graceUntil: string | null;
  installationId: string | null;
  source: "agent" | "development" | "community";
}

export const COMMUNITY_ENTITLEMENTS: EntitlementSnapshot = {
  plan: "community",
  status: "unlicensed",
  features: [],
  expiresAt: null,
  graceUntil: null,
  installationId: null,
  source: "community",
};

/** Re-evaluates a cached agent lease so an outage can never freeze Pro access forever. */
export function effectiveEntitlements(snapshot: EntitlementSnapshot, now = Date.now()): EntitlementSnapshot {
  if (snapshot.source !== "agent") return snapshot;
  const leaseEnd = snapshot.expiresAt ? new Date(snapshot.expiresAt).getTime() : 0;
  const graceEnd = snapshot.graceUntil ? new Date(snapshot.graceUntil).getTime() : 0;
  if (!Number.isFinite(graceEnd) || now > graceEnd) return { ...snapshot, status: "expired", features: [] };
  if (!Number.isFinite(leaseEnd) || now > leaseEnd) return { ...snapshot, status: "grace" };
  return { ...snapshot, status: "active" };
}
