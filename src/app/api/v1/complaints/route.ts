import { RecordId } from "@/lib/postgres";
import { z } from "zod";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import {
  requireUser,
  requireEmployee,
  parseBody,
  enforceRateLimit,
  BadRequest,
  Forbidden,
  NotFound,
  pagination,
} from "@/lib/guard";
import { RATE_RULES } from "@/lib/rate-limit";
import { logActivity } from "@/lib/audit/logger";
import { attachmentInputSchema } from "@/lib/attachments";
import { attachmentRefHref, resolveSingleAttachment } from "@/lib/uploads";
import { notifyUsers, resolveRecipientsByRole, resolveRecipientForEmployee } from "@/lib/notification/notify";
import { randomToken } from "@/lib/crypto";
import Complaint from "@/models/Complaint";
import Employee from "@/models/Employee";

/**
 * Employee grievance / whistleblowing channel.
 *
 * Anonymity is enforced at the serialisation boundary: the reporter's identity
 * is always stored (so HRD and Audit retain accountability and the reporter can
 * follow their own ticket) but is stripped from every response an SPV receives.
 */

const TARGET_ROLE: Record<string, string> = { spv: "SPV", hrd: "HRD", direksi: "DIREKSI" };

/** Roles allowed to handle a given target queue. */
const HANDLER_ROLES: Record<string, string[]> = {
  spv: ["SPV", "HRD", "SUPERADMIN"],
  hrd: ["HRD", "SUPERADMIN", "AUDIT"],
  direksi: ["DIREKSI", "SUPERADMIN", "AUDIT"],
};

export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const { page, limit, skip } = pagination(req, 25, 100);
  const mine = new URL(req.url).searchParams.get("mine") === "1";

  let filter: Record<string, unknown>;
  let asHandler = false;

  if (mine || !["SUPERADMIN", "HRD", "DIREKSI", "AUDIT", "SPV"].includes(ctx.user.role)) {
    // The reporter's own view — includes their anonymous tickets, which they
    // could not previously see at all.
    if (!ctx.user.employeeId) return apiSuccess({ items: [], asHandler: false });
    filter = { reporterId: ctx.user.employeeId };
  } else {
    asHandler = true;
    if (ctx.user.role === "SUPERADMIN" || ctx.user.role === "AUDIT") {
      filter = {};
    } else if (ctx.user.role === "SPV") {
      filter = { target: "spv" };
    } else if (ctx.user.role === "HRD") {
      filter = { target: "hrd" };
    } else {
      filter = { target: "direksi" };
    }
  }

  const OPEN = { status: { $in: ["received", "in_progress"] } };
  const CLOSED = { status: { $in: ["resolved", "rejected"] } };
  const state = new URL(req.url).searchParams.get("state");
  const baseFilter = filter;
  if (state === "open") filter = { ...baseFilter, ...OPEN };
  else if (state === "closed") filter = { ...baseFilter, ...CLOSED };

  const [openCount, closedCount] = await Promise.all([
    Complaint.countDocuments({ ...baseFilter, ...OPEN }),
    Complaint.countDocuments({ ...baseFilter, ...CLOSED }),
  ]);

  const [rows, total] = await Promise.all([
    Complaint.find(filter)
      .populate("employeeId", "name employeeId divisionId")
      .populate("reporterId", "name employeeId divisionId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Complaint.countDocuments(filter),
  ]);

  // SPV never sees the identity behind an anonymous report, nor internal notes.
  const canSeeIdentity = ["SUPERADMIN", "HRD", "AUDIT", "DIREKSI"].includes(ctx.user.role);

  const items = await Promise.all(
    rows.map(async (row) => {
      const anonymous = Boolean(row.isAnonymous);
      const isOwnTicket =
        row.reporterId && String((row.reporterId as { _id?: unknown })?._id ?? row.reporterId) === ctx.user.employeeId;

      return {
        ...row,
        reporterId: undefined,
        employeeId:
          anonymous && !(canSeeIdentity || isOwnTicket)
            ? null
            : anonymous
              ? row.reporterId
              : row.employeeId,
        isIdentityRevealed: anonymous ? canSeeIdentity || Boolean(isOwnTicket) : true,
        responses: ((row.responses ?? []) as Array<{ isInternal?: boolean }>).filter(
          (r) => asHandler || !r.isInternal
        ),
        attachments: await attachmentRefHref(row.attachments as string),
      };
    })
  );

  return apiSuccess(
    { items, asHandler, counts: { open: openCount, closed: closedCount } },
    "Berhasil memuat pengaduan",
    { page, limit, total }
  );
});

/* ------------------------------------------------------------------ */
/* POST — file a report                                                 */
/* ------------------------------------------------------------------ */

