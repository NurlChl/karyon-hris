import database, { Schema, Document } from "@/lib/postgres";

export interface IWorkSchedule extends Document {
  name: string; // e.g. "Backoffice Shift A"
  clockIn: string; // e.g. "09:00"
  breakOut?: string; // e.g. "12:00" (optional)
  breakIn?: string; // e.g. "13:00" (optional)
  clockOut: string; // e.g. "17:00"
  isBreakActive: boolean;
  activeDays: number[]; // Array of active days of week (0 = Sunday, 1 = Monday, etc., e.g. [1,2,3,4,5])
  gracePeriodMinutes: number; // grace period for lateness, e.g. 5 minutes
  /**
   * Hours per day of the week. The flat clockIn/clockOut/activeDays above are
   * kept in step (from the first working day) for older readers; the resolver
   * reads `days` through lib/hr/schedule-days#expandDays.
   */
  days: Array<{ day: number; active: boolean; clockIn: string; clockOut: string; breakOut?: string; breakIn?: string }>;
  description: string;
  color: string;
}

const WorkScheduleSchema = new Schema<IWorkSchedule>({
  name: { type: String, required: true, unique: true },
  clockIn: { type: String, required: true },
  breakOut: { type: String },
  breakIn: { type: String },
  clockOut: { type: String, required: true },
  isBreakActive: { type: Boolean, default: false },
  activeDays: [{ type: Number, required: true }],
  gracePeriodMinutes: { type: Number, default: 0, required: true },
  days: [
    {
      _id: false,
      day: { type: Number, min: 0, max: 6, required: true },
      active: { type: Boolean, default: false },
      clockIn: { type: String, default: "09:00" },
      clockOut: { type: String, default: "17:00" },
      breakOut: { type: String, default: "" },
      breakIn: { type: String, default: "" },
    },
  ],
  description: { type: String, default: "" },
  color: { type: String, default: "primary" },
}, { timestamps: true });

export default database.models.WorkSchedule || database.model<IWorkSchedule>("WorkSchedule", WorkScheduleSchema);
