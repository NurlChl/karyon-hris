export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  aliases?: string[];
  hint?: string;
}

/**
 * CSV import datasets. Imports are company-wide administrative actions: they
 * require `write` on the module with scope "all" and run in one transaction.
 * Order matters for a new install: branches → divisions → positions → employees.
 */
export const IMPORT_DATASETS = {
  branches: {
    label: "Cabang kantor",
    module: "settings",
    description: "Tambah atau perbarui cabang berdasarkan nama. Community mendukung satu cabang; cabang tambahan memerlukan Pro.",
    fields: [
      { key: "name", label: "Nama cabang", required: true },
      { key: "address", label: "Alamat", required: true },
      { key: "lat", label: "Latitude", required: true, hint: "Contoh -6.2088" },
      { key: "lng", label: "Longitude", required: true, hint: "Contoh 106.8456" },
      { key: "radius", label: "Radius absen (m)", hint: "Kosong = pengaturan default" },
      { key: "open", label: "Jam buka", hint: "HH:MM" },
      { key: "close", label: "Jam tutup", hint: "HH:MM" },
    ],
    example: ["Kantor Pusat Jakarta", "Jl. Sudirman No. 1, Jakarta", "-6.2088", "106.8456", "50", "08:00", "17:00"],
  },
  divisions: {
    label: "Divisi",
    module: "settings",
    description: "Tambah atau perbarui divisi berdasarkan nama.",
    fields: [
      { key: "name", label: "Nama divisi", required: true },
      { key: "branch", label: "Cabang", hint: "Nama cabang yang sudah ada (opsional)" },
    ],
    example: ["Keuangan", "Kantor Pusat Jakarta"],
  },
  positions: {
    label: "Jabatan",
    module: "settings",
    description: "Tambah atau perbarui jabatan berdasarkan nama.",
    fields: [
      { key: "name", label: "Nama jabatan", required: true },
      { key: "division", label: "Divisi", hint: "Nama divisi yang sudah ada (opsional)" },
      { key: "description", label: "Deskripsi" },
    ],
    example: ["Staf Akuntansi", "Keuangan", "Mencatat transaksi harian"],
  },
  employees: {
    label: "Karyawan",
    module: "employees",
    description: "Karyawan baru dibuat bila NIP kosong; baris dengan NIP yang sudah ada memperbarui kolom yang diisi saja. Cabang, divisi, dan jabatan harus sudah ada.",
    fields: [
      { key: "nip", label: "NIP", aliases: ["employeeId", "Nomor induk"], hint: "Kosongkan untuk karyawan baru (NIP dibuat otomatis)" },
      { key: "name", label: "Nama", required: true, aliases: ["Nama lengkap"] },
      { key: "officeEmail", label: "Email kantor", hint: "Wajib bila akun login dibuat; dipakai untuk login" },
      { key: "personalEmail", label: "Email pribadi" },
      { key: "phone", label: "Telepon", aliases: ["No. HP", "Nomor telepon"] },
      { key: "branch", label: "Cabang" },
      { key: "division", label: "Divisi" },
      { key: "position", label: "Jabatan" },
      { key: "joinDate", label: "Tanggal masuk", hint: "YYYY-MM-DD atau DD/MM/YYYY" },
      { key: "employmentStatus", label: "Status kepegawaian", hint: "PKWT, PKWTT, Probation, Magang, Harian lepas, Paruh waktu, Outsource, Lainnya" },
      { key: "status", label: "Status", hint: "Aktif (default) atau Onboarding" },
      { key: "birthPlace", label: "Tempat lahir" },
      { key: "birthDate", label: "Tanggal lahir" },
      { key: "gender", label: "Jenis kelamin", hint: "L/P" },
      { key: "religion", label: "Agama" },
      { key: "maritalStatus", label: "Status pernikahan" },
      { key: "taxStatus", label: "Status pajak", hint: "TK/0, K/1, ..." },
      { key: "nik", label: "NIK", hint: "16 digit" },
      { key: "npwp", label: "NPWP" },
      { key: "bpjsKesehatan", label: "BPJS Kesehatan" },
      { key: "bpjsKetenagakerjaan", label: "BPJS Ketenagakerjaan" },
      { key: "bankName", label: "Bank" },
      { key: "accountNumber", label: "No. rekening" },
      { key: "accountHolder", label: "Atas nama" },
      { key: "supervisorNip", label: "NIP atasan" },
      { key: "createAccount", label: "Buat akun login", hint: "Ya/Tidak. Default Ya untuk karyawan baru yang punya email kantor" },
    ],
    example: ["", "Siti Rahma", "siti.rahma@perusahaan.co.id", "", "081234567890", "Kantor Pusat Jakarta", "Keuangan", "Staf Akuntansi", "2026-01-15", "PKWT", "Aktif", "Bandung", "1995-04-12", "P", "Islam", "Belum Menikah", "TK/0", "", "", "", "", "BCA", "", "Siti Rahma", "", "Ya"],
  },
} as const satisfies Record<string, { label: string; module: string; description: string; fields: readonly ImportField[]; example: readonly string[] }>;

export type ImportDataset = keyof typeof IMPORT_DATASETS;
