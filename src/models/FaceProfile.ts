import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

/**
 * An employee's enrolled face, used to verify attendance selfies.
 *
 * Kept in its own collection rather than on `Employee`, so that the biometric
 * data is never swept up by an ordinary employee read, list, export or populate.
 * Nothing here is selected unless code asks for this model by name.
 *
 * Biometric data is "data pribadi yang bersifat spesifik" under UU 27/2022
 * (Pelindungan Data Pribadi), which is why:
 * - the descriptors are encrypted at rest with the same AES-256-GCM key as NIK
 *   and NPWP, and are never sent to any client;
 * - explicit consent is recorded, with the wording version that was agreed to;
 * - only one reference photo is kept — the minimum an approver needs in order
 *   to judge a change request by eye.
 */
export interface IFaceProfile extends Document {
  employeeId: RecordId;
  /** Encrypted JSON of `number[][]`: one 128-d descriptor per enrolment photo. */
  descriptors: string;
  sampleCount: number;
  /** Storage key under `faces/<employeeId>/`. */
  referencePhoto: string;
  consentAt: Date;
  consentVersion: string;
  /** Who enrolled: the employee themself, or an approved change request. */
  source: "self" | "change_request";
  lastVerifiedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const FaceProfileSchema = new Schema<IFaceProfile>(
  {
    employeeId: { type: Schema.Types.Id, ref: "Employee", required: true, unique: true },
    descriptors: { type: String, required: true },
    sampleCount: { type: Number, required: true, min: 1 },
    referencePhoto: { type: String, required: true },
    consentAt: { type: Date, required: true },
    consentVersion: { type: String, required: true },
    source: { type: String, enum: ["self", "change_request"], default: "self" },
    lastVerifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default database.models.FaceProfile ||
  database.model<IFaceProfile>("FaceProfile", FaceProfileSchema);
