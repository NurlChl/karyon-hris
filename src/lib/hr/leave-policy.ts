/**
 * How a leave type is limited, in one place for the API, the portal form and the
 * admin screen.
 *
 * - `annual`: a yearly balance (Cuti Tahunan). Each request spends days from it.
 * - `per_event`: a limit per occurrence (menikah, keluarga meninggal, melahirkan).
 *   Each request may be up to `quotaDays` long and may be filed again whenever it
 *   happens again, optionally capped by `maxEventsPerYear`.
 * - `none`: no quota (izin sakit with a doctor's note, WFH). Only the optional
 *   per-request maximum applies.
 */

export type LeaveQuotaMode = "annual" | "per_event" | "none";

export interface LeavePolicyFields {
  name?: string;
  quotaMode?: LeaveQuotaMode | null;
  quotaDays: number;
  deductsBalance?: boolean;
  maxConsecutiveDays?: number;
  maxEventsPerYear?: number;
  isOther?: boolean;
}

/** Types stored before quota modes existed carry no mode; infer the same rules they had. */
export function quotaModeOf(t: LeavePolicyFields): LeaveQuotaMode {
  if (t.quotaMode === "annual" || t.quotaMode === "per_event" || t.quotaMode === "none") return t.quotaMode;
  return t.deductsBalance ? "annual" : "none";
}

/** Longest single request allowed, 0 = unlimited. */
export function perRequestLimit(t: LeavePolicyFields): number {
  const mode = quotaModeOf(t);
  if (mode === "per_event") return t.quotaDays;
  return t.maxConsecutiveDays ?? 0;
}

/** One sentence an employee can read: how much, and how often. */
export function describeQuota(t: LeavePolicyFields): string {
  const mode = quotaModeOf(t);
  if (mode === "annual") {
    return `Saldo ${t.quotaDays} hari per tahun. Setiap pengajuan memotong saldo ini.` +
      (t.maxConsecutiveDays ? ` Maksimal ${t.maxConsecutiveDays} hari per pengajuan.` : "");
  }
  if (mode === "per_event") {
    const cap = t.maxEventsPerYear
      ? ` Dapat diajukan hingga ${t.maxEventsPerYear} kali dalam setahun.`
      : " Dapat diajukan lagi setiap kali peristiwanya terjadi, tanpa batas jumlah per tahun.";
    return `Maksimal ${t.quotaDays} hari setiap kali terjadi, tidak memotong saldo cuti tahunan.${cap}`;
  }
  return (
    "Tidak memotong saldo dan tidak dibatasi kuota tahunan." +
    (t.maxConsecutiveDays ? ` Maksimal ${t.maxConsecutiveDays} hari per pengajuan.` : "")
  );
}

export const QUOTA_MODE_LABELS: Record<LeaveQuotaMode, string> = {
  annual: "Saldo tahunan",
  per_event: "Per kejadian",
  none: "Tanpa kuota",
};
