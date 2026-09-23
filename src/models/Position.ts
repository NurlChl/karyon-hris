import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

export interface IPosition extends Document {
  name: string;
  divisionId?: RecordId | null;
  description?: string;
  jobdesk?: string;
  requirements?: string;
  location?: string;
  type?: string;
  status?: "active" | "inactive";
}

const PositionSchema = new Schema<IPosition>({
  name: { type: String, required: true, unique: true, index: true },
  divisionId: { type: Schema.Types.Id, ref: "Division", default: null },
  description: { type: String, default: "" },
  jobdesk: { type: String, default: "" },
  requirements: { type: String, default: "" },
  location: { type: String, default: "Jakarta" },
  type: { type: String, default: "Full-Time" },
  status: { type: String, enum: ["active", "inactive"], default: "active", index: true }
});

export default database.models.Position || database.model<IPosition>("Position", PositionSchema);
