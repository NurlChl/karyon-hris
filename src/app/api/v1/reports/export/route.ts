import { z } from "zod";
import { wrapRouteHandler } from "@/lib/api";
import { BadRequest, enforceRateLimit, parseQuery, requirePermission } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { wibDateKey, wibPeriodKey } from "@/lib/time";
import { EXPORT_DATASETS, type ExportDataset } from "@/lib/export/catalog";
import { buildExport } from "@/lib/export/datasets";
import { toCsv } from "@/lib/export/table";
import { toXlsx } from "@/lib/export/xlsx";

const datasets = Object.keys(EXPORT_DATASETS) as [ExportDataset, ...ExportDataset[]];
const query = z.object({
  dataset: z.enum(datasets),
  format: z.enum(["csv", "xlsx"]).default("xlsx"),
  period: z.string().regex(/^\d{4}(-(0[1-9]|1[0-2])|-Q[1-4]|-H[12])?$/, "Periode: YYYY-MM, YYYY-Q1..Q4, YYYY-H1/H2, atau YYYY").optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus YYYY-MM-DD").optional(),
  branchId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
});

/**
 * CSV or Excel export for every list module. Requires `export` on the
 * dataset's module; rows follow the caller's data scope, and each export is
 * written to the audit log.
 */
export const GET = wrapRouteHandler(async (req) => {
  const params = parseQuery(req, query);
  const meta = EXPORT_DATASETS[params.dataset];
  const ctx = await requirePermission(req, meta.module, "export");
  enforceRateLimit("export", ctx.user.id, { max: 30, windowMs: 10 * 60_000 });

  const period = params.period ?? wibPeriodKey();
  const date = params.date ?? wibDateKey();
  if (meta.needs === "period" && !/^\d{4}-\d{2}$/.test(period)) throw BadRequest("Dataset ini memerlukan periode bulanan YYYY-MM.");
  const table = await buildExport(params.dataset, { period, date, branchId: params.branchId }, ctx);

  void logActivity({
    userId: ctx.user.id,
    action: "EXPORT_REPORT",
    module: meta.module,
    after: { dataset: params.dataset, format: params.format, period: meta.needs === "date" ? date : meta.needs === "none" ? null : period, rowCount: table.rows.length },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  const suffix = meta.needs === "date" ? date : meta.needs === "none" ? wibDateKey() : period;
  const filename = `${params.dataset}-${suffix}.${params.format}`;
  const body = params.format === "csv" ? toCsv(table) : new Uint8Array(toXlsx(table));
  return new Response(body, {
    headers: {
      "Content-Type": params.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
