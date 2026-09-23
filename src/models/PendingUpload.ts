import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

/**
 * A file uploaded ahead of the form that will use it.
 *
 * Files are sent one at a time as they are picked, so a form with a CV and
 * several certificates shows progress per file and never sends one enormous
 * request. The form then submits only the token. Until a form claims it, the
 * upload belongs to nobody: it expires on its own, and the daily job removes
 * the file.
 */
export interface IPendingUpload extends Document {
  /** 40 hex characters; the only handle the client ever holds. */
  token: string;
  key: string;
  name: string;
  mime: string;
  size: number;
  context: string;
  /** Null for anonymous uploads from the public career page. */
  ownerUserId?: RecordId | null;
  /** Public uploads are tied to the vacancy they were made for. */
  scope?: string;
  claimedAt?: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

const PendingUploadSchema = new Schema<IPendingUpload>(
  {
    token: { type: String, required: true, unique: true },
    key: { type: String, required: true },
    name: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    context: { type: String, required: true },
    ownerUserId: { type: Schema.Types.Id, ref: "User", default: null },
    scope: { type: String, default: "" },
    claimedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default database.models.PendingUpload ||
  database.model<IPendingUpload>("PendingUpload", PendingUploadSchema);
