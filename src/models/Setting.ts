import database, { Schema, Document } from "@/lib/postgres";

export interface ISetting extends Document {
  key: string;
  value: unknown;
  description?: string;
}

const SettingSchema = new Schema<ISetting>({
  key: { type: String, required: true, unique: true, index: true },
  value: { type: Schema.Types.Mixed, required: true },
  description: { type: String },
});

export default database.models.Setting || database.model<ISetting>("Setting", SettingSchema);
