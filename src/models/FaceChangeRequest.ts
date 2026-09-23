import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

/**
 * A request to replace an employee's enrolled face.
 *
 * Replacing the face that attendance is checked against is exactly how buddy
 * punching would be set up — enrol a colleague's face, then let them clock in
 * for you — so it goes through the approval engine. Until a decision is made
 * the existing profile stays in force; the new descriptors live only here.
 */
export interface IFaceChangeRequest extends Document {
  employeeId: RecordId;
  /** Encrypted JSON of `number[][]`, same format as `FaceProfile.descriptors`.
   *  Emptied once the request is rejected or cancelled. */
  descriptors: string;
  sampleCount: number;
  referencePhoto: string;
  /** Distance from the new samples to the current profile, shown to the
   *  approver: a large value means the new face is not the enrolled person. */
  distanceToCurrent: number | null;
  reason: string;
  consentAt: Date;
  consentVersion: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  approvalInstanceId?: RecordId | null;
  decidedAt?: Date | null;
  decisionNote: string;
  createdAt: Date;
  updatedAt: Date;
}

const FaceChangeRequestSchema = new Schema<IFaceChangeRequest>(
  {
    employeeId: { type: Schema.Types.Id, ref: "Employee", required: true, index: true },
    descriptors: { type: String, default: "" },
    sampleCount: { type: Number, required: true, min: 1 },
    referencePhoto: { type: String, required: true },
    distanceToCurrent: { type: Number, default: null },
    reason: { type: String, required: true, trim: true },
    consentAt: { type: Date, required: true },
    consentVersion: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
      index: true,
    },
    approvalInstanceId: { type: Schema.Types.Id, ref: "ApprovalInstance", default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: "" },
  },
  { timestamps: true }
);

// At most one open request per employee: a second would race the first to
// replace the same profile.
FaceChangeRequestSchema.index(
  { employeeId: 1 },
  { unique: true, partialFilterExpression: { status: "pending" }, name: "one_pending_per_employee" }
);

export default database.models.FaceChangeRequest ||
  database.model<IFaceChangeRequest>("FaceChangeRequest", FaceChangeRequestSchema);
