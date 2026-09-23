/**
 * Fetches the Indonesian public-holiday calendar for a given year.
 *
 * ## Why this source
 *
 * Indonesian holidays cannot be computed: most of them follow the Hijri,
 * Saka, or Chinese lunar calendars, and the government fixes the exact dates —
 * plus that year's *cuti bersama* — by joint ministerial decree each year. Any
 * source that does not publish cuti bersama is unusable for HR, because those
 * days consume annual leave and change what payroll owes.
 *
 * Three sources were checked:
 *
 * - `api-harilibur.vercel.app` and `dayoffapi.vercel.app`, the two most-cited
 *   free Indonesian APIs, are **both offline** — the deployments return
 *   `DEPLOYMENT_DISABLED`. They cannot be relied on.
 * - `date.nager.at` is alive, reputable and open-source, but its Indonesian
 *   coverage is only the fixed-date holidays: for 2026 it returns 8 entries and
 *   omits Idul Fitri, Idul Adha, Nyepi, Waisak and Imlek entirely, along with
 *   every cuti bersama. Importing it would leave the biggest holiday of the
 *   Indonesian year unmarked.
 * - Google's public `en.indonesian` holiday calendar returns 28 entries for
 *   2026 including all of the above **and** the joint holidays. It needs no API
 *   key, is served over HTTPS, and is the same data Google Calendar shows.
 *
 * So Google is the primary source and Nager is the fallback for when it cannot
 * be reached — a partial list clearly labelled as partial beats no list.
 *
 * Nothing here writes to the database. The caller previews what came back and
 * decides what to keep, because the decree is occasionally amended and HR must
 * stay in control of the calendar their payroll depends on.
 */

export type HolidayType = "libur_nasional" | "cuti_bersama";

export interface FetchedHoliday {
  /** `YYYY-MM-DD` in WIB. */
  dateKey: string;
  name: string;
  type: HolidayType;
}

export interface HolidayFetchResult {
  holidays: FetchedHoliday[];
  source: "google" | "nager";
  /** True when the source is known to omit lunar holidays and cuti bersama. */
  partial: boolean;
  warning?: string;
}

const GOOGLE_ICS =
  "https://calendar.google.com/calendar/ical/" +
  "en.indonesian%23holiday%40group.v.calendar.google.com/public/basic.ics";

const NAGER_API = "https://date.nager.at/api/v3/PublicHolidays";

/**
 * English names as Google publishes them, mapped to the wording Indonesian HR
 * actually uses on a leave calendar.
 *
 * Matching is done on a substring, so "Idul Fitri Joint Holiday" and "Idul
 * Fitri Holiday" both resolve without needing an entry each.
 *
 * **Order matters: the first match wins, so the more specific pattern has to
 * come first.** "Chinese New Year's Day" contains "New Year's Day", and with
 * the generic entry first Imlek was labelled "Tahun Baru Masehi" — the right
 * date under the wrong holiday's name.
 */
