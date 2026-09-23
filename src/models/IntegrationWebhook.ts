import { RecordId } from "@/lib/postgres";
import database, { Schema, type InferSchemaType } from "@/lib/postgres";
const schema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  urlEncrypted: { type: String, required: true },
  secretEncrypted: { type: String, required: true },
  events: [{ type: String, required: true }],
  enabled: { type: Boolean, default: true },
  lastDeliveryAt: Date,
  lastStatus: Number,
  lastError: { type: String, maxlength: 300 },
  createdBy: { type: Schema.Types.Id, ref: "User", required: true },
}, { timestamps: true });
export type IntegrationWebhookDocument = InferSchemaType<typeof schema>;
export default database.models.IntegrationWebhook || database.model("IntegrationWebhook", schema);
