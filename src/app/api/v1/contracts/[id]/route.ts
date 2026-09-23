import { RecordId } from "@/lib/postgres";
import { z } from "zod";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess, type RouteContext } from "@/lib/api";
import { requireCompanyPermission as requirePermission, requireUser, parseBody, BadRequest, Conflict, Forbidden, NotFound } from "@/lib/guard";
import { checkPermission } from "@/lib/rbac";
import { logActivity } from "@/lib/audit/logger";
import { attachmentInputSchema } from "@/lib/attachments";
import { attachmentRefHref, resolveSingleAttachment } from "@/lib/uploads";
import { contractValues } from "@/lib/hr/contract-values";
import { CONTRACT_TYPE_MAP } from "@/lib/hr/contracts";
import { notifyUsers, resolveRecipientForEmployee, resolveRecipientsByRole } from "@/lib/notification/notify";
import { getSettings } from "@/lib/settings";
import { formatDate, wibDateKey, wibStartOfDay } from "@/lib/time";
import Contract from "@/models/Contract";
import ContractTemplate from "@/models/ContractTemplate";
import Employee from "@/models/Employee";
import User from "@/models/User";

type Ctx = RouteContext<{ id: string }>;

async function loadId(params: Ctx["params"]) {
  const { id } = await params;
  if (!/^[0-9a-fA-F]{24}$/.test(id)) throw BadRequest("ID kontrak tidak valid.");
  return id;
}

/**
 * One contract with everything its page and its printout need: the document
 * text, the values its placeholders resolve to, letterhead settings, the signed
 * scan as a short-lived link, and the chain of earlier and later contracts.
 *
 * An employee may open their own non-draft contract; everyone else needs
 * `contracts:read` with a company-wide scope.
 */
