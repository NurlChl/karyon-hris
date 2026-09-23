import database, { Schema, Document } from "@/lib/postgres";

export interface ILeaveType extends Document {
  name: string; // e.g. "Cuti Tahunan", "Izin Sakit", "Cuti Melahirkan"
  /** Short explanation shown under the option on the request form. */
  description: string;
  quotaDays: number;
  accrualMode: "prorata" | "flat";
  carryOverMaxDays: number;
  requiresEvidence: boolean;
  minLeadDays: number;
  /** Longest single request allowed; 0 = no limit. */
  maxConsecutiveDays: number;
  /** Deducts from the employee's annual balance. Unpaid/sick leave may not. */
  deductsBalance: boolean;
  /**
   * How the quota is counted; see lib/hr/leave-policy.ts. Missing on types
   * created before this existed, which are read as annual/none from
   * `deductsBalance`.
   */
  quotaMode?: "annual" | "per_event" | "none";
  /** `per_event` only: how many times a year it may be taken, 0 = unlimited. */
  maxEventsPerYear: number;
  /** A catch-all type whose purpose the employee writes in. */
  isOther: boolean;
  sortOrder: number;
  /** Lets the holder clock in outside the office radius (WFH / dinas luar). */
  allowsRemoteAttendance: boolean;
  /** Restricts the type to one gender, e.g. maternity leave. */
  genderRestriction: "any" | "male" | "female";
  isActive: boolean;
  /** Tailwind-free token name used to colour the badge in the UI. */
  colorTone: "primary" | "success" | "warning" | "danger" | "info" | "neutral";
}

const LeaveTypeSchema = new Schema<ILeaveType>(
  {
    name: { type: String, required: true, unique: true, index: true, trim: true },
    description: { type: String, default: "" },
    quotaDays: { type: Number, default: 12, required: true, min: 0 },
    accrualMode: { type: String, enum: ["prorata", "flat"], default: "flat", required: true },
    carryOverMaxDays: { type: Number, default: 0, required: true, min: 0 },
    requiresEvidence: { type: Boolean, default: false, required: true },
    minLeadDays: { type: Number, default: 0, required: true, min: 0 },
    maxConsecutiveDays: { type: Number, default: 0, min: 0 },
    deductsBalance: { type: Boolean, default: true },
    quotaMode: { type: String, enum: ["annual", "per_event", "none"] },
    maxEventsPerYear: { type: Number, default: 0, min: 0 },
    isOther: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 100 },
    allowsRemoteAttendance: { type: Boolean, default: false },
    genderRestriction: { type: String, enum: ["any", "male", "female"], default: "any" },
    isActive: { type: Boolean, default: true, index: true },
    colorTone: {
      type: String,
      enum: ["primary", "success", "warning", "danger", "info", "neutral"],
      default: "primary",
    },
  },
  { timestamps: true }
);

export default database.models.LeaveType ||
  database.model<ILeaveType>("LeaveType", LeaveTypeSchema);
