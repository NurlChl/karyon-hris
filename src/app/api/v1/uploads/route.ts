import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireUser, requirePermission, enforceRateLimit, BadRequest } from "@/lib/guard";
import { createPendingUpload } from "@/lib/uploads";
import { UPLOAD_POLICY, type UploadContext } from "@/lib/attachments";

/**
 * Upload one file for a signed-in user.
 *
 * Multipart, one file per request. The response is a token the form submits
 * later; the file itself is not attached to anything until then.
 */

const INTERNAL_CONTEXTS: UploadContext[] = ["leave", "correction", "complaint", "application", "contract", "document"];

/** Contexts only staff with a given permission may upload for. */
const CONTEXT_PERMISSION: Partial<Record<UploadContext, [string, string]>> = {
  application: ["recruitment", "write"],
  contract: ["contracts", "write"],
  // "document" is used by both payroll and KPI screens; either grant is enough.
};

export const POST = wrapRouteHandler(async (req) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw BadRequest("Kirim berkas sebagai multipart/form-data.");
  }

  const context = String(form.get("context") ?? "") as UploadContext;
  if (!INTERNAL_CONTEXTS.includes(context)) throw BadRequest("Konteks unggahan tidak dikenali.");

  // Application files uploaded from inside the app belong to a candidate that
  // recruitment staff are adding by hand; nobody else has a reason to.
  const needed = CONTEXT_PERMISSION[context];
  const ctx = needed
    ? await requirePermission(req, needed[0], needed[1])
    : context === "document"
      ? await requirePermission(req, "payroll", "write").catch(() => requirePermission(req, "kpi", "write"))
      : await requireUser(req);

  enforceRateLimit(`upload-${context}`, ctx.user.id, {
    windowMs: 60 * 60_000,
    max: UPLOAD_POLICY[context].hourlyLimit,
  });

  const file = form.get("file");
  if (!(file instanceof File)) throw BadRequest("Berkas tidak ditemukan dalam permintaan.");

  const result = await createPendingUpload({ file, context, ownerUserId: ctx.user.id });
  return apiSuccess(result, "Berkas terunggah.", undefined, 201);
});
