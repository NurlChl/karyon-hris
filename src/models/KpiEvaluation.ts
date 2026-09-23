import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";
import type { EvaluationStatus, KpiScoreShape } from "@/lib/hr/kpi";

/**
 * One filled-in appraisal.
 *
 * The document carries a **snapshot** of the template's structure (aspect and
 * indicator names, weights, and the score mode) rather than only referencing the
 * template. Templates get edited between cycles, and an appraisal that silently
 * changed shape a year after it was signed would be worthless as a record.
 *
 * Status flow:
 *   draft        supervisor is still filling it in; invisible to the employee
 *   submitted    sent to the employee, who can read it and respond
 *   acknowledged employee has seen it and optionally left a comment
 *   finalized    HR has locked it; no further edits, appears in history
 * A supervisor can also return a submitted appraisal to draft before the
 * employee acknowledges it, which is the only backwards transition allowed.
 *
 * Status labels and the scoring maths live in lib/hr/kpi, which the portal and
 * admin pages import directly instead of reaching into this model.
 */

export type { EvaluationStatus };
export type IKpiScore = KpiScoreShape;

export interface IKpiEvaluation extends Document {
  employeeId: RecordId;
  /** Null for an appraisal supplied as an uploaded PDF. */
  templateId?: RecordId | null;
  /** "uploaded" = HR attached a finished appraisal document instead of filling the form. */
  source: "form" | "uploaded";
  title: string;
  uploadedFile: string;
  uploadedFileName: string;
  /** 2026-07, 2026-Q3, 2026-S1, or 2026 depending on the period type. */
  period: string;
  periodType: string;
  scoreMode: string;

  scores: KpiScoreShape[];
  /** Weighted 0–100 roll-up across aspects. */
  finalScore: number;
  gradeLabel: string;

  strengths: string;
  improvements: string;
  /** Free-text development plan agreed with the employee. */
  developmentPlan: string;
  recommendation: "promote" | "retain" | "monitor" | "improve" | "none";
  notes: string;

  status: EvaluationStatus;
  evaluatorId: RecordId;
  submittedAt?: Date | null;
  acknowledgedAt?: Date | null;
  employeeComment: string;
  finalizedBy?: RecordId | null;
  finalizedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const ScoreSchema = new Schema<KpiScoreShape>(
  {
    aspectKey: { type: String, required: true },
    aspectName: { type: String, required: true },
    aspectWeight: { type: Number, required: true },
    indicatorKey: { type: String, required: true },
    indicatorName: { type: String, required: true },
    indicatorWeight: { type: Number, required: true },
    // Raw value as entered, in the template's score mode.
    rawScore: { type: Number, required: true },
    // Normalised to 0–100 so aggregation never depends on the input scale.
    score: { type: Number, required: true, min: 0, max: 100 },
    // Optional score the employee gave themselves, same normalisation.
    selfScore: { type: Number, default: null },
    note: { type: String, default: "" },
  },
  { _id: false }
);

const KpiEvaluationSchema = new Schema<IKpiEvaluation>(
  {
    employeeId: { type: Schema.Types.Id, ref: "Employee", required: true, index: true },
    templateId: { type: Schema.Types.Id, ref: "KpiTemplate", default: null },
    source: { type: String, enum: ["form", "uploaded"], default: "form" },
    title: { type: String, default: "" },
    uploadedFile: { type: String, default: "" },
    uploadedFileName: { type: String, default: "" },
    period: { type: String, required: true, index: true },
    periodType: { type: String, default: "quarterly" },
    scoreMode: { type: String, default: "scale_5" },

    scores: { type: [ScoreSchema], default: [] },
    finalScore: { type: Number, default: 0, min: 0, max: 100 },
    gradeLabel: { type: String, default: "" },

    strengths: { type: String, default: "" },
    improvements: { type: String, default: "" },
    developmentPlan: { type: String, default: "" },
    recommendation: {
      type: String,
      enum: ["promote", "retain", "monitor", "improve", "none"],
      default: "none",
    },
    notes: { type: String, default: "" },

    status: {
      type: String,
      enum: ["draft", "submitted", "acknowledged", "finalized"],
      default: "draft",
      index: true,
    },
    evaluatorId: { type: Schema.Types.Id, ref: "User", required: true },
    submittedAt: { type: Date, default: null },
    acknowledgedAt: { type: Date, default: null },
    employeeComment: { type: String, default: "" },
    finalizedBy: { type: Schema.Types.Id, ref: "User", default: null },
    finalizedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One appraisal per employee per period per template.
KpiEvaluationSchema.index({ employeeId: 1, period: 1, templateId: 1 }, { unique: true });
// Backs the "my appraisals" list in the portal and the admin history view.
KpiEvaluationSchema.index({ employeeId: 1, status: 1, period: -1 });

export default database.models.KpiEvaluation ||
  database.model<IKpiEvaluation>("KpiEvaluation", KpiEvaluationSchema);
