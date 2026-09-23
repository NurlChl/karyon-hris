/**
 * The RBAC vocabulary: every module `checkPermission` may be asked about, the
 * actions each supports, and the data scopes a grant can carry.
 *
 * Kept here rather than in the route file so both the API and the Settings UI
 * read from the same list — a module missing from this array is a module no
 * role can ever be granted.
 */

export const RBAC_MODULES: Array<{ id: string; label: string; hint: string }> = [
  { id: "discipline", label: "Disiplin & SP", hint: "Lihat kasus; Tambah/Ubah untuk mencatat; Setujui untuk menerbitkan/menolak/menutup. Pilih bawahan langsung untuk atasan. Tidak boleh menindak diri sendiri." },
  { id: "attendance", label: "Presensi", hint: "Absensi harian, koreksi absen, dan rekap kehadiran." },
  { id: "employees", label: "Data Karyawan", hint: "Profil, kontak, dan data kepegawaian." },
  { id: "leave", label: "Izin & Cuti", hint: "Pengajuan dan persetujuan izin/cuti." },
  { id: "holiday_swap", label: "Tukar Libur", hint: "Pengajuan dan persetujuan tukar hari libur." },
  { id: "payroll", label: "Payroll", hint: "Slip gaji dan komponen penggajian." },
  { id: "recruitment", label: "Rekrutmen", hint: "Kandidat, tahapan seleksi, dan lowongan." },
  { id: "kpi", label: "KPI & Kinerja", hint: "Template indikator dan penilaian karyawan." },
  { id: "contracts", label: "Kontrak Kerja", hint: "PKWT/PKWTT dan perpanjangannya." },
  { id: "inventory", label: "Inventaris", hint: "Aset perusahaan dan serah terima barang." },
  { id: "complaint", label: "Pengaduan", hint: "Laporan dan keluhan karyawan." },
  { id: "reports", label: "Laporan & Analitik", hint: "Dashboard dan ekspor laporan." },
  { id: "audit", label: "Log Audit", hint: "Jejak aktivitas seluruh sistem." },
  { id: "settings", label: "Pengaturan Sistem", hint: "Konfigurasi, role, dan master data." },
];

export const RBAC_ACTIONS = [
  { id: "read", label: "Lihat" },
  { id: "write", label: "Tambah / Ubah" },
  { id: "delete", label: "Hapus" },
  { id: "approve", label: "Setujui" },
  { id: "export", label: "Ekspor" },
];

export const RBAC_SCOPES = [
  { id: "reports", label: "Bawahan langsung (Disiplin & SP)" },
  { id: "self", label: "Data sendiri" },
  { id: "division", label: "Satu divisi" },
  { id: "branch", label: "Satu cabang" },
  { id: "all", label: "Seluruh perusahaan" },
];

export const MODULE_IDS = RBAC_MODULES.map((m) => m.id);
export const ACTION_IDS = RBAC_ACTIONS.map((a) => a.id);
