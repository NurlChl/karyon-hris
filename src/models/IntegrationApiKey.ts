import { RecordId } from "@/lib/postgres";
import database, { Schema } from "@/lib/postgres";
const schema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  keyHash: { type: String, required: true, unique: true, index: true },
  keyHint: { type: String, required: true },
  scopes: [{ type: String, enum: ["employees.read"], required: true }],
  enabled: { type: Boolean, default: true },
  lastUsedAt: Date,
  createdBy: { type: Schema.Types.Id, ref: "User", required: true },
}, { timestamps: true });
export default database.models.IntegrationApiKey || database.model("IntegrationApiKey", schema);
