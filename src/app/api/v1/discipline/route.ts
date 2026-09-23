import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { parseBody, pagination, NotFound, BadRequest, Conflict, enforceRateLimit } from "@/lib/guard";
import { requireDisciplineAdmin, disciplineCaseFilter, disciplineEmployeeFilter } from "@/lib/hr/discipline-server";
import { checkPermission } from "@/lib/rbac";
import { DISCIPLINE_ACTIONS, canTransitionDiscipline } from "@/lib/hr/discipline";
import DisciplineCase from "@/models/DisciplineCase";
import Employee from "@/models/Employee";
import { logActivity } from "@/lib/audit/logger";
import { requireProFeature } from "@/lib/licensing/server";
import { dispatchWebhook } from "@/lib/integrations/webhooks";

const id = z.string().regex(/^[a-fA-F0-9]{24}$/);
const date = z.string().datetime({ offset: true });
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireDisciplineAdmin(req, "read");
  await requireProFeature("discipline.workflow");
  const { page, limit, skip } = pagination(req, 25, 100);
  const sp = new URL(req.url).searchParams;
  if (sp.get("view") === "access") {
    return apiSuccess({ write: (await checkPermission(ctx.user.id, "discipline", "write")).allowed, approve: (await checkPermission(ctx.user.id, "discipline", "approve")).allowed });
  }
  if (sp.get("view") === "employees") {
    const writer = await requireDisciplineAdmin(req, "write");
    const query = sp.get("q")?.trim().slice(0, 100) ?? "";
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rows = await Employee.find({ $and: [disciplineEmployeeFilter(writer, true), { $or: [{ name: { $regex: escaped, $options: "i" } }, { employeeId: { $regex: escaped, $options: "i" } }] }] }).select("name employeeId").sort({ name: 1 }).limit(100).lean();
    return apiSuccess(rows);
  }
  const filter: Record<string, unknown> = { $and: [await disciplineCaseFilter(ctx)] };
  if (sp.get("id")) { if (!id.safeParse(sp.get("id")).success) throw BadRequest("ID kasus tidak valid."); filter._id = sp.get("id"); }
  if (sp.get("employeeId")) { if (!id.safeParse(sp.get("employeeId")).success) throw BadRequest("ID karyawan tidak valid."); filter.employeeId = sp.get("employeeId"); }
  if (sp.get("status")) {
    if (!["open", "issued", "rejected", "closed"].includes(sp.get("status")!)) throw BadRequest("Status tidak valid.");
    filter.status = sp.get("status");
  }
  const [rows, total] = await Promise.all([DisciplineCase.find(filter).populate("employeeId", "name employeeId").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), DisciplineCase.countDocuments(filter)]);
  const response = apiSuccess(rows, undefined, { page, limit, total });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
const create = z.object({ employeeId: id, category: z.enum(["misconduct", "fatal", "separation"]), title: z.string().trim().min(5).max(150), description: z.string().trim().min(15).max(5000), evidence: z.string().trim().max(2000).default(""), employeeStatement: z.string().trim().max(3000).default(""), action: z.enum(DISCIPLINE_ACTIONS), occurredAt: date }).strict();
export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireDisciplineAdmin(req, "write");
  await requireProFeature("discipline.workflow");
  enforceRateLimit("discipline-create", ctx.user.id, { max: 20, windowMs: 60_000 });
  const body = await parseBody(req, create);
  if (body.action === "resignation" && body.category !== "separation") throw BadRequest("Resign adalah pengunduran diri, bukan pelanggaran.");
  if (!await Employee.exists({ $and: [{ _id: body.employeeId }, disciplineEmployeeFilter(ctx, true)] })) throw NotFound("Karyawan tidak ditemukan dalam lingkup tindakan Anda.");
  const row = await DisciplineCase.create({ ...body, createdBy: ctx.user.id, history: [{ actorId: ctx.user.id, status: "open", note: "Kasus dicatat untuk ditinjau." }] });
  void logActivity({ userId: ctx.user.id, action: "DISCIPLINE_CREATED", module: "employees", after: { caseId: String(row._id) } });
  void dispatchWebhook("discipline.case_created", { caseId: String(row._id), employeeId: body.employeeId, category: body.category, action: body.action }).catch((error) => console.error("[WEBHOOK]", error instanceof Error ? error.message : "failed"));
  return apiSuccess({ id: row._id }, "Kasus dicatat; belum ada sanksi yang diterbitkan.", undefined, 201);
});
const decision = z.object({ id, revision: z.number().int().min(0), status: z.enum(["issued", "rejected", "closed"]), action: z.enum(DISCIPLINE_ACTIONS), note: z.string().trim().min(15).max(3000), effectiveAt: date.optional(), expiresAt: date.optional(), confirmed: z.literal(true) }).strict();
export const PATCH = wrapRouteHandler(async (req) => {
  const ctx = await requireDisciplineAdmin(req, "approve");
  await requireProFeature("discipline.workflow");
  enforceRateLimit("discipline-decide", ctx.user.id, { max: 20, windowMs: 60_000 });
  const body = await parseBody(req, decision);
  const current = await DisciplineCase.findOne({ _id: body.id, ...await disciplineCaseFilter(ctx, true) });
  if (!current) throw NotFound();
  if (!canTransitionDiscipline(current.status, body.status)) throw Conflict("Transisi status tidak diizinkan.");
  if (body.status === "issued" && !body.effectiveAt) throw BadRequest("Tanggal efektif wajib diisi.");
  if (body.expiresAt && (!body.effectiveAt || new Date(body.expiresAt) < new Date(body.effectiveAt))) throw BadRequest("Akhir berlaku harus setelah tanggal efektif.");
  if (body.action === "resignation" && current.category !== "separation") throw BadRequest("Resign tidak boleh dijadikan sanksi.");
  if (body.status === "closed" && body.action !== current.action) throw BadRequest("Tindakan yang telah diterbitkan tidak boleh diubah saat ditutup.");
  const row = await DisciplineCase.findOneAndUpdate({ _id: body.id, revision: body.revision, status: current.status }, {
    $set: { status: body.status, action: body.action, ...(body.status === "issued" ? { effectiveAt: new Date(body.effectiveAt!), expiresAt: body.expiresAt ? new Date(body.expiresAt) : null } : {}) },
    $inc: { revision: 1 }, $push: { history: { actorId: ctx.user.id, status: body.status, note: body.note, at: new Date() } },
  }, { new: true, runValidators: true });
  if (!row) throw Conflict("Kasus telah diperbarui pengguna lain. Muat ulang sebelum memutuskan.");
  void logActivity({ userId: ctx.user.id, action: "DISCIPLINE_DECIDED", module: "employees", after: { caseId: body.id, status: body.status, action: body.action } });
  void dispatchWebhook("discipline.case_decided", { caseId: body.id, status: body.status, action: body.action }).catch((error) => console.error("[WEBHOOK]", error instanceof Error ? error.message : "failed"));
  return apiSuccess({ id: row._id }, "Keputusan dicatat. Status kerja dan akses login tidak diubah otomatis.");
});
