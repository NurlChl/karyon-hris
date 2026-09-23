/** Shared human-readable labels for enum values stored in the database. */

export const CORRECTION_REASON_LABELS: Record<string, string> = {
  lupa_tap: "Lupa melakukan tap absen",
  kendala_aplikasi: "Kendala aplikasi / perangkat",
  dinas_luar: "Dinas luar tanpa akses internet",
  lainnya: "Lainnya",
};

export const COMPLAINT_TARGET_LABELS: Record<string, string> = {
  spv: "Atasan Langsung (SPV)",
  hrd: "HRD",
  direksi: "Direksi",
};

export const EMPLOYMENT_STATUS_LABELS: Record<string, string> = {
  probation: "Masa Percobaan",
  pkwt: "PKWT (Kontrak)",
  pkwtt: "PKWTT (Tetap)",
  outsource: "Outsource",
};

export const EMPLOYEE_STATUS_LABELS: Record<string, string> = {
  active: "Aktif",
  onboarding: "Onboarding",
  suspended: "Ditangguhkan",
  resigned: "Resign",
};

export const INVENTORY_CATEGORY_LABELS: Record<string, string> = {
  laptop: "Laptop",
  phone: "Telepon/HP",
  vehicle: "Kendaraan",
  other: "Lainnya",
};

export const INVENTORY_CONDITION_LABELS: Record<string, string> = {
  good: "Baik",
  damaged: "Rusak",
  lost: "Hilang",
};
