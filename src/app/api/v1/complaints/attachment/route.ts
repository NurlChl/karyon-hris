import { requireUser, Forbidden, NotFound, BadRequest } from "@/lib/guard";
import { wrapRouteHandler } from "@/lib/api";
import { complaintHandlerScope, canReadComplaintQueue } from "@/lib/complaint-access";
import { storageProvider, toStorageKey } from "@/lib/storage";
import Complaint from "@/models/Complaint";

/** Opaque, authorized access for old and new anonymous complaint attachments. */
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-fA-F]{24}$/.test(id)) throw BadRequest("ID pengaduan tidak valid.");
  const complaint = await Complaint.findById(id).select("reporterId target attachments isAnonymous").lean<{
    reporterId: unknown;
    target: string;
    attachments: string;
    isAnonymous: boolean;
  } | null>();
  if (!complaint?.isAnonymous || !complaint.attachments || /^https?:\/\//i.test(complaint.attachments)) {
    throw NotFound("Lampiran tidak ditemukan.");
  }
  const isReporter = String(complaint.reporterId) === ctx.user.employeeId;
  if (!isReporter) {
    if (!canReadComplaintQueue(ctx.user.role, complaint.target)) throw Forbidden();
    const scope = await complaintHandlerScope(ctx.user, "read");
    if (!await Complaint.exists({ $and: [{ _id: id }, scope] })) throw Forbidden();
  }
  const key = toStorageKey(complaint.attachments);
  if (!key.startsWith("complaints/") || key.includes("..")) throw NotFound("Lampiran tidak ditemukan.");
  const file = await storageProvider.read(key).catch(() => null);
  if (!file) throw NotFound("Lampiran tidak ditemukan.");
  return new Response(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": file.contentType.startsWith("text/html") ? "application/octet-stream" : file.contentType,
      "Content-Disposition": "attachment; filename=lampiran",
      "Content-Length": String(file.buffer.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});
