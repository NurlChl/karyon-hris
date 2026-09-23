/**
 * All HR rules in this system are expressed in Asia/Jakarta (WIB) — an employee
 * clocking in at 08:59 WIB is on time regardless of where the server runs.
 * Everything that turns "now" into a date, a day boundary, or a schedule
 * comparison must go through this module rather than the host's local time.
 */

export const TIMEZONE = "Asia/Jakarta";
/** WIB is a fixed UTC+7 offset — Indonesia observes no daylight saving. */
export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar parts of an instant as seen in WIB. */
export function wibParts(date: Date = new Date()) {
  const shifted = new Date(date.getTime() + WIB_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1, // 1-12
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(), // 0 = Sunday
  };
}

/** `YYYY-MM-DD` for the WIB calendar day containing `date`. */
export function wibDateKey(date: Date = new Date()): string {
  const p = wibParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** `YYYY-MM` period key used by payroll and KPI. */
export function wibPeriodKey(date: Date = new Date()): string {
  const p = wibParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

/**
 * The period label a KPI cycle of the given cadence falls in, in WIB.
 *
 * Appraisal periods are written the way HR writes them on the form itself, so a
 * quarterly template dated September reads `2026-Q3`, not `2026-09`. The field
 * stays free text — this only supplies the right default.
 */
export function kpiPeriodKey(
  periodType: string,
  date: Date = new Date()
): string {
  const p = wibParts(date);
  switch (periodType) {
    case "quarterly":
      return `${p.year}-Q${Math.ceil(p.month / 3)}`;
    case "semester":
      return `${p.year}-S${p.month <= 6 ? 1 : 2}`;
    case "yearly":
      return String(p.year);
    default:
      return wibPeriodKey(date);
  }
}

/** Minutes elapsed since WIB midnight — the unit schedule comparisons use. */
export function wibMinutesOfDay(date: Date = new Date()): number {
  const p = wibParts(date);
  return p.hour * 60 + p.minute;
}

/**
 * The UTC instant of 00:00 WIB on the given WIB calendar day.
 * Attendance/leave documents store day boundaries with this so queries are
 * stable no matter which machine wrote the record.
 */
export function wibStartOfDay(input: Date | string = new Date()): Date {
  const key = typeof input === "string" ? normalizeDateKey(input) : wibDateKey(input);
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - WIB_OFFSET_MS);
}

/** The last millisecond of the given WIB calendar day, as a UTC instant. */
export function wibEndOfDay(input: Date | string = new Date()): Date {
  return new Date(wibStartOfDay(input).getTime() + DAY_MS - 1);
}

/** First instant of the WIB month containing `input` (accepts `YYYY-MM`). */
export function wibStartOfMonth(input: Date | string = new Date()): Date {
  const key = typeof input === "string" ? input : wibPeriodKey(input);
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1) - WIB_OFFSET_MS);
}

/** Last instant of the WIB month containing `input` (accepts `YYYY-MM`). */
export function wibEndOfMonth(input: Date | string = new Date()): Date {
  const key = typeof input === "string" ? input : wibPeriodKey(input);
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1) - WIB_OFFSET_MS - 1);
}

/** Builds the UTC instant for `HH:mm` WIB on a given WIB calendar day. */
export function wibTimeOnDay(dayInput: Date | string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(
    wibStartOfDay(dayInput).getTime() + (h || 0) * 60 * 60 * 1000 + (m || 0) * 60 * 1000
  );
}

/** Accepts `YYYY-MM-DD` or an ISO datetime and returns the WIB day key. */
export function normalizeDateKey(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return wibDateKey(new Date(value));
}

/** Whole days between two WIB calendar days, inclusive of both ends. */
export function inclusiveDayCount(start: Date | string, end: Date | string): number {
  const a = wibStartOfDay(start).getTime();
  const b = wibStartOfDay(end).getTime();
  return Math.floor((b - a) / DAY_MS) + 1;
}

/** Every WIB day key from `start` to `end`, inclusive. */
export function eachDayKey(start: Date | string, end: Date | string): string[] {
  const keys: string[] = [];
  let cursor = wibStartOfDay(start).getTime();
  const last = wibStartOfDay(end).getTime();
  // Guard against an inverted or absurd range producing an unbounded loop.
  let guard = 0;
  while (cursor <= last && guard++ < 3660) {
    keys.push(wibDateKey(new Date(cursor)));
    cursor += DAY_MS;
  }
  return keys;
}

/** True when the WIB day key falls on Saturday or Sunday. */
export function isWeekendKey(key: string): boolean {
  const wd = wibParts(wibStartOfDay(key)).weekday;
  return wd === 0 || wd === 6;
}

/* ------------------------------------------------------------------ */
/* Formatting (server + client safe — always renders in WIB)           */
/* ------------------------------------------------------------------ */

const dateFmt = new Intl.DateTimeFormat("id-ID", {
  timeZone: TIMEZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const dateLongFmt = new Intl.DateTimeFormat("id-ID", {
  timeZone: TIMEZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const timeFmt = new Intl.DateTimeFormat("id-ID", {
  timeZone: TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const timeSecFmt = new Intl.DateTimeFormat("id-ID", {
  timeZone: TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: Date | string | number | null | undefined, fallback = "-") {
  const d = toDate(value);
  return d ? dateFmt.format(d) : fallback;
}

export function formatDateLong(value: Date | string | number | null | undefined, fallback = "-") {
  const d = toDate(value);
  return d ? dateLongFmt.format(d) : fallback;
}

export function formatTime(value: Date | string | number | null | undefined, fallback = "--:--") {
  const d = toDate(value);
  return d ? timeFmt.format(d) : fallback;
}

export function formatClock(value: Date | string | number | null | undefined, fallback = "--:--:--") {
  const d = toDate(value);
  return d ? timeSecFmt.format(d) : fallback;
}

export function formatDateTime(value: Date | string | number | null | undefined, fallback = "-") {
  const d = toDate(value);
  return d ? `${dateFmt.format(d)} ${timeFmt.format(d)} WIB` : fallback;
}

/** "2026-07" -> "Juli 2026" */
export function formatPeriod(period: string): string {
  if (!/^\d{4}-\d{2}$/.test(period)) return period;
  const [y, m] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1))
  );
}

export function formatRupiah(amount: number | null | undefined): string {
  const n = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}

/** "3 hari lalu" style relative label, computed against WIB. */
export function formatRelative(value: Date | string | number | null | undefined): string {
  const d = toDate(value);
  if (!d) return "-";
  const diffSec = Math.round((d.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat("id-ID", { numeric: "auto" });
  if (abs < 60) return rtf.format(Math.round(diffSec), "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 2592000) return rtf.format(Math.round(diffSec / 86400), "day");
  return formatDate(d);
}
