export interface BirthdayWindow { mode: string; months: number; before: number; after: number }
const DAY = 86400000;
const key = (date: Date) => date.toISOString().slice(0, 10);
const date = (value: string) => new Date(`${value}T00:00:00Z`);
const bounded = (value: number, max: number) => Math.min(max, Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0)));
/** Calendar-only arithmetic; caller supplies today's WIB date key. Bounds inclusive. */
export function birthdayRange(today: string, config: BirthdayWindow) {
  const current = date(today), year = current.getUTCFullYear(), month = current.getUTCMonth();
  if (config.mode === "current_month") return { from: key(new Date(Date.UTC(year, month, 1))), to: key(new Date(Date.UTC(year, month + 1, 0))) };
  if (config.mode === "upcoming_months") {
    const months = Math.max(1, bounded(config.months, 6));
    const last = new Date(Date.UTC(year, month + months + 1, 0)).getUTCDate();
    return { from: today, to: key(new Date(Date.UTC(year, month + months, Math.min(current.getUTCDate(), last)))) };
  }
  return { from: key(new Date(current.getTime() - bounded(config.before, 180) * DAY)), to: key(new Date(current.getTime() + bounded(config.after, 180) * DAY)) };
}
export interface BirthdayPerson { _id: string; name: string; month: number; day: number; birthYear?: number }
export function birthdayOccurrences(people: BirthdayPerson[], today: string, range: { from: string; to: string }) {
  const rows: Array<BirthdayPerson & { occurrence: string; daysAway: number; ageAtOccurrence?: number }> = [];
  for (const person of people) {
    if (!Number.isInteger(person.month) || person.month < 1 || person.month > 12 || !Number.isInteger(person.day) || person.day < 1 || person.day > new Date(Date.UTC(2000, person.month, 0)).getUTCDate()) continue;
    for (let year = Number(range.from.slice(0, 4)); year <= Number(range.to.slice(0, 4)); year++) {
      const last = new Date(Date.UTC(year, person.month, 0)).getUTCDate();
      const occurrence = key(new Date(Date.UTC(year, person.month - 1, Math.min(person.day, last))));
      if (occurrence >= range.from && occurrence <= range.to) {
        const validBirthYear = Number.isInteger(person.birthYear) && Number(person.birthYear) >= 1900 && Number(person.birthYear) <= year;
        rows.push({
          ...person,
          occurrence,
          daysAway: Math.round((date(occurrence).getTime() - date(today).getTime()) / DAY),
          ...(validBirthYear ? { ageAtOccurrence: year - Number(person.birthYear) } : {}),
        });
      }
    }
  }
  return rows.sort((a, b) => a.occurrence.localeCompare(b.occurrence) || a.name.localeCompare(b.name) || a._id.localeCompare(b._id));
}
