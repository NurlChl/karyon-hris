import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

export interface IShift extends Document {
  branchId: RecordId;
  divisionId: RecordId;
  date: Date;
  scheduleId: RecordId;
  employeeId: RecordId;
}

const ShiftSchema = new Schema<IShift>({
  branchId: { type: Schema.Types.Id, ref: "Branch", required: true, index: true },
  divisionId: { type: Schema.Types.Id, ref: "Division", required: true, index: true },
  date: { type: Date, required: true, index: true },
  scheduleId: { type: Schema.Types.Id, ref: "WorkSchedule", required: true },
  employeeId: { type: Schema.Types.Id, ref: "Employee", required: true, index: true },
});

// Avoid duplicate assignments of shifts for employees on the same date
ShiftSchema.index({ employeeId: 1, date: 1 }, { unique: true });

export default database.models.Shift || database.model<IShift>("Shift", ShiftSchema);
