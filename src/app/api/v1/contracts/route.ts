import { RecordId } from "@/lib/postgres";
import { z } from "zod";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requirePermission, requireCompanyPermission, requireUser, parseBody, pagination, employeeRecordScopeFilter, BadRequest, Conflict, NotFound } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { attachmentInputSchema } from "@/lib/attachments";
import { attachmentRefHref, resolveSingleAttachment } from "@/lib/uploads";
import { CONTRACT_TYPE_MAP, CONTRACT_TYPES, type ContractType } from "@/lib/hr/contracts";
import { wibDateKey, wibEndOfDay, wibStartOfDay } from "@/lib/time";
import Contract from "@/models/Contract";
import ContractTemplate from "@/models/ContractTemplate";
import Counter from "@/models/Counter";
import Employee from "@/models/Employee";
import "@/models/Position";
import "@/models/Division";
import "@/models/Branch";

/**
 * Employment contracts.
 *
 * `view=expiring` is the working list HR opens each week: active contracts with
 * an end date inside the window, plus ended ones nobody has decided about yet.
 * `view=mine` is the employee's own list for the portal.
 */

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "ID tidak valid");
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid");
const TYPE_VALUES = CONTRACT_TYPES.map((t) => t.value) as [ContractType, ...ContractType[]];

function escapeRegex(v: string) {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function daysLeft(endDate?: Date | null) {
  if (!endDate) return null;
  const today = wibStartOfDay(wibDateKey()).getTime();
  return Math.round((wibStartOfDay(wibDateKey(endDate)).getTime() - today) / 86_400_000);
}

export const GET = wrapRouteHandler(async (req) => {
  const sp = new URL(req.url).searchParams;
  const view = sp.get("view") ?? "all";

  if (view === "mine") {
    const ctx = await requireUser(req);
    if (!ctx.user.employeeId) return apiSuccess([]);
    const rows = await Contract.find({ employeeId: ctx.user.employeeId, status: { $ne: "draft" } })
      .select("contractNumber type customTypeLabel startDate endDate positionName status signedFile signedFileName signedAt")
      .sort({ startDate: -1 })
      .lean<Array<Record<string, unknown>>>();
    return apiSuccess(
      await Promise.all(
        rows.map(async (r) => ({ ...r, signedFile: await attachmentRefHref(r.signedFile as string), daysLeft: daysLeft(r.endDate as Date) }))
      )
    );
  }

  const ctx = await requirePermission(req, "contracts", "read");
  const { page, limit, skip } = pagination(req, 25, 100);
  const filter: Record<string, unknown> = {
    ...(await employeeRecordScopeFilter(ctx)),
  };

  const today = wibStartOfDay(wibDateKey());
  if (view === "expiring") {
    const days = Math.min(365, Math.max(1, Number(sp.get("days")) || 60));
    const horizon = wibEndOfDay(wibDateKey(new Date(today.getTime() + days * 86_400_000)));
    filter.decision = "pending";
    filter.endDate = { $ne: null, $lte: horizon };
    filter.status = { $in: ["active", "ended", "expired"] };
    // A contract replaced by a newer one is no longer awaiting a decision.
    filter.nextContractId = null;
  } else {
    const status = sp.get("status");
    if (status) filter.status = status === "ended" ? { $in: ["ended", "expired"] } : status;
    const decision = sp.get("decision");
    if (decision) filter.decision = decision;
  }

  const type = sp.get("type");
  if (type) filter.type = type;
  const employeeId = sp.get("employeeId");
  const restrictions: Record<string, unknown>[] = [];
  if (employeeId) {
    if (!objectId.safeParse(employeeId).success) throw BadRequest("ID tidak valid");
    restrictions.push({ employeeId: new RecordId(employeeId) });
  }
  if (ctx.permission.scope === "self") restrictions.push({ status: { $ne: "draft" } });
  if (restrictions.length) filter.$and = restrictions;

  const q = sp.get("q")?.trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 60)), "i");
    const ids = await Employee.find({ $or: [{ name: rx }, { employeeId: rx }] }).select("_id").limit(500).lean<Array<{ _id: RecordId }>>();
    filter.$or = [{ contractNumber: rx }, { employeeId: { $in: ids.map((i) => i._id) } }];
  }

  const [rows, total, counts] = await Promise.all([
    Contract.find(filter)
      .populate({
        path: "employeeId",
        select: "name employeeId divisionId branchId positionId status",
        populate: [
          { path: "divisionId", select: "name" },
          { path: "branchId", select: "name" },
          { path: "positionId", select: "name" },
        ],
      })
      .sort(view === "expiring" ? { endDate: 1 } : { startDate: -1 })
      .skip(skip)
      .limit(limit)
      .lean<Array<Record<string, unknown>>>(),
    Contract.countDocuments(filter),
    ctx.permission.scope === "all" ? summaryCounts(today) : Promise.resolve(null),
  ]);

  return apiSuccess(
    {
      rows: rows.map((r) => ({ ...r, daysLeft: daysLeft(r.endDate as Date), hasSignedFile: Boolean(r.signedFile) })),
      counts,
    },
    undefined,
    { page, limit, total }
  );
});

