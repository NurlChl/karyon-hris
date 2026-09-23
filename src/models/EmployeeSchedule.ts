import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

export interface IEmployeeSchedule extends Document {
  employeeId: RecordId;
  /** Null when the override makes the day a day off. */
  scheduleId?: RecordId | null; // References WorkSchedule
  date: Date; // Specific day, or midnight representing the day
  isOffDay: boolean;
  note: string;
  createdBy?: RecordId | null;
}

const EmployeeScheduleSchema = new Schema<IEmployeeSchedule>({
  employeeId: { type: Schema.Types.Id, ref: "Employee", required: true, index: true },
  scheduleId: { type: Schema.Types.Id, ref: "WorkSchedule", default: null, index: true },
  date: { type: Date, required: true, index: true },
  isOffDay: { type: Boolean, default: false },
  note: { type: String, default: "" },
  createdBy: { type: Schema.Types.Id, ref: "User", default: null },
}, { timestamps: true });

// A worker can only have one schedule assigned per date
EmployeeScheduleSchema.index({ employeeId: 1, date: 1 }, { unique: true });

export default database.models.EmployeeSchedule || database.model<IEmployeeSchedule>("EmployeeSchedule", EmployeeScheduleSchema);
