import { RecordId } from "@/lib/postgres";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireUser, BadRequest, Forbidden, NotFound } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import { storageProvider } from "@/lib/storage";
import { cancelInstance } from "@/lib/approval/engine";
import { notifyUsers, resolveRecipientForEmployee } from "@/lib/notification/notify";
import FaceProfile from "@/models/FaceProfile";
import FaceChangeRequest from "@/models/FaceChangeRequest";
import Employee from "@/models/Employee";
import { requireProFeature } from "@/lib/licensing/server";

/**
 * HR's view of employees' face enrolment.
 *
 * Restricted to HRD and Superadmin — the same two roles that may open a face
 * reference photo at all. Supervisors approve change requests but do not get a
 * standing view of everyone's biometric data.
 */
const FACE_ADMIN_ROLES = ["SUPERADMIN", "HRD"];

async function requireFaceAdmin(req: Request) {
  const ctx = await requireUser(req);
  if (!FACE_ADMIN_ROLES.includes(ctx.user.role)) {
    throw Forbidden("Hanya HRD dan Superadmin yang dapat mengelola data wajah karyawan.");
  }
  return ctx;
}

function employeeObjectId(raw: string | null) {
  if (!raw || !/^[0-9a-fA-F]{24}$/.test(raw)) throw BadRequest("ID karyawan tidak valid.");
  return new RecordId(raw);
}

/* ------------------------------------------------------------------ */
/* GET — enrolment status, one employee or a list                      */
/* ------------------------------------------------------------------ */

export const GET = wrapRouteHandler(async (req) => {
  await requireFaceAdmin(req);
  await requireProFeature("face.advanced");
  const raw = new URL(req.url).searchParams.get("employeeId");

  if (raw) {
    const employeeId = employeeObjectId(raw);
    const [profile, pending] = await Promise.all([
      FaceProfile.findOne({ employeeId })
        .select("referencePhoto createdAt updatedAt source lastVerifiedAt")
        .lean<{ referencePhoto: string; createdAt: Date; updatedAt: Date; source: string; lastVerifiedAt?: Date | null } | null>(),
      FaceChangeRequest.exists({ employeeId, status: "pending" }),
    ]);

    return apiSuccess({
      enrolled: Boolean(profile),
      enrolledAt: profile?.createdAt ?? null,
      updatedAt: profile?.updatedAt ?? null,
      source: profile?.source ?? null,
      lastVerifiedAt: profile?.lastVerifiedAt ?? null,
      pendingChange: Boolean(pending),
      referencePhotoUrl: profile ? await storageProvider.getSignedUrl(profile.referencePhoto, 600) : "",
    });
  }

  // Summary only — ids and dates, never photos — so HR can see who still has
  // to enrol before verification is switched on.
  const [profiles, activeCount] = await Promise.all([
    FaceProfile.find({})
      .select("employeeId createdAt lastVerifiedAt")
      .lean<Array<{ employeeId: RecordId; createdAt: Date; lastVerifiedAt?: Date | null }>>(),
    Employee.countDocuments({ status: { $in: ["active", "onboarding"] } }),
  ]);

  return apiSuccess({
    enrolledCount: profiles.length,
    activeEmployees: activeCount,
    enrolled: profiles.map((p) => ({
      employeeId: p.employeeId,
      enrolledAt: p.createdAt,
      lastVerifiedAt: p.lastVerifiedAt ?? null,
    })),
  });
});

/* ------------------------------------------------------------------ */
/* DELETE — reset an employee's face                                   */
/* ------------------------------------------------------------------ */

/**
 * Removes the enrolled face so the employee enrols again from scratch.
 *
 * For a mistaken enrolment — the wrong person's face, or an employee who has
 * asked for their biometric data to be erased. It deliberately does not skip
 * supervisor approval by a back door: the employee's next enrolment is a fresh
 * first enrolment, which notifies their supervisor, and this reset is itself
 * audited with the reason given.
 */
export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await requireFaceAdmin(req);
  await requireProFeature("face.advanced");
  const sp = new URL(req.url).searchParams;
  const employeeId = employeeObjectId(sp.get("employeeId"));
  const reason = (sp.get("reason") ?? "").trim();
  if (reason.length < 10) {
    throw BadRequest("Alasan reset wajib diisi minimal 10 karakter. Alasan ini tercatat di jejak audit.");
  }

  const profile = await FaceProfile.findOne({ employeeId });
  const pending = await FaceChangeRequest.findOne({ employeeId, status: "pending" });
  if (!profile && !pending) throw NotFound("Karyawan ini belum memiliki data wajah.");

  if (pending) {
    if (pending.approvalInstanceId) await cancelInstance(pending.approvalInstanceId, ctx.user.id);
    pending.status = "cancelled";
    pending.decidedAt = new Date();
    pending.decisionNote = `Direset HRD: ${reason}`;
    pending.descriptors = "";
    await pending.save();
    await storageProvider.delete(pending.referencePhoto).catch(() => {});
  }

  if (profile) {
    await storageProvider.delete(profile.referencePhoto).catch(() => {});
    await profile.deleteOne();
  }

  // Past requests are kept as a record that they happened, but no face data may
  // outlive a reset — otherwise "delete my biometric data" would not.
  await FaceChangeRequest.updateMany({ employeeId, descriptors: { $ne: "" } }, { $set: { descriptors: "" } });

  void logActivity({
    userId: ctx.user.id,
    action: "FACE_RESET",
    module: "attendance",
    after: { employeeId: String(employeeId), reason, hadProfile: Boolean(profile), hadPending: Boolean(pending) },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  void resolveRecipientForEmployee(employeeId)
    .then((recipients) =>
      notifyUsers(recipients, {
        kind: "attendance",
        title: "Data wajah presensi Anda direset",
        body: `HRD menghapus data wajah Anda. Alasan: ${reason}. Daftarkan ulang wajah di Profil & Keamanan bila verifikasi wajah diwajibkan.`,
        href: "/portal/profile?tab=face",
      })
    )
    .catch(() => {});

  return apiSuccess({ reset: true }, "Data wajah karyawan dihapus. Karyawan perlu mendaftar ulang.");
});
