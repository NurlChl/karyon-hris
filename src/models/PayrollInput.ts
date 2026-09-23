import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

/** One-off inputs for one employee's payslip in one period: bonuses, deductions, target achieved. */
export interface IPayrollInput extends Document {
  employeeId: RecordId;
  period: string;
  adjustments: Array<{ kind: "earning" | "deduction"; name: string; amount: number; note?: string }>;
  /** What was achieved against the profile's target, null = not entered yet. */
  targetActual: number | null;
  targetNote: string;
  updatedBy?: RecordId | null;
}

const PayrollInputSchema = new Schema<IPayrollInput>(
  {
    employeeId: { type: Schema.Types.Id, ref: "Employee", required: true },
    period: { type: String, required: true },
    adjustments: {
      type: [
        {
          _id: false,
          kind: { type: String, enum: ["earning", "deduction"], required: true },
          name: { type: String, required: true, trim: true },
          amount: { type: Number, required: true, min: 0 },
          note: { type: String, default: "" },
        },
      ],
      default: [],
    },
    targetActual: { type: Number, default: null },
    targetNote: { type: String, default: "" },
    updatedBy: { type: Schema.Types.Id, ref: "User", default: null },
  },
  { timestamps: true }
);

PayrollInputSchema.index({ employeeId: 1, period: 1 }, { unique: true });

export default database.models.PayrollInput || database.model<IPayrollInput>("PayrollInput", PayrollInputSchema);
