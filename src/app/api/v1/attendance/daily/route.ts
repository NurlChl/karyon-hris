import { z } from "zod";
import { apiSuccess, wrapRouteHandler } from "@/lib/api";
import { BadRequest, enforceRateLimit, parseBody, parseQuery, requirePermission, scopeFilter } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { wibDateKey, wibStartOfDay } from "@/lib/time";
import { dailyAttendance, DAILY_STATUS_LABEL, type DailyStatus } from "@/lib/hr/attendance-monitor";
import { remindMissing } from "@/lib/hr/attendance-alerts";

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/);
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus YYYY-MM-DD");
const statuses = Object.keys(DAILY_STATUS_LABEL) as [DailyStatus, ...DailyStatus[]];
const query = z.object({
  date: dateKey.optional(),
  branchId: objectId.optional(),
  divisionId: objectId.optional(),
  status: z.enum(statuses).optional(),
  q: z.string().trim().max(100).optional(),
});

/** Keeps the monitor to a sensible window: one year back, one month ahead. */
function checkDate(key: string) {
  const day = wibStartOfDay(key).getTime(), today = wibStartOfDay(wibDateKey()).getTime();
  if (Number.isNaN(day) || day < today - 366 * 86_400_000 || day > today + 31 * 86_400_000) {
    throw BadRequest("Tanggal di luar rentang pemantauan (maksimal 1 tahun ke belakang, 31 hari ke depan).");
  }
}

/**
 * Who is in, late, on leave, off, not yet clocked in, or absent (alpha) on a
 * day. Scoped by the caller's attendance:read grant (company, branch,
 * division or self); the summary counts the whole scope before filters.
 */
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "attendance", "read");
  const params = parseQuery(req, query);
  const date = params.date ?? wibDateKey();
  checkDate(date);
  const employeeFilter: Record<string, unknown> = scopeFilter(ctx, { employee: "_id", branch: "branchId", division: "divisionId" });
  const { rows, summary } = await dailyAttendance({ dateKey: date, employeeFilter });
  const q = params.q?.toLowerCase();
  const filtered = rows.filter((row) =>
    (!params.status || row.status === params.status) &&
    (!params.branchId || row.employee.branchId === params.branchId) &&
    (!params.divisionId || row.employee.divisionId === params.divisionId) &&
    (!q || row.employee.name.toLowerCase().includes(q) || row.employee.employeeId.toLowerCase().includes(q))
  );
  const response = apiSuccess({ date, summary, rows: filtered, labels: DAILY_STATUS_LABEL });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});

const action = z.object({ action: z.literal("remind"), date: dateKey.optional() }).strict();

/** Sends an in-app reminder to everyone in scope who has not clocked in yet today. */
export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "attendance", "write");
  const body = await parseBody(req, action);
  const today = wibDateKey();
  if (body.date && body.date !== today) throw BadRequest("Pengingat hanya dapat dikirim untuk hari ini.");
  enforceRateLimit("attendance-remind", ctx.user.id, { max: 5, windowMs: 60 * 60_000 });
  const { rows } = await dailyAttendance({ dateKey: today, employeeFilter: scopeFilter(ctx, { employee: "_id", branch: "branchId", division: "divisionId" }) });
  const sent = await remindMissing(rows, today);
  void logActivity({ userId: ctx.user.id, action: "ATTENDANCE_REMINDER_SENT", module: "attendance", after: { date: today, sent }, ip: ctx.ip, userAgent: ctx.userAgent });
  return apiSuccess({ sent }, sent ? `Pengingat dikirim ke ${sent} karyawan.` : "Tidak ada karyawan baru yang perlu diingatkan.");
});
