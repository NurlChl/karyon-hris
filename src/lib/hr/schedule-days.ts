/**
 * Per-day working hours of a shift template. Client-safe: the admin screen and
 * the attendance resolver share these helpers.
 */

export interface ScheduleDay {
  /** 0 = Minggu … 6 = Sabtu, same as `Date#getDay`. */
  day: number;
  active: boolean;
  clockIn: string;
  clockOut: string;
  breakOut?: string;
  breakIn?: string;
}

export const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
export const DAY_SHORT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
/** Display order, Monday first as Indonesian calendars do. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export interface ScheduleTemplateLike {
  clockIn?: string;
  clockOut?: string;
  breakOut?: string;
  breakIn?: string;
  activeDays?: number[];
  days?: Array<Partial<ScheduleDay>> | null;
}

/**
 * The seven days of a template. Templates saved before per-day hours existed
 * have one set of hours and a list of active days; they expand to the same
 * hours on every active day.
 */
export function expandDays(t: ScheduleTemplateLike): ScheduleDay[] {
  const stored = new Map((t.days ?? []).filter((d) => typeof d.day === "number").map((d) => [d.day as number, d]));
  return [0, 1, 2, 3, 4, 5, 6].map((day) => {
    const d = stored.get(day);
    if (d) {
      return {
        day,
        active: Boolean(d.active),
        clockIn: d.clockIn || t.clockIn || "09:00",
        clockOut: d.clockOut || t.clockOut || "17:00",
        breakOut: d.breakOut || undefined,
        breakIn: d.breakIn || undefined,
      };
    }
    return {
      day,
      active: (t.activeDays ?? [1, 2, 3, 4, 5]).includes(day),
      clockIn: t.clockIn || "09:00",
      clockOut: t.clockOut || "17:00",
      breakOut: t.breakOut,
      breakIn: t.breakIn,
    };
  });
}

/** True when a shift ends after midnight (e.g. 23:00–07:00). */
export function crossesMidnight(clockIn: string, clockOut: string) {
  return clockOut <= clockIn;
}

/** Scheduled minutes of work, break excluded. */
export function workMinutes(d: Pick<ScheduleDay, "clockIn" | "clockOut" | "breakOut" | "breakIn">) {
  const m = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  let total = m(d.clockOut) - m(d.clockIn);
  if (total <= 0) total += 24 * 60;
  if (d.breakOut && d.breakIn) {
    let br = m(d.breakIn) - m(d.breakOut);
    if (br < 0) br += 24 * 60;
    total -= br;
  }
  return Math.max(0, total);
}

/** "Sen–Kam 08:00–17:00 · Jum 08:00–16:00 · Sab 08:00–13:00" */
export function summariseDays(days: ScheduleDay[]): string {
  const groups: Array<{ from: number; to: number; label: string }> = [];
  for (const day of WEEK_ORDER) {
    const d = days.find((x) => x.day === day);
    if (!d?.active) continue;
    const label = `${d.clockIn}–${d.clockOut}`;
    const last = groups[groups.length - 1];
    const prevDay = last ? last.to : -1;
    const adjacent = last && WEEK_ORDER.indexOf(day) === WEEK_ORDER.indexOf(prevDay) + 1;
    if (last && adjacent && last.label === label) last.to = day;
    else groups.push({ from: day, to: day, label });
  }
  if (!groups.length) return "Tidak ada hari kerja";
  return groups
    .map((g) => `${g.from === g.to ? DAY_SHORT[g.from] : `${DAY_SHORT[g.from]}–${DAY_SHORT[g.to]}`} ${g.label}`)
    .join(" · ");
}