export const GET = wrapRouteHandler<Ctx>(async (req, { params }) => {
  const ctx = await requireUser(req);
  const id = await loadId(params);

  const contract = await Contract.findById(id)
    .populate({
      path: "employeeId",
      select: "name employeeId status employmentStatus divisionId branchId positionId",
      populate: [
        { path: "divisionId", select: "name" },
        { path: "branchId", select: "name" },
        { path: "positionId", select: "name" },
      ],
    })
    .lean<Record<string, unknown> & { employeeId: { _id: RecordId } | null; status: string } | null>();
  if (!contract) throw NotFound("Kontrak tidak ditemukan.");

  const isOwner = Boolean(ctx.user.employeeId) && String(contract.employeeId?._id) === ctx.user.employeeId;
  const perm = await checkPermission(ctx.user.id, "contracts", "read");
  if (!(perm.allowed && perm.scope === "all") && !(isOwner && contract.status !== "draft")) {
    throw Forbidden("Anda tidak memiliki akses ke kontrak ini.");
  }

  const template = contract.generatedFromTemplateId
    ? await ContractTemplate.findById(contract.generatedFromTemplateId).lean<Record<string, unknown> | null>()
    : null;

  const [values, signedHref, chain, settings] = await Promise.all([
    contractValues(
      { ...(contract as unknown as Parameters<typeof contractValues>[0]), employeeId: contract.employeeId?._id ?? "" },
      template as { signerName?: string; signerTitle?: string; city?: string } | null
    ),
    attachmentRefHref(contract.signedFile as string),
    Contract.find({ employeeId: contract.employeeId?._id, status: { $ne: "draft" } })
      .select("contractNumber type customTypeLabel startDate endDate status decision")
      .sort({ startDate: 1 })
      .lean(),
    getSettings(),
  ]);

  // NIK is printed on the contract; only HR sees it, the owner sees their own.
  if (!isOwner && perm.scope !== "all") values.nik = "";

  void logActivity({
    userId: ctx.user.id,
    action: "VIEW_CONTRACT",
    module: "contracts",
    after: { number: contract.contractNumber },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess({
    contract: { ...contract, signedFile: signedHref },
    values,
    branding: {
      companyName: String(settings.company_name ?? ""),
      companyAddress: String(settings.company_address ?? ""),
      showLogo: Boolean(template?.showLogo),
      logoUrl: (template?.logoUrl as string) ?? "",
      logoHeight: (template?.logoHeight as number) ?? 14,
      signerName: (template?.signerName as string) ?? "",
      signerTitle: (template?.signerTitle as string) ?? "",
    },
    chain,
    canEdit: perm.allowed && perm.scope === "all" && (await checkPermission(ctx.user.id, "contracts", "write")).allowed,
  });
});

/* ------------------------------------------------------------------ */
/* PATCH — edit terms, text, or attach the signed scan                  */
/* ------------------------------------------------------------------ */

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const patchSchema = z.object({
  startDate: dateKey.optional(),
  endDate: dateKey.or(z.literal("")).optional(),
  positionName: z.string().trim().max(120).optional(),
  basicSalary: z.number().min(0).max(1e12).optional(),
  allowances: z.number().min(0).max(1e12).optional(),
  body: z.string().max(100_000).optional(),
  templateId: z.string().regex(/^[0-9a-fA-F]{24}$/).or(z.literal("")).optional(),
  notes: z.string().trim().max(2000).optional(),
  signed: attachmentInputSchema.nullable().optional(),
});

export const PATCH = wrapRouteHandler<Ctx>(async (req, { params }) => {
  const ctx = await requirePermission(req, "contracts", "write");
  const id = await loadId(params);
  const body = await parseBody(req, patchSchema);
  const contract = await Contract.findById(id);
  if (!contract) throw NotFound("Kontrak tidak ditemukan.");

  const signedOnly = Object.keys(body).every((k) => k === "signed" || k === "notes");
  // Terms of a signed, active contract are fixed; changing them means an addendum or a new contract.
  if (!signedOnly && contract.signedFile && contract.status !== "draft") {
    throw Conflict("Kontrak ini sudah ditandatangani. Ubah lewat kontrak baru atau lepaskan dulu berkas tanda tangannya.");
  }

  const before = contract.toObject();
  if (body.startDate) contract.startDate = wibStartOfDay(body.startDate);
  if (body.endDate !== undefined && CONTRACT_TYPE_MAP[contract.type as keyof typeof CONTRACT_TYPE_MAP]?.hasEndDate) {
    contract.endDate = body.endDate ? wibStartOfDay(body.endDate) : null;
  }
  if (contract.endDate && contract.endDate < contract.startDate) throw BadRequest("Tanggal berakhir harus setelah tanggal mulai.");
  if (body.positionName !== undefined) contract.positionName = body.positionName;
  if (body.basicSalary !== undefined) contract.salarySnapshot.basicSalary = body.basicSalary;
  if (body.allowances !== undefined) contract.salarySnapshot.allowances = body.allowances;
  if (body.templateId !== undefined) {
    contract.generatedFromTemplateId = body.templateId ? new RecordId(body.templateId) : null;
    if (body.templateId && body.body === undefined) {
      const tpl = await ContractTemplate.findById(body.templateId).lean<{ content: string } | null>();
      if (tpl) contract.body = tpl.content;
    }
  }
  if (body.body !== undefined) contract.body = body.body;
  if (body.notes !== undefined) contract.notes = body.notes;

  if (body.signed === null) {
    contract.signedFile = "";
    contract.signedFileName = "";
    contract.signedAt = null;
  } else if (body.signed) {
    contract.signedFile = await resolveSingleAttachment({
      input: body.signed,
      context: "contract",
      ownerUserId: ctx.user.id,
      destination: `employees/${String(contract.employeeId)}/contracts`,
    });
    contract.signedFileName = body.signed.kind === "file" ? body.signed.name ?? "Kontrak ditandatangani" : "Tautan dokumen";
    contract.signedAt = new Date();
  }

  await contract.save();
  void logActivity({
    userId: ctx.user.id,
    action: body.signed ? "UPLOAD_SIGNED_CONTRACT" : "UPDATE_CONTRACT",
    module: "contracts",
    before: { number: before.contractNumber, startDate: before.startDate, endDate: before.endDate, salary: before.salarySnapshot },
    after: { number: contract.contractNumber, startDate: contract.startDate, endDate: contract.endDate, salary: contract.salarySnapshot, signed: Boolean(contract.signedFile) },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { _id: contract._id },
    body.signed ? "Berkas kontrak bertanda tangan disimpan." : body.signed === null ? "Berkas tanda tangan dilepas." : "Kontrak diperbarui."
  );
});

/* ------------------------------------------------------------------ */
/* POST — activate, decide not to renew, terminate                      */
/* ------------------------------------------------------------------ */

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("activate"), updateEmployeeStatus: z.boolean().default(true) }),
  z.object({
    action: z.literal("not_renew"),
    note: z.string().trim().min(3, "Tuliskan alasan singkat.").max(1000),
    /** Mark the employee as leaving on the contract's end date. */
    markResigned: z.boolean().default(false),
  }),
  z.object({ action: z.literal("reopen_decision") }),
  z.object({
    action: z.literal("terminate"),
    date: dateKey,
    reason: z.string().trim().min(3, "Tuliskan alasan pengakhiran.").max(1000),
  }),
]);

