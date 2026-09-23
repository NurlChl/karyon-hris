import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

export interface ILeaveBalance extends Document {
  employeeId: RecordId;
  leaveTypeId: RecordId;
  year: number;
  allocatedDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
}

const LeaveBalanceSchema = new Schema<ILeaveBalance>({
  employeeId: { type: Schema.Types.Id, ref: "Employee", required: true, index: true },
  leaveTypeId: { type: Schema.Types.Id, ref: "LeaveType", required: true, index: true },
  year: { type: Number, required: true, index: true },
  allocatedDays: { type: Number, required: true },
  usedDays: { type: Number, default: 0, required: true },
  pendingDays: { type: Number, default: 0, required: true },
  remainingDays: { type: Number, required: true },
});

// Compound index to guarantee one balance record per type per year
LeaveBalanceSchema.index({ employeeId: 1, leaveTypeId: 1, year: 1 }, { unique: true });

export default database.models.LeaveBalance || database.model<ILeaveBalance>("LeaveBalance", LeaveBalanceSchema);
