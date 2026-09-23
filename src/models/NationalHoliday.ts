import database, { Schema, Document } from "@/lib/postgres";

export interface INationalHoliday extends Document {
  /** WIB calendar day key, `YYYY-MM-DD` — stored as a string so a timezone
   *  shift can never move Idul Fitri to the day before. */
  dateKey: string;
  name: string;
  /** `cuti_bersama` days are holidays that *do* consume annual leave. */
  type: "libur_nasional" | "cuti_bersama";
  isActive: boolean;
}

const NationalHolidaySchema = new Schema<INationalHoliday>(
  {
    dateKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ["libur_nasional", "cuti_bersama"],
      default: "libur_nasional",
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default database.models.NationalHoliday ||
  database.model<INationalHoliday>("NationalHoliday", NationalHolidaySchema);
