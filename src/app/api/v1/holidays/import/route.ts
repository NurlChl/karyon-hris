import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requirePermission, parseBody, BadRequest } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import NationalHoliday from "@/models/NationalHoliday";
import { fetchIndonesianHolidays } from "@/lib/hr/holiday-source";

/**
 * Imports the national holiday calendar for one year.
 *
 * Split into a preview (`GET`) and an apply (`POST`) on purpose. The holiday
 * calendar drives leave balances and payroll working-day counts, so silently
 * overwriting it from the internet is not acceptable: HR sees exactly what will
 * change, then chooses. The ministerial decree is also amended from time to
 * time, and locally added company holidays must survive an import.
 */

const yearSchema = z
  .number()
  .int()
  .min(2000, "Tahun tidak masuk akal")
  .max(2100, "Tahun tidak masuk akal");

/* ------------------------------------------------------------------ */
/* GET — preview                                                       */
/* ------------------------------------------------------------------ */

export const GET = wrapRouteHandler(async (req) => {
  await requirePermission(req, "settings", "read");

  const raw = new URL(req.url).searchParams.get("year");
  const parsed = yearSchema.safeParse(Number(raw));
  if (!parsed.success) throw BadRequest("Parameter tahun tidak valid.");
  const year = parsed.data;

  const result = await fetchIndonesianHolidays(year);

  // Compare against what is stored so the preview can say, per row, whether it
  // would be added, would change something, or is already identical.
  const existing = await NationalHoliday.find({
    dateKey: { $gte: `${year}-01-01`, $lte: `${year}-12-31` },
  })
    .select("dateKey name type")
    .lean<Array<{ dateKey: string; name: string; type: string }>>();

  const byDate = new Map(existing.map((h) => [h.dateKey, h]));

  const rows = result.holidays.map((h) => {
    const current = byDate.get(h.dateKey);
    if (!current) return { ...h, status: "baru" as const };
    if (current.name === h.name && current.type === h.type) {
      return { ...h, status: "sama" as const };
    }
    return {
      ...h,
      status: "berubah" as const,
      currentName: current.name,
      currentType: current.type,
    };
  });

  // Rows HR added by hand that the calendar does not know about. They are
  // reported so nobody is surprised, and they are never touched by an import.
  const importDates = new Set(result.holidays.map((h) => h.dateKey));
  const localOnly = existing
    .filter((h) => !importDates.has(h.dateKey))
    .map((h) => ({ dateKey: h.dateKey, name: h.name, type: h.type }));

  return apiSuccess(
    {
      year,
      source: result.source,
      partial: result.partial,
      warning: result.warning,
      rows,
      localOnly,
      summary: {
        total: rows.length,
        baru: rows.filter((r) => r.status === "baru").length,
        berubah: rows.filter((r) => r.status === "berubah").length,
        sama: rows.filter((r) => r.status === "sama").length,
        lokal: localOnly.length,
      },
    },
    "Pratinjau impor hari libur siap"
  );
});

/* ------------------------------------------------------------------ */
/* POST — apply                                                        */
/* ------------------------------------------------------------------ */

const applySchema = z.object({
  year: yearSchema,
  /** Only these dates are written, so HR can deselect rows in the preview. */
  dateKeys: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(60),
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "settings", "write");
  const body = await parseBody(req, applySchema);

  // Re-fetch rather than trusting dates posted by the client: the request only
  // says *which* rows to accept, never what they contain.
  const result = await fetchIndonesianHolidays(body.year);
  const wanted = new Set(body.dateKeys);
  const chosen = result.holidays.filter((h) => wanted.has(h.dateKey));

  if (chosen.length === 0) {
    throw BadRequest("Tidak ada tanggal terpilih yang cocok dengan kalender sumber.");
  }

  const ops = chosen.map((h) => ({
    updateOne: {
      filter: { dateKey: h.dateKey },
      // `isActive` is only set on insert, so a day HR deliberately switched off
      // is not silently switched back on by a re-import.
      update: {
        $set: { name: h.name, type: h.type },
        $setOnInsert: { dateKey: h.dateKey, isActive: true },
      },
      upsert: true,
    },
  }));

  const res = await NationalHoliday.bulkWrite(ops, { ordered: false });
  const inserted = res.upsertedCount ?? 0;
  const updated = res.modifiedCount ?? 0;

  void logActivity({
    userId: ctx.user.id,
    action: "IMPORT_NATIONAL_HOLIDAYS",
    module: "settings",
    after: { year: body.year, source: result.source, inserted, updated, total: chosen.length },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { year: body.year, inserted, updated, total: chosen.length, source: result.source },
    `${inserted} hari libur ditambahkan dan ${updated} diperbarui untuk tahun ${body.year}.`
  );
});
