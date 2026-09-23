/**
 * KPI vocabulary and scoring maths.
 *
 * Deliberately free of database imports. These values are needed by both the
 * schemas and the React components that render forms from them, and a model file
 * cannot be imported from a client component — doing so pulls the whole driver
 * into the browser bundle, where server-only dependencies cannot execute.
 */

export type ScoreMode = "scale_5" | "scale_10" | "percent";
export type PeriodType = "monthly" | "quarterly" | "semester" | "yearly";
export type EvaluationStatus = "draft" | "submitted" | "acknowledged" | "finalized";

export interface KpiIndicatorShape {
  key: string;
  name: string;
  description: string;
  target: string;
  weight: number;
}

export interface KpiAspectShape {
  key: string;
  name: string;
  description: string;
  weight: number;
  indicators: KpiIndicatorShape[];
}

export interface KpiScoreShape {
  aspectKey: string;
  aspectName: string;
  aspectWeight: number;
  indicatorKey: string;
  indicatorName: string;
  indicatorWeight: number;
  rawScore: number;
  score: number;
  selfScore?: number | null;
  note: string;
}

export const SCORE_MODE_MAX: Record<ScoreMode, number> = {
  scale_5: 5,
  scale_10: 10,
  percent: 100,
};

export const SCORE_MODE_LABELS: Record<ScoreMode, string> = {
  scale_5: "Skala 1–5",
  scale_10: "Skala 1–10",
  percent: "Persentase 0–100",
};

export const PERIOD_TYPE_LABELS: Record<string, string> = {
  monthly: "Bulanan",
  quarterly: "Triwulanan",
  semester: "Semesteran",
  yearly: "Tahunan",
};

export const RECOMMENDATION_LABELS: Record<string, string> = {
  promote: "Layak dipromosikan",
  retain: "Pertahankan di posisi saat ini",
  monitor: "Perlu pemantauan berkala",
  improve: "Perlu rencana perbaikan",
  none: "Belum ada rekomendasi",
};

export const EVALUATION_STATUS_LABELS: Record<EvaluationStatus, string> = {
  draft: "Draf",
  submitted: "Menunggu tanggapan",
  acknowledged: "Sudah ditanggapi",
  finalized: "Final",
};

/** Default grade bands, used when a template does not define its own. */
export const DEFAULT_GRADES = [
  { min: 90, label: "Sangat Baik", tone: "success" },
  { min: 75, label: "Baik", tone: "primary" },
  { min: 60, label: "Cukup", tone: "warning" },
  { min: 0, label: "Perlu Perbaikan", tone: "danger" },
];

/** Total indicator count across all aspects. */
export function countIndicators(t: { aspects?: KpiAspectShape[] }): number {
  return (t.aspects ?? []).reduce((n, a) => n + (a.indicators?.length ?? 0), 0);
}

/**
 * Checks that aspect weights sum to 100 and that each aspect's indicators do
 * the same. Returns every problem rather than throwing on the first, so the
 * form can show them all at once instead of one per save attempt.
 */
export function validateWeights(aspects: KpiAspectShape[]): string[] {
  const problems: string[] = [];
  if (!aspects.length) {
    problems.push("Template harus memiliki minimal satu aspek penilaian.");
    return problems;
  }

  const aspectTotal = aspects.reduce((n, a) => n + (a.weight || 0), 0);
  if (Math.round(aspectTotal) !== 100) {
    problems.push(`Total bobot aspek harus 100%. Saat ini ${aspectTotal}%.`);
  }

  for (const aspect of aspects) {
    if (!aspect.indicators?.length) {
      problems.push(`Aspek "${aspect.name}" belum memiliki indikator.`);
      continue;
    }
    const indicatorTotal = aspect.indicators.reduce((n, i) => n + (i.weight || 0), 0);
    if (Math.round(indicatorTotal) !== 100) {
      problems.push(
        `Total bobot indikator pada aspek "${aspect.name}" harus 100%. Saat ini ${indicatorTotal}%.`
      );
    }
  }

  return problems;
}

/** Maps a 0–100 final score to its grade band. */
export function gradeFor(
  score: number,
  grades: Array<{ min: number; label: string; tone: string }> = DEFAULT_GRADES
) {
  const sorted = [...grades].sort((a, b) => b.min - a.min);
  return sorted.find((g) => score >= g.min) ?? sorted[sorted.length - 1];
}

/**
 * Rolls scores up to a single 0–100 figure.
 *
 * Aspect weight × indicator weight, both percentages, so an indicator worth 50%
 * of an aspect worth 40% contributes 20% of the final score. Renormalising by
 * the actual weight sum keeps a partially filled form readable instead of
 * reporting an artificially low score.
 */
export function computeFinalScore(scores: KpiScoreShape[]): number {
  let total = 0;
  let weightSum = 0;
  for (const s of scores) {
    const w = ((s.aspectWeight || 0) / 100) * ((s.indicatorWeight || 0) / 100);
    if (w <= 0) continue;
    total += (s.score || 0) * w;
    weightSum += w;
  }
  if (weightSum <= 0) return 0;
  return Math.round((total / weightSum) * 100) / 100;
}

/** Converts a raw entry in the template's scale to the stored 0–100 value. */
export function normaliseScore(raw: number, max: number): number {
  if (!Number.isFinite(raw) || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((raw / max) * 10000) / 100));
}
