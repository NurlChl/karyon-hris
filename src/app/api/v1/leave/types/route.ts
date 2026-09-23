import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requirePermission, parseBody, BadRequest, Conflict, NotFound } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { describeQuota, quotaModeOf } from "@/lib/hr/leave-policy";
import LeaveType from "@/models/LeaveType";
import LeaveRequest from "@/models/LeaveRequest";

/**
 * Leave types as HR manages them. The portal reads its own filtered list from
 * GET /leave?type=types; this endpoint returns every type, inactive included,
 * with how often each is used.
 */
export const GET = wrapRouteHandler(async (req) => {
  await requirePermission(req, "leave", "read");
  const types = await LeaveType.find({}).sort({ sortOrder: 1, name: 1 }).lean<Array<Record<string, unknown>>>();
  const usage = await LeaveRequest.aggregate<{ _id: unknown; n: number }>([
    { $group: { _id: "$leaveTypeId", n: { $sum: 1 } } },
  ]);
  const usedBy = new Map(usage.map((u) => [String(u._id), u.n]));
  return apiSuccess(
    types.map((t) => ({
      ...t,
      quotaMode: quotaModeOf(t as never),
      rule: describeQuota(t as never),
      requestCount: usedBy.get(String(t._id)) ?? 0,
    }))
  );
});

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/);

const typeSchema = z
  .object({
    name: z.string().trim().min(3, "Nama minimal 3 karakter").max(60),
    description: z.string().trim().max(300).default(""),
    quotaMode: z.enum(["annual", "per_event", "none"]),
    quotaDays: z.number().int().min(0).max(365),
    accrualMode: z.enum(["prorata", "flat"]).default("flat"),
    carryOverMaxDays: z.number().int().min(0).max(365).default(0),
    maxConsecutiveDays: z.number().int().min(0).max(365).default(0),
    maxEventsPerYear: z.number().int().min(0).max(52).default(0),
    requiresEvidence: z.boolean().default(false),
    minLeadDays: z.number().int().min(0).max(365).default(0),
    allowsRemoteAttendance: z.boolean().default(false),
    genderRestriction: z.enum(["any", "male", "female"]).default("any"),
    isOther: z.boolean().default(false),
    isActive: z.boolean().default(true),
    colorTone: z.enum(["primary", "success", "warning", "danger", "info", "neutral"]).default("primary"),
    sortOrder: z.number().int().min(0).max(1000).default(100),
  })
  .refine((v) => v.quotaMode === "none" || v.quotaDays > 0, {
    message: "Isi jumlah hari kuota.",
    path: ["quotaDays"],
  });

function toDoc(body: z.infer<typeof typeSchema>) {
  return {
    ...body,
    // Kept in step for code that still reads the older flag.
    deductsBalance: body.quotaMode === "annual",
    // Per-event types limit each request by the quota itself.
    maxConsecutiveDays: body.quotaMode === "per_event" ? body.quotaDays : body.maxConsecutiveDays,
    maxEventsPerYear: body.quotaMode === "per_event" ? body.maxEventsPerYear : 0,
    accrualMode: body.quotaMode === "annual" ? body.accrualMode : "flat",
    carryOverMaxDays: body.quotaMode === "annual" ? body.carryOverMaxDays : 0,
  };
}

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "leave", "write");
  const body = await parseBody(req, typeSchema);
  if (await LeaveType.exists({ name: body.name })) throw Conflict(`Jenis "${body.name}" sudah ada.`);
  const created = await LeaveType.create(toDoc(body));
  void logActivity({ userId: ctx.user.id, action: "CREATE_LEAVE_TYPE", module: "leave", after: created.toObject(), ip: ctx.ip, userAgent: ctx.userAgent });
  return apiSuccess(created, `Jenis "${body.name}" ditambahkan.`, undefined, 201);
});

export const PATCH = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "leave", "write");
  const raw = (await req.clone().json().catch(() => null)) as { id?: string } | null;
  if (!raw?.id || !objectId.safeParse(raw.id).success) throw BadRequest("ID jenis tidak valid.");
  const body = await parseBody(req, typeSchema);

  const existing = await LeaveType.findById(raw.id);
  if (!existing) throw NotFound("Jenis izin/cuti tidak ditemukan.");
  if (body.name !== existing.name && (await LeaveType.exists({ name: body.name, _id: { $ne: existing._id } }))) {
    throw Conflict(`Jenis "${body.name}" sudah ada.`);
  }

  const before = existing.toObject();
  const modeChanged = quotaModeOf(before) !== body.quotaMode;
  if (modeChanged) {
    const pending = await LeaveRequest.countDocuments({ leaveTypeId: existing._id, status: "pending" });
    if (pending > 0) {
      throw Conflict(
        `Masih ada ${pending} pengajuan "${existing.name}" yang menunggu persetujuan. Selesaikan dulu sebelum mengubah cara kuotanya dihitung, agar saldo yang sudah ditahan tidak salah dikembalikan.`
      );
    }
  }

  existing.set(toDoc(body));
  await existing.save();
  void logActivity({ userId: ctx.user.id, action: "UPDATE_LEAVE_TYPE", module: "leave", before, after: existing.toObject(), ip: ctx.ip, userAgent: ctx.userAgent });
  return apiSuccess(existing, `Jenis "${body.name}" diperbarui.`);
});

export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "leave", "write");
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!objectId.safeParse(id).success) throw BadRequest("ID jenis tidak valid.");
  const existing = await LeaveType.findById(id);
  if (!existing) throw NotFound("Jenis izin/cuti tidak ditemukan.");

  // A type with history is deactivated rather than removed: old requests must
  // keep showing what they were.
  const used = await LeaveRequest.exists({ leaveTypeId: existing._id });
  if (used) {
    existing.isActive = false;
    await existing.save();
    void logActivity({ userId: ctx.user.id, action: "DEACTIVATE_LEAVE_TYPE", module: "leave", after: { name: existing.name }, ip: ctx.ip, userAgent: ctx.userAgent });
    return apiSuccess({ deactivated: true }, `"${existing.name}" sudah pernah dipakai, jadi dinonaktifkan dan tidak lagi muncul di formulir karyawan.`);
  }
  await existing.deleteOne();
  void logActivity({ userId: ctx.user.id, action: "DELETE_LEAVE_TYPE", module: "leave", after: { name: existing.name }, ip: ctx.ip, userAgent: ctx.userAgent });
  return apiSuccess({ deleted: true }, `"${existing.name}" dihapus.`);
});
