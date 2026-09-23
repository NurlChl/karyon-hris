import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

export interface IApprovalInstance extends Document {
  refType: "leave" | "correction" | "holiday_swap" | "face_change";
  refId: RecordId;
  /** Requester and their division at submission; older instances lack them. */
  employeeId?: RecordId | null;
  divisionId?: RecordId | null;
  currentStep: number; // 1-indexed active step
  status: "pending" | "approved" | "rejected";
  stepsStatus: Array<{
    stepNumber: number;
    approverRole: string;
    status: "pending" | "approved" | "rejected";
    actionedBy?: RecordId;
    actionedAt?: Date;
    comment?: string;
  }>;
  history: Array<{
    action: string; // e.g. 'SUBMITTED', 'APPROVED', 'REJECTED'
    userId: RecordId;
    timestamp: Date;
    comment?: string;
  }>;
}

const ApprovalInstanceSchema = new Schema<IApprovalInstance>(
  {
    refType: { type: String, enum: ["leave", "correction", "holiday_swap", "face_change"], required: true, index: true },
    refId: { type: Schema.Types.Id, required: true, index: true },
    employeeId: { type: Schema.Types.Id, ref: "Employee", default: null, index: true },
    divisionId: { type: Schema.Types.Id, ref: "Division", default: null, index: true },
    currentStep: { type: Number, default: 1, required: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
    stepsStatus: [
      {
        stepNumber: { type: Number, required: true },
        approverRole: { type: String, required: true },
        status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
        actionedBy: { type: Schema.Types.Id, ref: "User" },
        actionedAt: { type: Date },
        comment: { type: String },
      }
    ],
    history: [
      {
        action: { type: String, required: true },
        userId: { type: Schema.Types.Id, ref: "User", required: true },
        timestamp: { type: Date, default: Date.now },
        comment: { type: String },
      }
    ],
  },
  {
    timestamps: true,
  }
);

export default database.models.ApprovalInstance || database.model<IApprovalInstance>("ApprovalInstance", ApprovalInstanceSchema);
