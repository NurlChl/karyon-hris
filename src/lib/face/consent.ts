/**
 * Consent wording for face enrolment.
 *
 * Shared by the enrolment screen and the server. The version is stored on each
 * profile, so that if the wording changes it is always possible to tell which
 * text a given employee actually agreed to.
 *
 * Kept free of server imports so the portal page can render it.
 */
export const FACE_CONSENT_VERSION = "2026-09-v1";

export const FACE_CONSENT_POINTS = [
  "Foto wajah saya diolah menjadi data biometrik untuk mencocokkan foto saat presensi. Data ini tidak dipakai untuk tujuan lain.",
  "Data wajah disimpan terenkripsi. Satu foto acuan disimpan agar atasan dan HRD dapat memeriksa permintaan penggantian wajah.",
  "Hanya saya, HRD, dan Superadmin yang dapat melihat foto acuan. Atasan hanya melihatnya saat memeriksa permintaan penggantian wajah saya.",
  "Penggantian wajah yang sudah terdaftar memerlukan persetujuan atasan (SPV).",
  "Saya dapat meminta HRD menghapus data wajah saya. Selama verifikasi wajah diwajibkan perusahaan, saya perlu mendaftar ulang sebelum dapat absen kembali.",
];
