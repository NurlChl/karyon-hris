import database, { Schema, Document } from "@/lib/postgres";

export interface IRole extends Document {
  name: string; // e.g. SUPERADMIN, HRD, SPV, STAFF, AUDIT, GA
  isSystemDefault: boolean;
}

const RoleSchema = new Schema<IRole>({
  name: { type: String, required: true, unique: true, index: true },
  isSystemDefault: { type: Boolean, default: false },
});

export default database.models.Role || database.model<IRole>("Role", RoleSchema);
