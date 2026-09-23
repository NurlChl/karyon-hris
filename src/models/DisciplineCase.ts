import { RecordId } from "@/lib/postgres";
import database, { Schema } from "@/lib/postgres";
import { DISCIPLINE_ACTIONS } from "@/lib/hr/discipline";
const schema = new Schema({
  employeeId: { type: Schema.Types.Id, ref: "Employee", required: true, index: true },
  sourceKey: { type: String, unique: true, sparse: true },
  category: { type: String, enum: ["attendance", "misconduct", "fatal", "separation"], required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  evidence: { type: String, default: "" },
  employeeStatement: { type: String, default: "" },
  action: { type: String, enum: DISCIPLINE_ACTIONS, required: true },
  status: { type: String, enum: ["open", "issued", "rejected", "closed"], default: "open", index: true },
  occurredAt: { type: Date, required: true },
  effectiveAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  createdBy: { type: Schema.Types.Id, ref: "User", required: true },
  revision: { type: Number, default: 0 },
  snapshot: { type: Schema.Types.Mixed, default: null },
  history: [{ actorId: { type: Schema.Types.Id, ref: "User", required: true }, status: String, note: String, at: { type: Date, default: Date.now } }],
}, { timestamps: true });
schema.index({ employeeId: 1, createdAt: -1 });
export default database.models.DisciplineCase || database.model("DisciplineCase", schema);