async function summaryCounts(today: Date) {
  const in30 = wibEndOfDay(wibDateKey(new Date(today.getTime() + 30 * 86_400_000)));
  const in60 = wibEndOfDay(wibDateKey(new Date(today.getTime() + 60 * 86_400_000)));
  const pending = { decision: "pending", nextContractId: null };
  const [within30, within60, overdue, active, unsigned] = await Promise.all([
    Contract.countDocuments({ ...pending, status: "active", endDate: { $gte: today, $lte: in30 } }),
    Contract.countDocuments({ ...pending, status: "active", endDate: { $gte: today, $lte: in60 } }),
    Contract.countDocuments({ ...pending, endDate: { $ne: null, $lt: today }, status: { $in: ["active", "ended", "expired"] } }),
    Contract.countDocuments({ status: "active" }),
    Contract.countDocuments({ status: "active", signedFile: "" }),
  ]);
  return { within30, within60, overdue, active, unsigned };
}

/* ------------------------------------------------------------------ */
/* POST — create (new, renewal, or promotion to permanent)              */
/* ------------------------------------------------------------------ */

const createSchema = z
  .object({
    employeeId: objectId,
    type: z.enum(TYPE_VALUES),
    customTypeLabel: z.string().trim().max(60).default(""),
    startDate: dateKey,
    endDate: dateKey.or(z.literal("")).optional(),
    positionName: z.string().trim().max(120).default(""),
    basicSalary: z.number().min(0).max(1e12).default(0),
    allowances: z.number().min(0).max(1e12).default(0),
    templateId: objectId.or(z.literal("")).optional(),
    body: z.string().max(100_000).optional(),
    notes: z.string().trim().max(2000).default(""),
    status: z.enum(["draft", "active"]).default("active"),
    previousContractId: objectId.or(z.literal("")).optional(),
    updateEmployeeStatus: z.boolean().default(true),
    signed: attachmentInputSchema.optional(),
  })
  .refine((v) => !CONTRACT_TYPE_MAP[v.type].hasEndDate || Boolean(v.endDate), {
    message: "Isi tanggal berakhir untuk jenis kontrak ini.",
    path: ["endDate"],
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: "Tanggal berakhir harus setelah tanggal mulai.",
    path: ["endDate"],
  })
  .refine((v) => v.type !== "lainnya" || v.customTypeLabel.length >= 2, {
    message: "Tuliskan nama jenis kontraknya.",
    path: ["customTypeLabel"],
  });

