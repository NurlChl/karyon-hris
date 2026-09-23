import database, { Schema, Document } from "@/lib/postgres";

export interface IApprovalFlow extends Document {
  transactionType: "leave" | "correction" | "holiday_swap" | "contract" | "face_change";
  steps: Array<{
    stepNumber: number;
    approverRole: string; // e.g. 'SPV', 'HRD', 'AUDIT', 'DIREKSI'
    isMandatory: boolean;
  }>;
}

const ApprovalFlowSchema = new Schema<IApprovalFlow>({
  transactionType: { 
    type: String, 
    enum: ["leave", "correction", "holiday_swap", "contract", "face_change"], 
    required: true, 
    unique: true, 
    index: true 
  },
  steps: [
    {
      stepNumber: { type: Number, required: true },
      approverRole: { type: String, required: true },
      isMandatory: { type: Boolean, default: true },
    }
  ],
});

export default database.models.ApprovalFlow || database.model<IApprovalFlow>("ApprovalFlow", ApprovalFlowSchema);
