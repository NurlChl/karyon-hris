/**
 * Pay rules per employee, in words a payroll admin already uses. Client-safe:
 * the admin screens preview the same arithmetic the server applies.
 */

export type OvertimeMode = "company_rate" | "custom_rate" | "none";

export const OVERTIME_MODE_LABELS: Record<OvertimeMode, { label: string; hint: string }> = {
  company_rate: { label: "Dibayar tarif perusahaan", hint: "Tarif per jam dari Pengaturan → Payroll" },
  custom_rate: { label: "Dibayar tarif khusus", hint: "Tarif per jam yang disepakati dengan karyawan ini" },
  none: { label: "Tidak dibayar", hint: "Lembur sudah termasuk gaji atau diganti libur" },
};

export interface PayItem {
  kind: "earning" | "deduction";
  name: string;
  amount: number;
  note?: string;
  /** Recurring items only: last period (YYYY-MM) it applies to, e.g. the final instalment of a loan. */
  untilPeriod?: string;
}

export interface TargetTier {
  /** Achievement percentage at which this bonus starts, e.g. 100. */
  minPct: number;
  amount: number;
}

export interface TargetRule {
  enabled: boolean;
  /** "Target penjualan", "Target kunjungan"… */
  name: string;
  /** Shown after numbers: "unit", "Rp", "kunjungan". */
  unit: string;
  targetValue: number;
  /** Highest tier reached pays out; tiers do not add up. */
  tiers: TargetTier[];
  /** Extra per unit above 100%, 0 = none. */
  excessRate: number;
  /** The agreement, in words, printed nowhere but kept for reference. */
  note: string;
}

export interface PayProfileData {
  overtimeMode: OvertimeMode;
  overtimeRate: number;
  exemptLatePenalty: boolean;
  exemptAbsentPenalty: boolean;
  recurring: PayItem[];
  target: TargetRule;
}

export const EMPTY_TARGET: TargetRule = {
  enabled: false,
  name: "Target penjualan",
  unit: "unit",
  targetValue: 0,
  tiers: [
    { minPct: 80, amount: 0 },
    { minPct: 100, amount: 0 },
  ],
  excessRate: 0,
  note: "",
};

export const EMPTY_PROFILE: PayProfileData = {
  overtimeMode: "company_rate",
  overtimeRate: 0,
  exemptLatePenalty: false,
  exemptAbsentPenalty: false,
  recurring: [],
  target: EMPTY_TARGET,
};

export interface TargetResult {
  achievementPct: number;
  tierAmount: number;
  excessAmount: number;
  amount: number;
  /** "Target penjualan 118% (59/50 unit): bonus tingkat ≥100% Rp750.000 + 9 unit × Rp20.000" */
  explanation: string;
}

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

/** The incentive a target rule pays for an achieved value. */
export function targetIncentive(rule: TargetRule, actual: number | null | undefined): TargetResult | null {
  if (!rule.enabled || !rule.targetValue || actual === null || actual === undefined) return null;
  const pct = Math.round((actual / rule.targetValue) * 1000) / 10;
  const tier = [...rule.tiers].filter((t) => t.amount > 0 || t.minPct > 0).sort((a, b) => b.minPct - a.minPct).find((t) => pct >= t.minPct);
  const tierAmount = tier?.amount ?? 0;
  const excessUnits = Math.max(0, actual - rule.targetValue);
  const excessAmount = rule.excessRate > 0 ? Math.round(excessUnits * rule.excessRate) : 0;
  const amount = tierAmount + excessAmount;

  const parts = [];
  if (tier && tierAmount) parts.push(`bonus tingkat ≥${tier.minPct}% ${rupiah(tierAmount)}`);
  if (excessAmount) parts.push(`${excessUnits.toLocaleString("id-ID")} ${rule.unit} di atas target × ${rupiah(rule.excessRate)}`);
  const head = `${rule.name} ${pct.toLocaleString("id-ID")}% (${actual.toLocaleString("id-ID")}/${rule.targetValue.toLocaleString("id-ID")} ${rule.unit})`;

  return {
    achievementPct: pct,
    tierAmount,
    excessAmount,
    amount,
    explanation: parts.length ? `${head}: ${parts.join(" + ")}` : `${head}: belum mencapai tingkat bonus`,
  };
}

/** Recurring items still in force for a period. */
export function recurringFor(items: PayItem[], period: string) {
  return items.filter((i) => i.amount > 0 && (!i.untilPeriod || i.untilPeriod >= period));
}
