import { RecordId } from "@/lib/postgres";
import database, { Schema, Document } from "@/lib/postgres";

export interface IHolidaySwapRequest extends Document {
  employeeId: RecordId;
  /** The national holiday the employee agrees to work. */
  holidayDate: Date;
  /** The working day they take off instead. */
  replacementDate: Date;
  isHalfDay: boolean;
  session: "full" | "morning" | "afternoon";
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled" | "forfeited";
  approvalInstanceId?: RecordId;
  /**
   * Set by the scheduler when the employee did not actually attend on
   * `holidayDate` — the swap is then void, per the rule that the right is only
   * earned by working the holiday.
   */
  forfeitedReason?: string;
  createdAt: Date;
}

const HolidaySwapRequestSchema = new Schema<IHolidaySwapRequest>(
  {
    employeeId: { type: Schema.Types.Id, ref: "Employee", required: true, index: true },
    holidayDate: { type: Date, required: true, index: true },
    replacementDate: { type: Date, required: true, index: true },
    isHalfDay: { type: Boolean, default: false },
    session: { type: String, enum: ["full", "morning", "afternoon"], default: "full" },
    reason: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled", "forfeited"],
      default: "pending",
      index: true,
    },
    approvalInstanceId: { type: Schema.Types.Id, ref: "ApprovalInstance" },
    forfeitedReason: { type: String },
  },
  { timestamps: true }
);

// One holiday may only be swapped once per employee — enforced at the database
// level so a double-submit race cannot create two claims on the same date.
HolidaySwapRequestSchema.index(
  { employeeId: 1, holidayDate: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["pending", "approved"] } } }
);

export default database.models.HolidaySwapRequest ||
  database.model<IHolidaySwapRequest>("HolidaySwapRequest", HolidaySwapRequestSchema);