export const POST = wrapRouteHandler<Ctx>(async (req, { params }) => {
  const ctx = await requirePermission(req, "contracts", "write");
  const id = await loadId(params);
  const body = await parseBody(req, actionSchema);
  const contract = await Contract.findById(id);
  if (!contract) throw NotFound("Kontrak tidak ditemukan.");
  const employee = await Employee.findById(contract.employeeId).select("name").lean<{ name: string } | null>();

  let message = "";
  switch (body.action) {
    case "activate": {
      if (contract.status !== "draft") throw Conflict("Hanya draf yang bisa diberlakukan.");
      contract.status = "active";
      if (body.updateEmployeeStatus) {
        await Employee.updateOne({ _id: contract.employeeId }, { $set: { employmentStatus: contract.type } });
      }
      message = `Kontrak ${contract.contractNumber} diberlakukan.`;
      break;
    }
    case "not_renew": {
      if (!contract.endDate) throw BadRequest("Kontrak tanpa tanggal berakhir tidak perlu keputusan perpanjangan.");
      if (contract.nextContractId) throw Conflict("Kontrak ini sudah punya kontrak lanjutan.");
      contract.decision = "not_renew";
      contract.decisionNote = body.note;
      contract.decidedAt = new Date();
      contract.decidedBy = new RecordId(ctx.user.id);
      if (body.markResigned && contract.endDate <= new Date()) {
        await Employee.updateOne({ _id: contract.employeeId }, { $set: { status: "resigned" } });
        await User.updateOne({ employeeId: contract.employeeId }, { $set: { isActive: false } });
      }
      message =
        `${employee?.name ?? "Karyawan"} ditandai tidak diperpanjang; kontraknya berakhir ${formatDate(contract.endDate)}.` +
        (body.markResigned
          ? contract.endDate <= new Date()
            ? " Status karyawan diubah menjadi resign."
            : " Status karyawan otomatis menjadi resign setelah tanggal tersebut."
          : "");
      if (body.markResigned) contract.notes = [contract.notes, "[auto-resign]"].filter(Boolean).join(" ");

      // The employee's supervisor needs to plan for the gap.
      void resolveRecipientsByRole("HRD")
        .then((r) =>
          notifyUsers(r, {
            kind: "contract",
            title: `Kontrak ${employee?.name ?? ""} tidak diperpanjang`,
            body: `Berakhir ${formatDate(contract.endDate!)}. Alasan: ${body.note}`,
            href: "/admin/contracts?view=all",
            emailOptOut: true,
          })
        )
        .catch(() => {});
      break;
    }
    case "reopen_decision": {
      if (contract.nextContractId) throw Conflict("Kontrak ini sudah punya kontrak lanjutan.");
      contract.decision = "pending";
      contract.decisionNote = "";
      contract.decidedAt = null;
      contract.decidedBy = null;
      contract.notes = contract.notes.replace("[auto-resign]", "").trim();
      message = "Keputusan dibatalkan; kontrak kembali ke daftar yang perlu diputuskan.";
      break;
    }
    case "terminate": {
      if (!["active", "draft"].includes(contract.status)) throw Conflict("Kontrak ini sudah tidak berlaku.");
      contract.status = "terminated";
      contract.terminatedAt = wibStartOfDay(body.date);
      contract.terminationReason = body.reason;
      contract.decision = "not_renew";
      contract.decisionNote = body.reason;
      contract.decidedAt = new Date();
      contract.decidedBy = new RecordId(ctx.user.id);
      message = `Kontrak ${contract.contractNumber} diakhiri per ${formatDate(contract.terminatedAt)}.`;
      void resolveRecipientForEmployee(contract.employeeId)
        .then((r) =>
          notifyUsers(r, {
            kind: "contract",
            title: "Kontrak kerja Anda diakhiri",
            body: `Berlaku ${formatDate(contract.terminatedAt!)}. Hubungi HRD untuk informasi lebih lanjut.`,
            href: "/portal/profile?tab=contract",
          })
        )
        .catch(() => {});
      break;
    }
  }

  await contract.save();
  void logActivity({
    userId: ctx.user.id,
    action: `CONTRACT_${body.action.toUpperCase()}`,
    module: "contracts",
    after: { number: contract.contractNumber, employee: employee?.name, ...body },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return apiSuccess({ _id: contract._id, status: contract.status, decision: contract.decision }, message);
});

/** Only drafts are deleted; anything that was in force stays as history. */
export const DELETE = wrapRouteHandler<Ctx>(async (req, { params }) => {
  const ctx = await requirePermission(req, "contracts", "write");
  const id = await loadId(params);
  const contract = await Contract.findById(id);
  if (!contract) throw NotFound("Kontrak tidak ditemukan.");
  if (contract.status !== "draft") throw Conflict("Kontrak yang pernah berlaku tidak dihapus. Gunakan Akhiri kontrak.");
  if (contract.previousContractId) {
    await Contract.updateOne(
      { _id: contract.previousContractId, nextContractId: contract._id },
      { $set: { nextContractId: null, decision: "pending", decidedAt: null, decidedBy: null } }
    );
  }
  await contract.deleteOne();
  void logActivity({ userId: ctx.user.id, action: "DELETE_CONTRACT_DRAFT", module: "contracts", after: { number: contract.contractNumber }, ip: ctx.ip, userAgent: ctx.userAgent });
  return apiSuccess({ _id: id }, "Draf kontrak dihapus.");
});

void wibDateKey;
