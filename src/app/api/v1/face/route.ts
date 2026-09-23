import { RecordId } from "@/lib/postgres";
import { z } from "zod";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import {
  requireEmployee,
  parseBody,
  enforceRateLimit,
  BadRequest,
  Conflict,
  NotFound,
} from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { storageProvider } from "@/lib/storage";
import { createApprovalInstance, cancelInstance, isUntouched } from "@/lib/approval/engine";
import {
  ENROL_SAMPLES,
  analyseEnrolment,
  getFaceSettings,
  openDescriptors,
  sealDescriptors,
  storeReferencePhoto,
} from "@/lib/face/service";
import { faceDistance } from "@/lib/face/engine";
import { FACE_CONSENT_POINTS, FACE_CONSENT_VERSION } from "@/lib/face/consent";
import FaceProfile from "@/models/FaceProfile";
import FaceChangeRequest from "@/models/FaceChangeRequest";
import ApprovalInstance from "@/models/ApprovalInstance";
import Employee from "@/models/Employee";
import { requireProFeature } from "@/lib/licensing/server";

/**
 * The employee's own face enrolment.
 *
 * Both first enrolment and replacement require supervisor approval. A stolen
 * new account must not be able to establish an attacker's face as the trusted
 * biometric before the real employee ever signs in.
 *
 * Enrolment works whether or not verification is currently switched on, so a
 * company can have everyone enrol before turning enforcement on.
 */

/* ------------------------------------------------------------------ */
/* GET — status                                                        */
/* ------------------------------------------------------------------ */

export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireEmployee(req);
  await requireProFeature("face.advanced");
  const employeeId = new RecordId(ctx.employeeId);
  const face = await getFaceSettings();

  const [profile, pending, lastDecided] = await Promise.all([
    FaceProfile.findOne({ employeeId })
      .select("referencePhoto createdAt updatedAt source lastVerifiedAt consentVersion")
      .lean<{
        referencePhoto: string;
        createdAt: Date;
        updatedAt: Date;
        source: string;
        lastVerifiedAt?: Date | null;
        consentVersion: string;
      } | null>(),
    FaceChangeRequest.findOne({ employeeId, status: "pending" })
      .select("referencePhoto reason createdAt approvalInstanceId")
      .lean<{ referencePhoto: string; reason: string; createdAt: Date; approvalInstanceId?: RecordId } | null>(),
    FaceChangeRequest.findOne({ employeeId, status: { $in: ["approved", "rejected"] } })
      .sort({ decidedAt: -1 })
      .select("status decidedAt decisionNote")
      .lean<{ status: string; decidedAt?: Date; decisionNote?: string } | null>(),
  ]);

  let canCancel = false;
  if (pending?.approvalInstanceId) {
    const instance = await ApprovalInstance.findById(pending.approvalInstanceId)
      .select("stepsStatus")
      .lean<{ stepsStatus: Array<{ status: string }> } | null>();
    canCancel = Boolean(instance && isUntouched(instance));
  }

  return apiSuccess(
    {
      enabled: face.enabled,
      strictness: face.strictness,
      samplesRequired: ENROL_SAMPLES,
      consent: { version: FACE_CONSENT_VERSION, points: FACE_CONSENT_POINTS },
      profile: profile
        ? {
            enrolledAt: profile.createdAt,
            updatedAt: profile.updatedAt,
            source: profile.source,
            lastVerifiedAt: profile.lastVerifiedAt ?? null,
            // An old consent version means the wording changed since this face
            // was enrolled; the portal asks the employee to re-read it.
            consentOutdated: profile.consentVersion !== FACE_CONSENT_VERSION,
            referencePhotoUrl: await storageProvider.getSignedUrl(profile.referencePhoto, 600),
          }
        : null,
      pendingRequest: pending
        ? {
            createdAt: pending.createdAt,
            reason: pending.reason,
            canCancel,
            referencePhotoUrl: await storageProvider.getSignedUrl(pending.referencePhoto, 600),
          }
        : null,
      lastDecision: lastDecided
        ? {
            status: lastDecided.status,
            decidedAt: lastDecided.decidedAt ?? null,
            note: lastDecided.decisionNote ?? "",
          }
        : null,
    },
    "Status wajah presensi dimuat"
  );
});

/* ------------------------------------------------------------------ */
/* POST — enrol, or request a replacement                              */
/* ------------------------------------------------------------------ */

