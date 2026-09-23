import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

/**
 * How one employee is paid beyond the contract's basic salary: fixed monthly
 * additions and deductions, whether overtime is paid, and a sales-style target
 * incentive. See lib/hr/pay-rules.ts.
 */
export interface IPayProfile extends Document {
  employeeId: RecordId;
  overtimeMode: "company_rate" | "custom_rate" | "none";
  overtimeRate: number;
  exemptLatePenalty: boolean;
  exemptAbsentPenalty: boolean;
  recurring: Array<{ kind: "earning" | "deduction"; name: string; amount: number; note?: string; untilPeriod?: string }>;
  target: {
    enabled: boolean;
    name: string;
    unit: string;
    targetValue: number;
    tiers: Array<{ minPct: number; amount: number }>;
    excessRate: number;
    note: string;
  };
  updatedBy?: RecordId | null;
}

const itemSchema = new Schema(
  {
    kind: { type: String, enum: ["earning", "deduction"], required: true },
    name: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, default: "" },
    untilPeriod: { type: String, default: "" },
  },
  { _id: false }
);

const PayProfileSchema = new Schema<IPayProfile>(
  {
    employeeId: { type: Schema.Types.Id, ref: "Employee", required: true, unique: true },
    overtimeMode: { type: String, enum: ["company_rate", "custom_rate", "none"], default: "company_rate" },
    overtimeRate: { type: Number, default: 0, min: 0 },
    exemptLatePenalty: { type: Boolean, default: false },
    exemptAbsentPenalty: { type: Boolean, default: false },
    recurring: { type: [itemSchema], default: [] },
    target: {
      enabled: { type: Boolean, default: false },
      name: { type: String, default: "Target penjualan" },
      unit: { type: String, default: "unit" },
      targetValue: { type: Number, default: 0, min: 0 },
      tiers: { type: [{ _id: false, minPct: Number, amount: Number }], default: [] },
      excessRate: { type: Number, default: 0, min: 0 },
      note: { type: String, default: "" },
    },
    updatedBy: { type: Schema.Types.Id, ref: "User", default: null },
  },
  { timestamps: true }
);

export default database.models.PayProfile || database.model<IPayProfile>("PayProfile", PayProfileSchema);
