import { RecordId } from "@/lib/postgres";
import database from "@/lib/postgres";
import { decodeDataUrl, storageProvider } from "@/lib/storage";
import { encrypt, decrypt } from "@/lib/crypto";
import { getSettings } from "@/lib/settings";
import { HttpError } from "@/lib/guard";
import { getEntitlements } from "@/lib/licensing/server";
import FaceProfile from "@/models/FaceProfile";
import {
  analyseFace,
  bestDistance,
  faceDistance,
  qualityProblem,
  QUALITY_MESSAGE,
  FACE_THRESHOLDS,
  type FaceStrictness,
} from "./engine";

/** Photos taken at enrolment. Several angles of one sitting match more
 *  reliably later than a single frame does. */
export const ENROL_SAMPLES = 3;

const PHOTO_MIME = ["image/jpeg", "image/png", "image/webp"];

export interface FaceSettings {
  enabled: boolean;
  strictness: FaceStrictness;
  threshold: number;
}

export async function getFaceSettings(): Promise<FaceSettings> {
  const [s, entitlement] = await Promise.all([getSettings(), getEntitlements()]);
  const strictness = (["ketat", "normal", "longgar"].includes(String(s.face_match_strictness))
    ? s.face_match_strictness
    : "normal") as FaceStrictness;
  return {
    enabled: Boolean(s.face_recognition_enabled) && ["active", "grace"].includes(entitlement.status) && entitlement.features.includes("face.advanced"),
    strictness,
    threshold: FACE_THRESHOLDS[strictness],
  };
}

export function sealDescriptors(descriptors: number[][]): string {
  // Four decimals is far below the model's noise floor and keeps the stored
  // blob small; it does not measurably move any distance.
  return encrypt(JSON.stringify(descriptors.map((d) => d.map((v) => Math.round(v * 1e4) / 1e4))));
}

export function openDescriptors(sealed: string): number[][] {
  const parsed: unknown = JSON.parse(decrypt(sealed));
  if (!Array.isArray(parsed)) throw new Error("Data wajah rusak.");
  return parsed as number[][];
}

/* ------------------------------------------------------------------ */
/* Enrolment                                                           */
/* ------------------------------------------------------------------ */

export interface EnrolmentSamples {
  descriptors: number[][];
  /** The sharpest sample, kept as the reference an approver looks at. */
  reference: { buffer: Buffer; ext: string; mime: string };
}

/**
 * Turns enrolment photos into descriptors, refusing anything unusable.
 *
 * Every sample has to contain exactly one clear face, and all samples have to
 * be the same person. That last check matters more than it looks: without it,
 * someone can enrol with two photos of themself and one of a colleague, and
 * the colleague then matches their profile for every clock-in.
 */
export async function analyseEnrolment(photos: string[]): Promise<EnrolmentSamples> {
  if (photos.length !== ENROL_SAMPLES) {
    throw new HttpError(400, "BAD_REQUEST", `Ambil tepat ${ENROL_SAMPLES} foto wajah.`);
  }

  const decoded = photos.map((p) => decodeDataUrl(p, PHOTO_MIME));
  const analyses = await Promise.all(decoded.map((d) => analyseFace(new Uint8Array(d.buffer))));

  analyses.forEach((a, i) => {
    const problem = qualityProblem(a);
    if (problem) {
      throw new HttpError(422, "FACE_QUALITY", `Foto ke-${i + 1}: ${QUALITY_MESSAGE[problem]}`);
    }
  });

  const descriptors = analyses.map((a) => a.descriptor!);
  const { threshold } = await getFaceSettings();

  for (let i = 0; i < descriptors.length; i++) {
    for (let j = i + 1; j < descriptors.length; j++) {
      if (faceDistance(descriptors[i], descriptors[j]) > threshold) {
        throw new HttpError(
          422,
          "FACE_INCONSISTENT",
          `Foto ke-${i + 1} dan ke-${j + 1} tidak terlihat sebagai orang yang sama. ` +
            "Ulangi pengambilan dengan wajah yang sama di setiap foto."
        );
      }
    }
  }

  const best = analyses.reduce((bi, a, i) => (a.score > analyses[bi].score ? i : bi), 0);
  return {
    descriptors,
    reference: { buffer: decoded[best].buffer, ext: decoded[best].ext, mime: decoded[best].mime },
  };
}

export async function storeReferencePhoto(
  employeeId: string,
  kind: "profile" | "request",
  photo: { buffer: Buffer; ext: string; mime: string }
): Promise<string> {
  // `ext` from decodeDataUrl already carries its dot.
  const key = `faces/${employeeId}/${kind}-${Date.now()}${photo.ext}`;
  return storageProvider.upload(photo.buffer, key, photo.mime);
}

/* ------------------------------------------------------------------ */
/* Attendance verification                                             */
/* ------------------------------------------------------------------ */

export class FaceMismatchError extends HttpError {
  constructor(public readonly distance: number) {
    super(
      422,
      "FACE_MISMATCH",
      "Wajah di foto tidak cocok dengan wajah yang terdaftar, jadi absen tidak dicatat. " +
        "Coba lagi dengan wajah menghadap kamera dan pencahayaan cukup. Bila terus gagal, " +
        "ajukan koreksi absen dan hubungi atasan Anda."
    );
  }
}

export interface FaceVerification {
  distance: number;
  threshold: number;
}

/**
 * Verifies an attendance selfie against the employee's enrolled face.
 *
 * Throws with a message the employee can act on. There is intentionally no
 * fallback path that accepts the photo anyway: an employee whose face will not
 * verify — an injury, a broken camera — uses an attendance correction, which
 * goes through approval like any other exception.
 */
export async function verifyAttendanceFace(
  employeeId: string,
  photo: Buffer,
  threshold: number
): Promise<FaceVerification> {
  const profile = await FaceProfile.findOne({ employeeId: new RecordId(employeeId) })
    .select("descriptors")
    .lean<{ _id: RecordId; descriptors: string } | null>();

  if (!profile) {
    throw new HttpError(
      403,
      "FACE_NOT_ENROLLED",
      "Wajah Anda belum terdaftar. Daftarkan wajah di menu Profil & Keamanan sebelum absen."
    );
  }

  const analysis = await analyseFace(new Uint8Array(photo));
  const problem = qualityProblem(analysis);
  if (problem) throw new HttpError(422, "FACE_QUALITY", QUALITY_MESSAGE[problem]);

  const distance = bestDistance(analysis.descriptor!, openDescriptors(profile.descriptors));

  if (distance > threshold) {
    // The distance is deliberately not returned. A number that says how close
    // a photo came is a gradient: someone could adjust a picture of a colleague
    // step by step until it slips under the threshold. It goes to the audit log
    // through `FaceMismatchError.distance` instead.
    throw new FaceMismatchError(distance);
  }

  void FaceProfile.updateOne({ _id: profile._id }, { lastVerifiedAt: new Date() }).catch(() => {});
  return { distance, threshold };
}
