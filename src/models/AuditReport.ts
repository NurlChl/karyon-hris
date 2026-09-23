import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

export interface IAuditReport extends Document {
  auditorId: RecordId;
  inventoryId: RecordId;
  auditDate: Date;
  condition: "good" | "damaged" | "lost";
  notes: string;
  status: "verified" | "flagged";
}

const AuditReportSchema: Schema = new Schema(
  {
    auditorId: { type: Schema.Types.Id, ref: "User", required: true },
    inventoryId: { type: Schema.Types.Id, ref: "Inventory", required: true },
    auditDate: { type: Date, default: Date.now },
    condition: { type: String, enum: ["good", "damaged", "lost"], required: true },
    notes: { type: String, default: "" },
    status: { type: String, enum: ["verified", "flagged"], default: "verified" }
  },
  { timestamps: true }
);

export default database.models.AuditReport || database.model<IAuditReport>("AuditReport", AuditReportSchema);
