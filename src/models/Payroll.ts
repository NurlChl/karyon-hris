import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";
import type { DecisionEvidence } from "@/lib/hr/policy-evidence";

export interface IPayroll extends Document {
  decisionEvidence?: DecisionEvidence | null;
  employeeId: RecordId;
  period: string; // e.g. "2026-07"
  basicSalary: number; // Gaji Pokok (periode 1)
  incentives: number; // Insentif (periode 2)
  allowances: Array<{ name: string; amount: number }>;
  deductions: Array<{ name: string; amount: number }>;
  overtimeSalary: number;
  /** Attendance facts the slip was derived from — kept so a slip can be
   *  explained months later without recomputing from mutable source data. */
  overtimeHours: number;
  lateMinutes: number;
  absentDays: number;
  presentDays: number;
  workingDays: number;
  generatedAt?: Date;
  totalEarnings: number;
  totalDeductions: number;
  netSalary: number;
  fileUrl: string; // PDF link
  generatedBy: RecordId; // References User
  status: "draft" | "published" | "paid";
  /** "uploaded" = HR supplied a finished PDF instead of the system calculating it. */
  source: "generated" | "uploaded";
  uploadedFile: string;
  uploadedFileName: string;
  /** The target incentive as calculated, kept so the slip can explain itself later. */
  targetAchievement?: { name: string; target: number; actual: number; pct: number; amount: number; explanation: string } | null;
  /** Line-by-line explanation of how each figure was reached. */
  notes: string[];
}

const PayrollSchema = new Schema<IPayroll>(
  {
    decisionEvidence: { type: Schema.Types.Mixed, default: null },
    employeeId: { type: Schema.Types.Id, ref: "Employee", required: true, index: true },
    period: { type: String, required: true, index: true },
    basicSalary: { type: Number, default: 0 },
    incentives: { type: Number, default: 0 },
    allowances: [
      {
        name: { type: String, required: true },
        amount: { type: Number, required: true },
      }
    ],
    deductions: [
      {
        name: { type: String, required: true },
        amount: { type: Number, required: true },
      }
    ],
    overtimeSalary: { type: Number, default: 0 },
    overtimeHours: { type: Number, default: 0 },
    lateMinutes: { type: Number, default: 0 },
    absentDays: { type: Number, default: 0 },
    presentDays: { type: Number, default: 0 },
    workingDays: { type: Number, default: 0 },
    generatedAt: { type: Date, default: Date.now },
    totalEarnings: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    netSalary: { type: Number, default: 0 },
    fileUrl: { type: String, default: "" },
    source: { type: String, enum: ["generated", "uploaded"], default: "generated" },
    uploadedFile: { type: String, default: "" },
    uploadedFileName: { type: String, default: "" },
    targetAchievement: { type: Schema.Types.Mixed, default: null },
    notes: { type: [String], default: [] },
    generatedBy: { type: Schema.Types.Id, ref: "User", required: true },
    status: { 
      type: String, 
      enum: ["draft", "published", "paid"], 
      default: "draft",
      required: true,
      index: true
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to guarantee one payroll record per employee per period
PayrollSchema.index({ employeeId: 1, period: 1 }, { unique: true });

export default database.models.Payroll || database.model<IPayroll>("Payroll", PayrollSchema);
