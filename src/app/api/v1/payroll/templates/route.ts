import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireUser, requireCompanyPermission as requirePermission, parseBody, BadRequest, Conflict, Forbidden, NotFound } from "@/lib/guard";
import { checkPermission } from "@/lib/rbac";
import { logActivity } from "@/lib/audit/logger";
import { getSettings } from "@/lib/settings";
import PayslipTemplate from "@/models/PayslipTemplate";
import { requireProFeature } from "@/lib/licensing/server";
import {
  DEFAULT_BLOCKS,
  DEFAULT_EMPLOYEE_FIELDS,
  EMPLOYEE_FIELD_LABELS,
} from "@/lib/hr/payslip";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "ID tidak valid");

const blockSchema = z.object({
  type: z.enum([
    "header",
    "employee_info",
    "earnings",
    "deductions",
    "net_salary",
    "attendance",
    "note",
    "signature",
  ]),
  enabled: z.boolean().default(true),
  title: z.string().trim().max(120).default(""),
  options: z.record(z.string(), z.unknown()).default({}),
});

const templateSchema = z.object({
  id: z.union([objectId, z.literal("")]).optional(),
  name: z.string().trim().min(3, "Nama template minimal 3 karakter").max(120),
  description: z.string().trim().max(500).default(""),
  isDefault: z.boolean().default(false),
  paperSize: z.enum(["A4", "Letter"]).default("A4"),
  accentColor: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Warna harus berformat heksadesimal, misalnya #4f46e5")
    .default("#4f46e5"),
  baseFontSize: z.number().min(9).max(16).default(12),
  margin: z.number().min(5).max(40).default(18),
  showLogo: z.boolean().default(false),
  // A data URL, not a link: see the branding/logo route for why printing
  // cannot depend on fetching the image. Capped so a template row stays small.
  logoUrl: z
    .string()
    .max(400_000, "Logo terlalu besar. Perkecil gambarnya lebih dulu.")
    .refine((v) => v === "" || /^data:image\//.test(v), "Logo harus berupa data URL gambar")
    .default(""),
  logoHeight: z.number().min(6).max(40).default(14),
  companyName: z.string().trim().max(160).default(""),
  companyAddress: z.string().trim().max(400).default(""),
  documentTitle: z.string().trim().max(120).default("SLIP GAJI KARYAWAN"),
  footerNote: z.string().trim().max(1500).default(""),
  employeeFields: z.array(z.string().trim().max(40)).max(20).default(DEFAULT_EMPLOYEE_FIELDS),
  signatories: z
    .array(z.object({ label: z.string().trim().max(60), name: z.string().trim().max(120) }))
    .max(3)
    .default([]),
  blocks: z.array(blockSchema).min(1, "Template butuh minimal satu blok"),
});

/* ------------------------------------------------------------------ */

export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  await requireProFeature("payroll.advanced");
  const perm = await checkPermission(ctx.user.id, "payroll", "read");
  if (!perm.allowed) throw Forbidden("Anda tidak memiliki izin melihat template slip gaji.");

  const templates = await PayslipTemplate.find({}).sort({ isDefault: -1, name: 1 }).lean();

  // The first time this screen is opened there is nothing to edit, so the
  // company identity from Settings is offered as a starting point rather than
  // an empty form.
  const settings = await getSettings();

  return apiSuccess(
    {
      templates,
      fieldOptions: Object.entries(EMPLOYEE_FIELD_LABELS).map(([id, label]) => ({ id, label })),
      defaults: {
        blocks: DEFAULT_BLOCKS,
        employeeFields: DEFAULT_EMPLOYEE_FIELDS,
        companyName: String(settings.company_name ?? ""),
        companyAddress: String(settings.company_address ?? ""),
      },
    },
    "Berhasil memuat template slip gaji"
  );
});

/* ------------------------------------------------------------------ */

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "payroll", "write");
  await requireProFeature("payroll.advanced");
  const body = await parseBody(req, templateSchema);

  // A slip with no money on it is a configuration mistake, not a design choice.
  const hasMoney = body.blocks.some(
    (b) => b.enabled && (b.type === "earnings" || b.type === "net_salary")
  );
  if (!hasMoney) {
    throw BadRequest(
      "Aktifkan minimal blok Rincian penghasilan atau Gaji bersih. Slip tanpa keduanya tidak menyampaikan informasi apa pun."
    );
  }

  const payload = { ...body, id: undefined };
  delete (payload as Record<string, unknown>).id;

  let template;
  if (body.id) {
    const existing = await PayslipTemplate.findById(body.id);
    if (!existing) throw NotFound("Template tidak ditemukan.");
    Object.assign(existing, payload);
    await existing.save();
    template = existing;
  } else {
    template = await PayslipTemplate.create({ ...payload, createdBy: ctx.user.id });
  }

  // Exactly one default, enforced here rather than trusted from the client.
  if (body.isDefault) {
    await PayslipTemplate.updateMany({ _id: { $ne: template._id } }, { isDefault: false });
  } else {
    const anyDefault = await PayslipTemplate.countDocuments({ isDefault: true });
    if (anyDefault === 0) {
      template.isDefault = true;
      await template.save();
    }
  }

  void logActivity({
    userId: ctx.user.id,
    action: body.id ? "UPDATE_PAYSLIP_TEMPLATE" : "CREATE_PAYSLIP_TEMPLATE",
    module: "payroll",
    after: { name: template.name, isDefault: template.isDefault },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    template,
    template.isDefault
      ? `Template "${body.name}" disimpan dan dijadikan template utama untuk slip gaji baru.`
      : `Template "${body.name}" disimpan.`
  );
});

/* ------------------------------------------------------------------ */

export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "payroll", "delete");
  await requireProFeature("payroll.advanced");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw BadRequest("ID template wajib disertakan.");

  const template = await PayslipTemplate.findById(id);
  if (!template) throw NotFound("Template tidak ditemukan.");

  const remaining = await PayslipTemplate.countDocuments({ _id: { $ne: id } });
  if (remaining === 0) {
    throw Conflict(
      "Ini satu-satunya template yang tersisa. Buat template lain terlebih dahulu sebelum menghapus yang ini."
    );
  }

  await template.deleteOne();

  // Never leave the system without a default to fall back on.
  if (template.isDefault) {
    const next = await PayslipTemplate.findOne({}).sort({ createdAt: 1 });
    if (next) {
      next.isDefault = true;
      await next.save();
    }
  }

  void logActivity({
    userId: ctx.user.id,
    action: "DELETE_PAYSLIP_TEMPLATE",
    module: "payroll",
    before: { name: template.name },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess({ id }, `Template "${template.name}" dihapus.`);
});
