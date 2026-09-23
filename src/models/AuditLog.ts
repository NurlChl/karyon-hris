import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

export interface IAuditLog extends Document {
  userId: RecordId | string | null;
  action: string;
  module: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string;
  userAgent: string;
  timestamp: Date;
}

const AuditLogSchema = new Schema<IAuditLog>({
  userId: { type: Schema.Types.Mixed, default: null, index: true },
  action: { type: String, required: true, index: true },
  module: { type: String, required: true, index: true },
  before: { type: Schema.Types.Mixed, default: null },
  after: { type: Schema.Types.Mixed, default: null },
  ip: { type: String, default: "" },
  userAgent: { type: String, default: "" },
  timestamp: { type: Date, default: Date.now, required: true, index: true },
});

export default database.models.AuditLog || database.model<IAuditLog>("AuditLog", AuditLogSchema);