const enrolSchema = z.object({
  photos: z.array(z.string().min(100)).length(ENROL_SAMPLES, `Ambil tepat ${ENROL_SAMPLES} foto wajah.`),
  consent: z.literal(true, { message: "Persetujuan pengolahan data wajah wajib dicentang." }),
  consentVersion: z.string(),
  reason: z.string().trim().max(500).optional(),
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireEmployee(req);
  await requireProFeature("face.advanced");
  // Each enrolment runs several face inferences; this also slows down anyone
  // cycling through photos to find one that enrols.
  enforceRateLimit("face-enrol", ctx.employeeId, { windowMs: 60 * 60_000, max: 10 });

  const body = await parseBody(req, enrolSchema);
  if (body.consentVersion !== FACE_CONSENT_VERSION) {
    throw BadRequest("Teks persetujuan telah diperbarui. Muat ulang halaman lalu baca kembali sebelum melanjutkan.");
  }

  const employeeId = new RecordId(ctx.employeeId);
  const existing = await FaceProfile.findOne({ employeeId })
    .select("descriptors")
    .lean<{ descriptors: string } | null>();

  if (existing) {
    if (!body.reason || body.reason.length < 10) {
      throw BadRequest(
        "Tuliskan alasan penggantian wajah minimal 10 karakter, misalnya perubahan penampilan atau foto lama kurang jelas. Alasan ini dibaca atasan Anda."
      );
    }
    const open = await FaceChangeRequest.exists({ employeeId, status: "pending" });
    if (open) {
      throw Conflict("Masih ada permintaan penggantian wajah yang menunggu persetujuan. Batalkan dulu bila ingin mengajukan ulang.");
    }
  }

  const samples = await analyseEnrolment(body.photos);
  const now = new Date();

  const employee = await Employee.findById(employeeId)
    .select("name employeeId divisionId")
    .lean<{ name: string; employeeId: string; divisionId?: RecordId } | null>();
  if (!employee) throw NotFound("Data karyawan tidak ditemukan.");

  /* ---------------- first enrolment / replacement request --------- */
  let distanceToCurrent: number | null = null;
  const pendingRequest = await FaceChangeRequest.exists({ employeeId, status: "pending" });
  if (pendingRequest) throw Conflict("Masih ada permintaan wajah yang menunggu persetujuan.");
  if (existing) {
    const current = openDescriptors(existing.descriptors);
    let closest = Infinity;
    for (const a of samples.descriptors) {
      for (const b of current) closest = Math.min(closest, faceDistance(a, b));
    }
    distanceToCurrent = Number.isFinite(closest) ? Math.round(closest * 1000) / 1000 : null;
  }

  const referencePhoto = await storeReferencePhoto(ctx.employeeId, "request", samples.reference);
  let request;
  try {
    request = await FaceChangeRequest.create({
      employeeId,
      descriptors: sealDescriptors(samples.descriptors),
      sampleCount: samples.descriptors.length,
      referencePhoto,
      distanceToCurrent,
      reason: body.reason || "Pendaftaran wajah pertama",
      consentAt: now,
      consentVersion: FACE_CONSENT_VERSION,
    });
  } catch (err) {
    await storageProvider.delete(referencePhoto).catch(() => {});
    if ((err as { code?: number }).code === 11000) {
      throw Conflict("Masih ada permintaan penggantian wajah yang menunggu persetujuan.");
    }
    throw err;
  }

  const instanceId = await createApprovalInstance({
    refType: "face_change",
    refId: request._id,
    employeeId,
    submitterUserId: ctx.user.id,
    summary: existing
      ? `Penggantian wajah presensi ${employee.name}: ${body.reason}`
      : `Pendaftaran wajah presensi pertama ${employee.name}`,
  });
  request.approvalInstanceId = instanceId;
  await request.save();

  void logActivity({
    userId: ctx.user.id,
    action: existing ? "FACE_CHANGE_REQUESTED" : "FACE_ENROLMENT_REQUESTED",
    module: "attendance",
    after: { requestId: String(request._id), distanceToCurrent: request.distanceToCurrent },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { status: "pending", requestId: request._id },
    existing
      ? "Permintaan penggantian wajah dikirim ke atasan Anda. Sampai disetujui, presensi tetap memakai wajah yang lama."
      : "Pendaftaran wajah dikirim ke atasan Anda. Wajah baru dapat dipakai untuk presensi setelah disetujui."
  );
});

/* ------------------------------------------------------------------ */
/* DELETE — withdraw a pending replacement                              */
/* ------------------------------------------------------------------ */

export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await requireEmployee(req);
  await requireProFeature("face.advanced");
  const request = await FaceChangeRequest.findOne({
    employeeId: new RecordId(ctx.employeeId),
    status: "pending",
  });
  if (!request) throw NotFound("Tidak ada permintaan penggantian wajah yang sedang menunggu.");

  if (request.approvalInstanceId) {
    const instance = await ApprovalInstance.findById(request.approvalInstanceId)
      .select("stepsStatus")
      .lean<{ stepsStatus: Array<{ status: string }> } | null>();
    if (instance && !isUntouched(instance)) {
      throw Conflict("Permintaan ini sudah mulai diproses atasan sehingga tidak dapat dibatalkan.");
    }
    await cancelInstance(request.approvalInstanceId, ctx.user.id);
  }

  request.status = "cancelled";
  request.decidedAt = new Date();
  request.descriptors = "";
  await request.save();
  await storageProvider.delete(request.referencePhoto).catch(() => {});

  void logActivity({
    userId: ctx.user.id,
    action: "FACE_CHANGE_CANCELLED",
    module: "attendance",
    after: { requestId: String(request._id) },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess({ status: "cancelled" }, "Permintaan penggantian wajah dibatalkan.");
});
