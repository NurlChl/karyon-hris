import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { enforceIpRateLimit, BadRequest, NotFound } from "@/lib/guard";
import { connectToDatabase } from "@/lib/db";
import { createPendingUpload } from "@/lib/uploads";
import { UPLOAD_POLICY } from "@/lib/attachments";
import JobVacancy from "@/models/JobVacancy";

/**
 * Anonymous upload for the public application form.
 *
 * An open upload endpoint is a free file host waiting to be found, so this one
 * only accepts files for a vacancy that is actually open, is rate limited per
 * address, and files that no application claims are deleted within hours.
 */
export const POST = wrapRouteHandler(async (req) => {
  enforceIpRateLimit("public-upload", req, {
    windowMs: 60 * 60_000,
    max: UPLOAD_POLICY.application.hourlyLimit,
  });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw BadRequest("Kirim berkas sebagai multipart/form-data.");
  }

  const slug = String(form.get("vacancySlug") ?? "").trim();
  if (!slug) throw BadRequest("Lowongan wajib disertakan.");

  await connectToDatabase();
  const now = new Date();
  const vacancy = await JobVacancy.exists({
    slug,
    status: "open",
    $or: [{ closesAt: null }, { closesAt: { $gte: now } }],
  });
  if (!vacancy) throw NotFound("Lowongan tidak ditemukan atau sudah ditutup.");

  const file = form.get("file");
  if (!(file instanceof File)) throw BadRequest("Berkas tidak ditemukan dalam permintaan.");

  // Scoped to the vacancy, so a token uploaded for one opening cannot be spent
  // on another.
  const result = await createPendingUpload({ file, context: "application", scope: slug });
  return apiSuccess(result, "Berkas terunggah.", undefined, 201);
});
