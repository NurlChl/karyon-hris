import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

export interface IInventoryAssignment extends Document {
  employeeId: RecordId;
  inventoryId: RecordId;
  handoverDate: Date;
  signatureUrl?: string; // canvas draw signature uploaded to storage
  status: "pending_handover" | "active" | "returned";
}

const InventoryAssignmentSchema = new Schema<IInventoryAssignment>({
  employeeId: { type: Schema.Types.Id, ref: "Employee", required: true, index: true },
  inventoryId: { type: Schema.Types.Id, ref: "Inventory", required: true, index: true },
  handoverDate: { type: Date, required: true, default: Date.now },
  signatureUrl: { type: String },
  status: { 
    type: String, 
    enum: ["pending_handover", "active", "returned"], 
    default: "pending_handover",
    required: true,
    index: true
  },
});

export default database.models.InventoryAssignment || database.model<IInventoryAssignment>("InventoryAssignment", InventoryAssignmentSchema);
