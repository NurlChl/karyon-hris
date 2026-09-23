import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";
import {
  DEFAULT_GRADES,
  type KpiAspectShape,
  type KpiIndicatorShape,
  type PeriodType,
  type ScoreMode,
} from "@/lib/hr/kpi";

/**
 * A KPI form definition.
 *
 * Indicators are nested inside *aspects* (groups) rather than sitting in one
 * flat list, because that is how appraisal forms are actually written: a
 * "Kualitas Kerja" aspect worth 40% containing three indicators, and so on.
 * Each aspect carries its own weight and the indicators inside it are weighted
 * relative to that aspect, so changing one aspect's weight does not force the
 * whole form to be re-balanced.
 *
 * Labels, scale limits and the weight/score maths live in lib/hr/kpi so the
 * template builder — a client component — can use them without importing
 * Mongoose into the browser bundle.
 */

export type { ScoreMode };
export type IKpiIndicator = KpiIndicatorShape;
export type IKpiAspect = KpiAspectShape;

export interface IKpiTemplate extends Document {
  name: string;
  description: string;
  /** How often this form is filled in. Drives the period picker. */
  periodType: PeriodType;
  /** Input scale the evaluator sees; scores are normalised to 0–100 on save. */
  scoreMode: ScoreMode;
  aspects: KpiAspectShape[];
  /** Empty arrays mean "applies to everyone". */
  divisionIds: RecordId[];
  positionIds: RecordId[];
  /** Grade bands used to turn a final score into a letter/label. */
  grades: Array<{ min: number; label: string; tone: string }>;
  /** Lets the employee fill their own column before the supervisor scores. */
  allowSelfAssessment: boolean;
  /** Letterhead on the printed appraisal. Inlined for the same reason as the
   *  payslip logo: a print job must not wait on a network fetch. */
  showLogo: boolean;
  logoUrl: string;
  /** Printed height in millimetres. */
  logoHeight: number;
  isActive: boolean;
  createdBy?: RecordId;
  createdAt: Date;
  updatedAt: Date;
}

const IndicatorSchema = new Schema<KpiIndicatorShape>(
  {
    // Stable id so an evaluation keeps pointing at the right indicator even
    // after the template is edited and names change.
    key: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    // What "good" looks like, shown to the evaluator as guidance.
    target: { type: String, default: "" },
    // Weight within the parent aspect, as a percentage summing to 100.
    weight: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false }
);

const AspectSchema = new Schema<KpiAspectShape>(
  {
    key: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    // Weight in the final score, summing to 100 across aspects.
    weight: { type: Number, required: true, min: 0, max: 100 },
    indicators: { type: [IndicatorSchema], default: [] },
  },
  { _id: false }
);

const KpiTemplateSchema = new Schema<IKpiTemplate>(
  {
    name: { type: String, required: true, trim: true, index: true },
    description: { type: String, default: "" },
    periodType: {
      type: String,
      enum: ["monthly", "quarterly", "semester", "yearly"],
      default: "quarterly",
    },
    scoreMode: { type: String, enum: ["scale_5", "scale_10", "percent"], default: "scale_5" },
    aspects: { type: [AspectSchema], default: [] },
    divisionIds: [{ type: Schema.Types.Id, ref: "Division" }],
    positionIds: [{ type: Schema.Types.Id, ref: "Position" }],
    grades: {
      type: [{ min: Number, label: String, tone: String }],
      default: DEFAULT_GRADES,
    },
    allowSelfAssessment: { type: Boolean, default: false },
    showLogo: { type: Boolean, default: false },
    logoUrl: { type: String, default: "" },
    logoHeight: { type: Number, default: 14, min: 6, max: 40 },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.Id, ref: "User" },
  },
  { timestamps: true }
);

export default database.models.KpiTemplate ||
  database.model<IKpiTemplate>("KpiTemplate", KpiTemplateSchema);
