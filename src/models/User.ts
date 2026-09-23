import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";
import "./Role"; // Force-load Role model registration
import "./Employee"; // Force-load Employee model registration

export interface IUser extends Document {
  email: string;
  phone?: string;
  passwordHash: string | null;
  roleId: RecordId;
  employeeId: RecordId | null; // Null for superadmin accounts that aren't tied to an employee
  is2faEnabled: boolean;
  twoFactorSecret?: string;
  googleId?: string;
  /** Set when HRD creates the account with a shared default password. */
  mustChangePassword: boolean;
  /** Consecutive failed sign-ins; reset on success. */
  failedLoginAttempts: number;
  /** While in the future, `authorize` refuses the account regardless of password. */
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  isActive: boolean;
}

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, default: "" },
    passwordHash: { type: String, default: null },
    roleId: { type: Schema.Types.Id, ref: "Role", required: true, index: true },
    employeeId: { type: Schema.Types.Id, ref: "Employee", default: null, index: true },
    is2faEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String },
    googleId: { type: String, unique: true, sparse: true },
    mustChangePassword: { type: Boolean, default: false },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

export default database.models.User || database.model<IUser>("User", UserSchema);
