import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireUser, requirePermission, parseBody, BadRequest, Conflict, Forbidden, NotFound } from "@/lib/guard";
import { checkPermission } from "@/lib/rbac";
import { logActivity } from "@/lib/audit/logger";
import KpiTemplate from "@/models/KpiTemplate";
import { DEFAULT_GRADES, validateWeights } from "@/lib/hr/kpi";
import KpiEvaluation from "@/models/KpiEvaluation";
import "@/models/Division";
import "@/models/Position";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "ID tidak valid");

const indicatorSchema = z.object({
  key: z.string().trim().min(1).max(40),
  name: z.string().trim().min(3, "Nama indikator minimal 3 karakter").max(150),
  description: z.string().trim().max(500).default(""),
  target: z.string().trim().max(300).default(""),
  weight: z.number().min(0).max(100),
});

const aspectSchema = z.object({
  key: z.string().trim().min(1).max(40),
  name: z.string().trim().min(3, "Nama aspek minimal 3 karakter").max(150),
  description: z.string().trim().max(500).default(""),
  weight: z.number().min(0).max(100),
  indicators: z.array(indicatorSchema).min(1, "Setiap aspek butuh minimal satu indikator").max(20),
});

const templateSchema = z.object({
  id: z.union([objectId, z.literal("")]).optional(),
  name: z.string().trim().min(3, "Nama template minimal 3 karakter").max(150),
  description: z.string().trim().max(1000).default(""),
  periodType: z.enum(["monthly", "quarterly", "semester", "yearly"]).default("quarterly"),
  scoreMode: z.enum(["scale_5", "scale_10", "percent"]).default("scale_5"),
  aspects: z.array(aspectSchema).min(1, "Template butuh minimal satu aspek").max(12),
  divisionIds: z.array(objectId).max(50).default([]),
  positionIds: z.array(objectId).max(50).default([]),
  grades: z
    .array(z.object({ min: z.number().min(0).max(100), label: z.string().trim().max(50), tone: z.string().max(20) }))
    .max(8)
    .default([]),
  allowSelfAssessment: z.boolean().default(false),
  showLogo: z.boolean().default(false),
  logoUrl: z
    .string()
    .max(400_000, "Logo terlalu besar. Perkecil gambarnya lebih dulu.")
    .refine((v) => v === "" || v.startsWith("data:image/"), "Logo harus berupa data URL gambar")
    .default(""),
  logoHeight: z.number().min(6).max(40).default(14),
  isActive: z.boolean().default(true),
});

/* ------------------------------------------------------------------ */

export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const perm = await checkPermission(ctx.user.id, "kpi", "read");
  if (!perm.allowed) throw Forbidden("Anda tidak memiliki izin melihat template KPI.");

  const sp = new URL(req.url).searchParams;
  const filter: Record<string, unknown> = {};
  if (sp.get("active") === "1") filter.isActive = true;

  const templates = await KpiTemplate.find(filter)
    .populate("divisionIds", "name")
    .populate("positionIds", "name")
    .sort({ isActive: -1, name: 1 })
    .lean();

  // How many appraisals reference each template, so the UI can warn before an
  // edit that would reshape historical forms.
  const usage = await KpiEvaluation.aggregate<{ _id: unknown; n: number }>([
    { $group: { _id: "$templateId", n: { $sum: 1 } } },
  ]);
  const usageMap = new Map(usage.map((u) => [String(u._id), u.n]));

  return apiSuccess(
    templates.map((t) => ({ ...t, usageCount: usageMap.get(String(t._id)) ?? 0 })),
    "Berhasil memuat template KPI"
  );
});

/* ------------------------------------------------------------------ */

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "kpi", "write");
  const body = await parseBody(req, templateSchema);

  // Weight arithmetic is checked in one place and reported all at once, so the
  // form can show every problem instead of one per save attempt.
  const problems = validateWeights(body.aspects);
  if (problems.length) {
    throw BadRequest(problems[0], problems);
  }

  // Duplicate indicator keys inside one template would make the evaluation
  // scores ambiguous when they are matched back on save.
  const keys = body.aspects.flatMap((a) => a.indicators.map((i) => `${a.key}.${i.key}`));
  if (new Set(keys).size !== keys.length) {
    throw BadRequest("Terdapat indikator dengan kode yang sama dalam satu aspek.");
  }

  const payload = {
    name: body.name,
    description: body.description,
    periodType: body.periodType,
    scoreMode: body.scoreMode,
    aspects: body.aspects,
    divisionIds: body.divisionIds,
    positionIds: body.positionIds,
    grades: body.grades.length ? body.grades : DEFAULT_GRADES,
    allowSelfAssessment: body.allowSelfAssessment,
    showLogo: body.showLogo,
    logoUrl: body.logoUrl,
    logoHeight: body.logoHeight,
    isActive: body.isActive,
  };

  if (body.id) {
    const existing = await KpiTemplate.findById(body.id);
    if (!existing) throw NotFound("Template KPI tidak ditemukan.");

    const updated = await KpiTemplate.findByIdAndUpdate(body.id, payload, { new: true });

    void logActivity({
      userId: ctx.user.id,
      action: "UPDATE_KPI_TEMPLATE",
      module: "kpi",
      before: { name: existing.name, aspects: existing.aspects?.length },
      after: { name: updated!.name, aspects: updated!.aspects?.length },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    const used = await KpiEvaluation.countDocuments({ templateId: body.id });
    return apiSuccess(
      updated,
      used > 0
        ? `Template "${body.name}" diperbarui. ${used} penilaian yang sudah ada tetap memakai struktur saat penilaian itu dibuat.`
        : `Template "${body.name}" diperbarui.`
    );
  }

  const template = await KpiTemplate.create({ ...payload, createdBy: ctx.user.id });

  void logActivity({
    userId: ctx.user.id,
    action: "CREATE_KPI_TEMPLATE",
    module: "kpi",
    after: { name: template.name },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(template, `Template "${body.name}" dibuat.`, undefined, 201);
});

/* ------------------------------------------------------------------ */

export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "kpi", "delete");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw BadRequest("ID template wajib disertakan.");

  const template = await KpiTemplate.findById(id);
  if (!template) throw NotFound("Template KPI tidak ditemukan.");

  const used = await KpiEvaluation.countDocuments({ templateId: id });
  if (used > 0) {
    throw Conflict(
      `Template ini dipakai oleh ${used} penilaian dan tidak dapat dihapus. ` +
        `Nonaktifkan saja agar tidak muncul saat membuat penilaian baru, sementara riwayatnya tetap utuh.`
    );
  }

  await template.deleteOne();

  void logActivity({
    userId: ctx.user.id,
    action: "DELETE_KPI_TEMPLATE",
    module: "kpi",
    before: { name: template.name },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess({ id }, `Template "${template.name}" dihapus.`);
});
