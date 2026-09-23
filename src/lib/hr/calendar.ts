import NationalHoliday from "@/models/NationalHoliday";
import WorkSchedule from "@/models/WorkSchedule";
import EmployeeSchedule from "@/models/EmployeeSchedule";
import Employee from "@/models/Employee";
import { expandDays, type ScheduleTemplateLike } from "@/lib/hr/schedule-days";
import Branch from "@/models/Branch";
import { connectToDatabase } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { eachDayKey, isWeekendKey, wibEndOfDay, wibParts, wibStartOfDay } from "@/lib/time";

/** All active national-holiday day keys in a range, mapped to their names. */
export async function holidayMap(
  startKey: string,
  endKey: string
): Promise<Map<string, { name: string; type: string }>> {
  await connectToDatabase();
  const rows = await NationalHoliday.find({
    isActive: true,
    dateKey: { $gte: startKey, $lte: endKey },
  }).lean<Array<{ dateKey: string; name: string; type: string }>>();
  return new Map(rows.map((r) => [r.dateKey, { name: r.name, type: r.type }]));
}

export async function isHoliday(dateKey: string): Promise<boolean> {
  const map = await holidayMap(dateKey, dateKey);
  return map.has(dateKey);
}

export interface LeaveDayBreakdown {
  /** Days actually charged against the employee's balance. */
  chargedDays: number;
  /** Total calendar days in the requested range. */
  calendarDays: number;
  /** Day keys that were skipped, with the reason shown back to the user. */
  skipped: Array<{ dateKey: string; reason: string }>;
}

/**
 * Counts how many days a leave request consumes.
 *
 * With `leave_count_mode = working_days` (the default), weekends and national
 * holidays inside the range do not eat the employee's quota — the previous
 * implementation charged every calendar day, so a Friday-to-Monday request cost
 * four days instead of two.
 */
export async function countLeaveDays(
  startKey: string,
  endKey: string
): Promise<LeaveDayBreakdown> {
  const days = eachDayKey(startKey, endKey);
  const settings = await getSettings();
  const mode = String(settings.leave_count_mode ?? "working_days");

  if (mode === "calendar_days") {
    return { chargedDays: days.length, calendarDays: days.length, skipped: [] };
  }

  const holidays = await holidayMap(startKey, endKey);
  const skipped: LeaveDayBreakdown["skipped"] = [];
  let charged = 0;

  for (const key of days) {
    const holiday = holidays.get(key);
    if (holiday && holiday.type === "libur_nasional") {
      skipped.push({ dateKey: key, reason: holiday.name });
    } else if (isWeekendKey(key)) {
      skipped.push({ dateKey: key, reason: "Akhir pekan" });
    } else {
      charged++;
    }
  }

  return { chargedDays: charged, calendarDays: days.length, skipped };
}

export interface ResolvedSchedule {
  /** `HH:mm` WIB. */
  clockIn: string;
  clockOut: string;
  breakOut?: string;
  breakIn?: string;
  isBreakActive: boolean;
  gracePeriodMinutes: number;
  /** A day off by roster: clocking in is allowed but never counted late. */
  isOffDay: boolean;
  /** Where the values came from, for the UI to explain itself. */
  source: "date_override" | "employee_template" | "branch_default";
  scheduleName: string;
  scheduleId?: string;
}

type TemplateDoc = ScheduleTemplateLike & {
  _id?: unknown;
  name?: string;
  isBreakActive?: boolean;
  gracePeriodMinutes?: number;
};

function fromTemplate(
  template: TemplateDoc,
  dateKey: string,
  source: ResolvedSchedule["source"],
  globalGrace: number,
  breakEnabled: boolean
): ResolvedSchedule {
  const weekday = wibParts(wibStartOfDay(dateKey)).weekday;
  const day = expandDays(template).find((d) => d.day === weekday)!;
  return {
    clockIn: day.clockIn,
    clockOut: day.clockOut,
    breakOut: day.breakOut,
    breakIn: day.breakIn,
    isBreakActive: breakEnabled && template.isBreakActive !== false && Boolean(day.breakOut && day.breakIn),
    gracePeriodMinutes:
      typeof template.gracePeriodMinutes === "number" ? template.gracePeriodMinutes : globalGrace,
    isOffDay: !day.active,
    source,
    scheduleName: template.name ?? "Jadwal kerja",
    scheduleId: template._id ? String(template._id) : undefined,
  };
}

/**
 * Resolves the work schedule that applies to an employee on a WIB day.
 *
 * 1. A date override from the roster (a different shift, or a day off).
 * 2. The employee's weekly shift template, using that weekday's hours; a
 *    weekday the template marks inactive is a day off.
 * 3. The branch's operating hours as the backstop.
 *
 * Grace period follows the same order, with the global setting as the final
 * default.
 */
export async function resolveSchedule(
  employeeId: string,
  dateKey: string,
  branch?: { workHours?: { start?: string; end?: string }; name?: string } | null
): Promise<ResolvedSchedule> {
  await connectToDatabase();
  const settings = await getSettings();
  const globalGrace = Number(settings.grace_period_minutes ?? 1);
  const breakEnabled = Boolean(settings.enable_break_attendance);

  const override = await EmployeeSchedule.findOne({
    employeeId,
    date: { $gte: wibStartOfDay(dateKey), $lte: wibEndOfDay(dateKey) },
  })
    .populate("scheduleId")
    .lean<{ isOffDay?: boolean; note?: string; scheduleId?: TemplateDoc | null } | null>();

  if (override?.isOffDay) {
    return {
      clockIn: branch?.workHours?.start ?? "09:00",
      clockOut: branch?.workHours?.end ?? "17:00",
      isBreakActive: false,
      gracePeriodMinutes: globalGrace,
      isOffDay: true,
      source: "date_override",
      scheduleName: override.note ? `Libur: ${override.note}` : "Libur (jadwal khusus)",
    };
  }
  if (override?.scheduleId) {
    // An override names a shift for that date; it is a working day whatever the
    // template's weekday pattern says.
    const resolved = fromTemplate(override.scheduleId, dateKey, "date_override", globalGrace, breakEnabled);
    return { ...resolved, isOffDay: false };
  }

  const employee = await Employee.findById(employeeId)
    .select("workScheduleId")
    .populate("workScheduleId")
    .lean<{ workScheduleId?: TemplateDoc | null } | null>();
  if (employee?.workScheduleId) {
    return fromTemplate(employee.workScheduleId, dateKey, "employee_template", globalGrace, breakEnabled);
  }

  return {
    clockIn: branch?.workHours?.start ?? "09:00",
    clockOut: branch?.workHours?.end ?? "17:00",
    isBreakActive: breakEnabled,
    gracePeriodMinutes: globalGrace,
    isOffDay: false,
    source: "branch_default",
    scheduleName: branch?.name ? `Jam operasional ${branch.name}` : "Jam kerja default",
  };
}

/** Lists the branches an attendance attempt may legitimately match. */
export async function listBranches() {
  await connectToDatabase();
  return Branch.find({})
    .select("name lat lng radiusMeter workHours address")
    .lean<
      Array<{
        _id: unknown;
        name: string;
        lat: number;
        lng: number;
        radiusMeter: number;
        address: string;
        workHours?: { start?: string; end?: string };
      }>
    >();
}

export { WorkSchedule };
