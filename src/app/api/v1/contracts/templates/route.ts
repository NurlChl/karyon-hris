import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requirePermission, parseBody, BadRequest, Conflict, NotFound } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { DEFAULT_CONTRACT_TEMPLATES, CONTRACT_TYPES } from "@/lib/hr/contracts";
import ContractTemplate from "@/models/ContractTemplate";
import Contract from "@/models/Contract";

/** Contract document templates. Seeds three starting templates the first time. */
export const GET = wrapRouteHandler(async (req) => {
  await requirePermission(req, "contracts", "read");
  if ((await ContractTemplate.estimatedDocumentCount()) === 0) {
    await ContractTemplate.insertMany(DEFAULT_CONTRACT_TEMPLATES, { ordered: false }).catch(() => {});
  }
  const templates = await ContractTemplate.find({}).sort({ name: 1 }).lean();
  return apiSuccess(templates);
});

const templateSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  name: z.string().trim().min(3).max(80),
  type: z.enum(CONTRACT_TYPES.map((t) => t.value) as [string, ...string[]]),
  content: z.string().trim().min(20, "Isi dokumen terlalu pendek.").max(100_000),
  isActive: z.boolean().default(true),
  showLogo: z.boolean().default(false),
  logoUrl: z.string().max(400_000).default(""),
  logoHeight: z.number().min(6).max(40).default(14),
  signerName: z.string().trim().max(120).default(""),
  signerTitle: z.string().trim().max(120).default(""),
  city: z.string().trim().max(80).default(""),
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "contracts", "write");
  const { id, ...body } = await parseBody(req, templateSchema);
  if (body.logoUrl && !body.logoUrl.startsWith("data:image/")) throw BadRequest("Logo tidak valid.");
  if (await ContractTemplate.exists({ name: body.name, ...(id ? { _id: { $ne: id } } : {}) })) {
    throw Conflict(`Template "${body.name}" sudah ada.`);
  }
  const saved = id
    ? await ContractTemplate.findByIdAndUpdate(id, body, { new: true })
    : await ContractTemplate.create(body);
  if (!saved) throw NotFound("Template tidak ditemukan.");
  void logActivity({ userId: ctx.user.id, action: id ? "UPDATE_CONTRACT_TEMPLATE" : "CREATE_CONTRACT_TEMPLATE", module: "contracts", after: { name: body.name }, ip: ctx.ip, userAgent: ctx.userAgent });
  return apiSuccess(saved, `Template "${body.name}" disimpan. Kontrak yang sudah dibuat tidak ikut berubah.`);
});

export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "contracts", "write");
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-fA-F]{24}$/.test(id)) throw BadRequest("ID tidak valid.");
  const tpl = await ContractTemplate.findById(id);
  if (!tpl) throw NotFound("Template tidak ditemukan.");
  // Contracts keep their own copy of the text, but still point at the template
  // for letterhead and signer; those are deactivated instead of deleted.
  if (await Contract.exists({ generatedFromTemplateId: id })) {
    tpl.isActive = false;
    await tpl.save();
    return apiSuccess({ deactivated: true }, `"${tpl.name}" dipakai kontrak yang sudah ada, jadi dinonaktifkan.`);
  }
  await tpl.deleteOne();
  void logActivity({ userId: ctx.user.id, action: "DELETE_CONTRACT_TEMPLATE", module: "contracts", after: { name: tpl.name }, ip: ctx.ip, userAgent: ctx.userAgent });
  return apiSuccess({ deleted: true }, `"${tpl.name}" dihapus.`);
});
