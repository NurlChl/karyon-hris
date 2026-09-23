import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireUser, requirePermission, parseBody, BadRequest, NotFound } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import NationalHoliday from "@/models/NationalHoliday";
import { wibDateKey } from "@/lib/time";

/**
 * Master data for Indonesian public holidays.
 *
 * Kept as CMS-managed rows rather than a third-party API call so the system
 * keeps working offline and so HR can add company-specific `cuti bersama`
 * days that no public calendar knows about.
 */

export const GET = wrapRouteHandler(async (req) => {
  await requireUser(req);
  const sp = new URL(req.url).searchParams;
  const year = sp.get("year") ?? String(new Date().getFullYear());
  const upcomingOnly = sp.get("upcoming") === "1";

  const filter: Record<string, unknown> = {
    dateKey: { $gte: `${year}-01-01`, $lte: `${year}-12-31` },
  };
  if (upcomingOnly) {
    filter.dateKey = { $gte: wibDateKey(), $lte: `${year}-12-31` };
    filter.isActive = true;
  }

  const holidays = await NationalHoliday.find(filter).sort({ dateKey: 1 }).lean();
  return apiSuccess(holidays, "Berhasil memuat hari libur nasional");
});

const holidaySchema = z.object({
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus berformat YYYY-MM-DD"),
  name: z.string().trim().min(3, "Nama hari libur minimal 3 karakter").max(120),
  type: z.enum(["libur_nasional", "cuti_bersama"]).default("libur_nasional"),
  isActive: z.boolean().default(true),
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "settings", "write");
  const body = await parseBody(req, holidaySchema);

  const holiday = await NationalHoliday.findOneAndUpdate(
    { dateKey: body.dateKey },
    { $set: body },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  void logActivity({
    userId: ctx.user.id,
    action: "UPSERT_NATIONAL_HOLIDAY",
    module: "settings",
    after: body,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(holiday, `Hari libur "${body.name}" disimpan.`);
});

export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "settings", "delete");
  const dateKey = new URL(req.url).searchParams.get("dateKey");
  if (!dateKey) throw BadRequest("Parameter dateKey wajib disertakan.");

  const removed = await NationalHoliday.findOneAndDelete({ dateKey });
  if (!removed) throw NotFound("Hari libur tidak ditemukan.");

  void logActivity({
    userId: ctx.user.id,
    action: "DELETE_NATIONAL_HOLIDAY",
    module: "settings",
    before: removed.toObject(),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess({ dateKey }, "Hari libur dihapus.");
});
