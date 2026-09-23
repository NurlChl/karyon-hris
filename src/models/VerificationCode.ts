import database, { Schema, Document } from "@/lib/postgres";

export interface IVerificationCode extends Document {
  email: string;
  /** SHA-256 of the code — the plaintext OTP is only ever in the email. */
  codeHash: string;
  purpose: "reset_password" | "change_password";
  expires: Date;
  /** Wrong guesses so far; the code is burned once this hits the cap. */
  attempts: number;
}

const VerificationCodeSchema = new Schema<IVerificationCode>(
  {
    email: { type: String, required: true, index: true, lowercase: true, trim: true },
    codeHash: { type: String, required: true },
    purpose: {
      type: String,
      enum: ["reset_password", "change_password"],
      required: true,
    },
    expires: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Mongo removes the document the moment it expires, so a stale code can never
// be replayed even if the application forgets to clean up.
VerificationCodeSchema.index({ expires: 1 }, { expireAfterSeconds: 0 });
VerificationCodeSchema.index({ email: 1, purpose: 1 }, { unique: true });

export default database.models.VerificationCode ||
  database.model<IVerificationCode>("VerificationCode", VerificationCodeSchema);