const NAME_MAP: Array<[pattern: RegExp, name: string]> = [
  [/chinese new year|imlek/i, "Tahun Baru Imlek"],
  [/islamic new year|muharram/i, "Tahun Baru Islam (1 Muharram)"],
  [/new year'?s eve/i, "Malam Tahun Baru"],
  [/new year'?s day/i, "Tahun Baru Masehi"],
  [/ascension of the prophet|isra/i, "Isra Mikraj Nabi Muhammad SAW"],
  [/day of silence|nyepi/i, "Hari Raya Nyepi (Tahun Baru Saka)"],
  [/ramadan start/i, "Awal Ramadan"],
  [/idul fitri|eid al-?fitr/i, "Hari Raya Idul Fitri"],
  [/good friday/i, "Wafat Isa Almasih"],
  [/easter/i, "Hari Paskah"],
  [/labor day|labour day/i, "Hari Buruh Internasional"],
  [/ascension day of jesus/i, "Kenaikan Isa Almasih"],
  // Catches "Joint Holiday after Ascension Day", which names no religion of
  // its own. Safe here only because the Prophet's ascension is matched above.
  [/ascension day/i, "Kenaikan Isa Almasih"],
  [/idul adha|eid al-?adha/i, "Hari Raya Idul Adha"],
  [/waisak|vesak/i, "Hari Raya Waisak"],
  [/pancasila/i, "Hari Lahir Pancasila"],
  [/independence day/i, "Hari Kemerdekaan Republik Indonesia"],
  [/maulid|prophet'?s birthday/i, "Maulid Nabi Muhammad SAW"],
  [/christmas eve/i, "Malam Natal"],
  [/christmas/i, "Hari Raya Natal"],
];

/** A "Joint Holiday" in Google's wording is a cuti bersama. */
function classify(summary: string): HolidayType {
  return /joint holiday|cuti bersama/i.test(summary) ? "cuti_bersama" : "libur_nasional";
}

function localise(summary: string): string {
  // Google marks dates that may still move; keep that caveat visible to HR.
  const tentative = /\(tentative\)/i.test(summary);
  const clean = summary.replace(/\s*\(tentative\)\s*/i, "").trim();

  let name = clean;
  for (const [pattern, indonesian] of NAME_MAP) {
    if (pattern.test(clean)) {
      name = indonesian;
      break;
    }
  }

  if (/joint holiday/i.test(clean) && !/cuti bersama/i.test(name)) {
    name = `Cuti Bersama ${name}`;
  }
  return tentative ? `${name} (tanggal belum final)` : name;
}

/**
 * Minimal iCalendar reader.
 *
 * Only `VEVENT` blocks with an all-day `DTSTART` matter here, so this does not
 * try to be a general parser. Long values are folded across lines by the
 * format, and the fold has to be undone before anything else is read.
 */
function parseIcs(ics: string, year: number): FetchedHoliday[] {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const blocks = unfolded.split("BEGIN:VEVENT").slice(1);
  const out: FetchedHoliday[] = [];

  for (const block of blocks) {
    const body = block.split("END:VEVENT")[0];
    const date = /DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/.exec(body);
    const summary = /\nSUMMARY:(.*)/.exec(body) ?? /^SUMMARY:(.*)/m.exec(body);
    if (!date || !summary) continue;
    if (Number(date[1]) !== year) continue;

    const raw = summary[1].trim().replace(/\\,/g, ",").replace(/\\;/g, ";");
    out.push({
      dateKey: `${date[1]}-${date[2]}-${date[3]}`,
      name: localise(raw),
      type: classify(raw),
    });
  }

  // One date can carry two entries (a holiday and its joint day); keep the
  // first and let the operator edit afterwards rather than guessing.
  const seen = new Set<string>();
  return out
    .filter((h) => (seen.has(h.dateKey) ? false : (seen.add(h.dateKey), true)))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

async function fetchGoogle(year: number): Promise<FetchedHoliday[]> {
  const res = await fetch(GOOGLE_ICS, {
    // The calendar changes at most a few times a year.
    next: { revalidate: 86_400 },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google calendar merespons ${res.status}`);
  return parseIcs(await res.text(), year);
}

async function fetchNager(year: number): Promise<FetchedHoliday[]> {
  const res = await fetch(`${NAGER_API}/${year}/ID`, {
    next: { revalidate: 86_400 },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Nager.Date merespons ${res.status}`);

  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((r): r is { date: string; localName?: string; name?: string } =>
      typeof r === "object" && r !== null && typeof (r as { date?: unknown }).date === "string"
    )
    .map((r) => ({
      dateKey: r.date,
      name: (r.localName || r.name || "Hari libur").trim(),
      type: "libur_nasional" as const,
    }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

/** Fetches one year, preferring the complete source. */
export async function fetchIndonesianHolidays(year: number): Promise<HolidayFetchResult> {
  try {
    const holidays = await fetchGoogle(year);
    if (holidays.length > 0) {
      return { holidays, source: "google", partial: false };
    }
    throw new Error("Kalender Google tidak memuat data untuk tahun tersebut");
  } catch (googleErr) {
    try {
      const holidays = await fetchNager(year);
      return {
        holidays,
        source: "nager",
        partial: true,
        warning:
          "Sumber utama tidak dapat dihubungi, jadi daftar ini diambil dari sumber cadangan " +
          "yang hanya memuat hari libur bertanggal tetap. Hari raya Idul Fitri, Idul Adha, " +
          "Nyepi, Waisak, Imlek, dan seluruh cuti bersama TIDAK termasuk dan harus " +
          "ditambahkan manual.",
      };
    } catch {
      throw new Error(
        `Tidak dapat mengambil daftar hari libur ${year}. ` +
          `Sumber utama: ${(googleErr as Error).message}. Coba lagi nanti atau tambahkan manual.`
      );
    }
  }
}