const createSchema = z.object({
  isAnonymous: z.boolean().default(false),
  target: z.enum(["spv", "hrd", "direksi"]),
  category: z.enum(["etik", "pelecehan", "keselamatan", "fasilitas", "atasan", "lainnya"]).default("lainnya"),
  subject: z.string().trim().min(5, "Judul pengaduan minimal 5 karakter").max(150),
  description: z
    .string()
    .trim()
    .min(30, "Uraikan kejadian minimal 30 karakter agar dapat ditindaklanjuti")
    .max(5000),
  /** Inline data URL; still accepted from older app versions. */
  attachment: z.string().optional(),
  /** Uploaded file token or pasted link, from the shared upload flow. */
  attachmentInput: attachmentInputSchema.optional(),
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireEmployee(req);
  enforceRateLimit("complaint", ctx.employeeId, { windowMs: 60 * 60_000, max: 5 });

  const body = await parseBody(req, createSchema);

  let attachmentKey = "";
  attachmentKey = await resolveSingleAttachment({
    input: body.attachmentInput,
    legacyDataUrl: body.attachment,
    context: "complaint",
    ownerUserId: ctx.user.id,
    destination: `complaints/${ctx.employeeId}`,
  });

  const ticketCode = `PGD-${randomToken(4).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)}`;

  const complaint = await Complaint.create({
    employeeId: body.isAnonymous ? null : ctx.employeeId,
    reporterId: ctx.employeeId,
    isAnonymous: body.isAnonymous,
    target: body.target,
    category: body.category,
    subject: body.subject,
    description: body.description,
    attachments: attachmentKey,
    ticketCode,
    status: "received",
  });

  const employee = await Employee.findById(ctx.employeeId).select("name divisionId").lean<{
    name: string;
    divisionId?: RecordId;
  } | null>();

  const recipients = await resolveRecipientsByRole(TARGET_ROLE[body.target], {
    divisionId: body.target === "spv" ? employee?.divisionId?.toString() ?? null : null,
  });

  void notifyUsers(recipients, {
    kind: "complaint",
    title: `Pengaduan baru: ${body.subject}`,
    body: body.isAnonymous
      ? `Pengaduan anonim (${ticketCode}) membutuhkan tindak lanjut Anda.`
      : `${employee?.name ?? "Karyawan"} mengirim pengaduan (${ticketCode}).`,
    href: "/admin/complaints",
    refType: "complaint",
    refId: complaint._id as RecordId,
  });

  void logActivity({
    // Anonymous reports are logged without the actor id so the audit trail
    // itself cannot be used to unmask the reporter.
    userId: body.isAnonymous ? null : ctx.user.id,
    action: "SUBMIT_COMPLAINT",
    module: "complaint",
    after: { ticketCode, target: body.target, category: body.category, isAnonymous: body.isAnonymous },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { ticketCode, _id: complaint._id },
    `Pengaduan terkirim dengan nomor tiket ${ticketCode}. ` +
      (body.isAnonymous
        ? "Identitas Anda disembunyikan dari atasan, namun tetap tercatat untuk HRD/Audit demi akuntabilitas."
        : "Anda dapat memantau perkembangannya di menu Pengaduan Saya."),
    undefined,
    201
  );
});

/* ------------------------------------------------------------------ */
/* PATCH — handler follow-up                                            */
/* ------------------------------------------------------------------ */

const updateSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/),
  status: z.enum(["received", "in_progress", "resolved", "rejected"]).optional(),
  message: z.string().trim().max(3000).optional(),
  isInternal: z.boolean().default(false),
});

export const PATCH = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const body = await parseBody(req, updateSchema);

  const complaint = await Complaint.findById(body.id);
  if (!complaint) throw NotFound("Pengaduan tidak ditemukan.");

  const allowed = HANDLER_ROLES[complaint.target] ?? [];
  if (!allowed.includes(ctx.user.role)) {
    throw Forbidden(`Pengaduan ini ditujukan ke ${complaint.target.toUpperCase()} dan hanya dapat ditindaklanjuti oleh peran tersebut.`);
  }
  if (!body.status && !body.message) {
    throw BadRequest("Isi tanggapan atau ubah status pengaduan.");
  }

  if (body.message) {
    complaint.responses.push({
      userId: ctx.user.id as unknown as RecordId,
      message: body.message,
      createdAt: new Date(),
      isInternal: body.isInternal,
    });
  }
  if (body.status) {
    complaint.status = body.status;
    if (body.status === "resolved" || body.status === "rejected") {
      complaint.resolvedAt = new Date();
    }
  }
  complaint.handledBy = ctx.user.id as unknown as RecordId;
  await complaint.save();

  // The reporter is notified even for anonymous tickets — the notification goes
  // to their account, which never exposes them to the handler.
  if (complaint.reporterId && (body.status || (body.message && !body.isInternal))) {
    const recipients = await resolveRecipientForEmployee(complaint.reporterId);
    void notifyUsers(recipients, {
      kind: "complaint",
      title: `Pembaruan pengaduan ${complaint.ticketCode}`,
      body: body.status
        ? `Status pengaduan Anda kini "${body.status}".`
        : "Ada tanggapan baru atas pengaduan Anda.",
      href: "/portal/complaints",
    });
  }

  void logActivity({
    userId: ctx.user.id,
    action: "UPDATE_COMPLAINT",
    module: "complaint",
    after: { ticketCode: complaint.ticketCode, status: complaint.status, internal: body.isInternal },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess({ id: complaint._id, status: complaint.status }, "Pengaduan diperbarui.");
});
