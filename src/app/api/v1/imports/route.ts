import { z } from "zod";
import { apiSuccess, wrapRouteHandler } from "@/lib/api";
import { BadRequest, enforceRateLimit, parseBody, parseQuery, requireCompanyPermission } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { IMPORT_DATASETS, type ImportDataset } from "@/lib/import/catalog";
import { CsvError, MAX_IMPORT_BYTES, toCsvTemplate } from "@/lib/import/csv";
import { planImport } from "@/lib/import/datasets";

const datasets = Object.keys(IMPORT_DATASETS) as [ImportDataset, ...ImportDataset[]];

/** Downloads the CSV template (header + one example row) for a dataset. */
export const GET = wrapRouteHandler(async (req) => {
  const { dataset } = parseQuery(req, z.object({ dataset: z.enum(datasets) }));
  const meta = IMPORT_DATASETS[dataset];
  await requireCompanyPermission(req, meta.module, "write");
  return new Response(toCsvTemplate([...meta.fields], [...meta.example]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="template-impor-${dataset}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
});

const body = z.object({
  dataset: z.enum(datasets),
  csv: z.string().min(1).max(MAX_IMPORT_BYTES),
  /** false = validate only (preview). true = validate again and write in one transaction. */
  commit: z.boolean().default(false),
}).strict();

/**
 * CSV import: preview validates every row without writing; commit re-validates
 * the same file and writes all rows in one transaction, or nothing when any
 * row has an error. Company-wide `write` on the module is required.
 */
export const POST = wrapRouteHandler(async (req) => {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_IMPORT_BYTES * 2) throw BadRequest("Berkas terlalu besar (maksimal 1 MB).");
  const input = await parseBody(req, body);
  const meta = IMPORT_DATASETS[input.dataset];
  const ctx = await requireCompanyPermission(req, meta.module, "write");
  enforceRateLimit("import", ctx.user.id, { max: 30, windowMs: 10 * 60_000 });

  let plan;
  try {
    plan = await planImport(input.dataset, input.csv);
  } catch (error) {
    if (error instanceof CsvError) throw BadRequest(error.message);
    throw error;
  }
  const preview = { rows: plan.rows, counts: plan.counts, missingColumns: plan.missingColumns };
  if (!input.commit) return apiSuccess(preview, plan.counts.invalid || plan.missingColumns.length ? "Perbaiki baris yang bermasalah sebelum mengimpor." : "Semua baris valid dan siap diimpor.");
  if (plan.counts.invalid || plan.missingColumns.length) throw BadRequest("Impor dibatalkan: masih ada baris bermasalah. Tidak ada data yang diubah.", preview);

  const result = await plan.apply();
  void logActivity({
    userId: ctx.user.id,
    action: "IMPORT_DATA",
    module: meta.module,
    after: { dataset: input.dataset, created: result.created, updated: result.updated, accounts: result.credentials.length },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  const response = apiSuccess(
    { ...preview, created: result.created, updated: result.updated, credentials: result.credentials },
    `Impor selesai: ${result.created} ditambahkan, ${result.updated} diperbarui.`
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
