import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

export interface IComplaint extends Document {
  /**
   * Visible reporter. Null for anonymous reports — this is the field that gets
   * populated into responses.
   */
  employeeId: RecordId | null;
  /**
   * Real reporter, always recorded, never returned to an SPV.
   *
   * The spec asks for anonymity *towards the supervisor* while keeping
   * accountability: without this, an anonymous report was untraceable even for
   * HRD/Audit, which makes the feature abusable and leaves the reporter unable
   * to follow their own case.
   */
  reporterId: RecordId | null;
  isAnonymous: boolean;
  target: "spv" | "hrd" | "direksi";
  category: "etik" | "pelecehan" | "keselamatan" | "fasilitas" | "atasan" | "lainnya";
  subject: string;
  description: string;
  attachments: string;
  /** Short code the reporter can quote when following up. */
  ticketCode: string;
  status: "received" | "in_progress" | "resolved" | "rejected";
  /** Follow-up trail written by the handler. */
  responses: Array<{
    userId: RecordId;
    message: string;
    createdAt: Date;
    /** Internal notes are never shown to the reporter. */
    isInternal: boolean;
  }>;
  handledBy?: RecordId;
  resolvedAt?: Date;
  createdAt: Date;
}

const ComplaintSchema = new Schema<IComplaint>(
  {
    employeeId: { type: Schema.Types.Id, ref: "Employee", default: null },
    reporterId: { type: Schema.Types.Id, ref: "Employee", default: null, index: true },
    isAnonymous: { type: Boolean, default: false, required: true },
    target: { type: String, enum: ["spv", "hrd", "direksi"], required: true, index: true },
    category: {
      type: String,
      enum: ["etik", "pelecehan", "keselamatan", "fasilitas", "atasan", "lainnya"],
      default: "lainnya",
      index: true,
    },
    subject: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    attachments: { type: String, default: "" },
    ticketCode: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["received", "in_progress", "resolved", "rejected"],
      default: "received",
      required: true,
      index: true,
    },
    responses: [
      {
        userId: { type: Schema.Types.Id, ref: "User", required: true },
        message: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
        isInternal: { type: Boolean, default: false },
      },
    ],
    handledBy: { type: Schema.Types.Id, ref: "User" },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

export default database.models.Complaint ||
  database.model<IComplaint>("Complaint", ComplaintSchema);