async function nextContractNumber(type: ContractType, startKey: string) {
  const year = startKey.slice(0, 4);
  const counter = await Counter.findOneAndUpdate(
    { key: `contract:${year}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  const code = type === "lainnya" ? "PK" : CONTRACT_TYPE_MAP[type].short.toUpperCase().replace(/\s+/g, "");
  return `${code}/${year}/${String(counter.seq).padStart(4, "0")}`;
}

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireCompanyPermission(req, "contracts", "write");
  const body = await parseBody(req, createSchema);

  const employee = await Employee.findById(body.employeeId)
    .select("name positionId")
    .populate("positionId", "name")
    .lean<{ _id: RecordId; name: string; positionId?: { name?: string } | null } | null>();
  if (!employee) throw NotFound("Karyawan tidak ditemukan.");

  let previous = null;
  if (body.previousContractId) {
    previous = await Contract.findById(body.previousContractId);
    if (!previous || String(previous.employeeId) !== body.employeeId) throw BadRequest("Kontrak sebelumnya tidak cocok dengan karyawan ini.");
    if (previous.nextContractId) throw Conflict("Kontrak sebelumnya sudah punya kontrak lanjutan.");
  }

  // Two active contracts overlapping in time for one person is almost always a
  // mistake; a renewal is expected to start after the previous one ends.
  if (body.status === "active") {
    const overlap = await Contract.findOne({
      employeeId: body.employeeId,
      status: "active",
      _id: { $ne: previous?._id },
      startDate: { $lte: body.endDate ? wibEndOfDay(body.endDate) : new Date(8.64e15) },
      $or: [{ endDate: null }, { endDate: { $gte: wibStartOfDay(body.startDate) } }],
    }).lean<{ contractNumber: string } | null>();
    if (overlap) {
      throw Conflict(`Tanggalnya beririsan dengan kontrak aktif ${overlap.contractNumber || "lain"}. Akhiri atau ubah kontrak itu dulu.`);
    }
  }

  let content = body.body ?? "";
  if (!content && body.templateId) {
    const template = await ContractTemplate.findById(body.templateId).lean<{ content: string } | null>();
    content = template?.content ?? "";
  }

  const contractId = new RecordId();
  const signedFile = body.signed
    ? await resolveSingleAttachment({
        input: body.signed,
        context: "contract",
        ownerUserId: ctx.user.id,
        destination: `employees/${body.employeeId}/contracts`,
      })
    : "";

  const contract = await Contract.create({
    _id: contractId,
    employeeId: body.employeeId,
    contractNumber: await nextContractNumber(body.type, body.startDate),
    type: body.type,
    customTypeLabel: body.type === "lainnya" ? body.customTypeLabel : "",
    startDate: wibStartOfDay(body.startDate),
    endDate: CONTRACT_TYPE_MAP[body.type].hasEndDate && body.endDate ? wibStartOfDay(body.endDate) : null,
    positionName: body.positionName || employee.positionId?.name || "",
    salarySnapshot: { basicSalary: body.basicSalary, allowances: body.allowances },
    status: body.status,
    generatedFromTemplateId: body.templateId || null,
    body: content,
    notes: body.notes,
    previousContractId: previous?._id ?? null,
    signedFile,
    signedFileName: body.signed?.kind === "file" ? body.signed.name ?? "Kontrak ditandatangani" : signedFile ? "Tautan dokumen" : "",
    signedAt: signedFile ? new Date() : null,
    createdBy: ctx.user.id,
  });

  if (previous) {
    previous.nextContractId = contract._id as RecordId;
    previous.decision = body.type === "pkwtt" ? "permanent" : "renew";
    previous.decidedAt = new Date();
    previous.decidedBy = new RecordId(ctx.user.id);
    await previous.save();
  }

  if (body.status === "active" && body.updateEmployeeStatus) {
    await Employee.updateOne({ _id: body.employeeId }, { $set: { employmentStatus: body.type } });
  }

  void logActivity({
    userId: ctx.user.id,
    action: previous ? "RENEW_CONTRACT" : "CREATE_CONTRACT",
    module: "contracts",
    after: { employee: employee.name, number: contract.contractNumber, type: body.type, start: body.startDate, end: body.endDate ?? null },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { _id: contract._id, contractNumber: contract.contractNumber },
    `Kontrak ${contract.contractNumber} untuk ${employee.name} ${body.status === "draft" ? "disimpan sebagai draf" : "dibuat"}.` +
      (previous ? " Kontrak sebelumnya ditandai sudah ditindaklanjuti." : ""),
    undefined,
    201
  );
});
