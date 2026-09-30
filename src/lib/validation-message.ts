/**
 * One Indonesian sentence for a Zod issue: names the field and the rule
 * ("Nomor HP minimal 8 karakter."). Zod's defaults are English and technical
 * ("name: Too small: expected string…"), which told HR staff nothing.
 * Messages written in a schema (Indonesian, human) are kept as they are.
 */
const FIELDS: Record<string, string> = {
  name: "Nama", fullName: "Nama lengkap", email: "Email", personalEmail: "Email pribadi", password: "Kata sandi", newPassword: "Kata sandi baru", currentPassword: "Kata sandi saat ini",
  phone: "Nomor HP", nik: "NIK", npwp: "NPWP", employeeId: "NIP", employee: "Karyawan", employeeIds: "Karyawan", birthDate: "Tanggal lahir", birthPlace: "Tempat lahir",
  gender: "Jenis kelamin", religion: "Agama", maritalStatus: "Status pernikahan", address: "Alamat", city: "Kota", postalCode: "Kode pos",
  branchId: "Cabang", divisionId: "Divisi", departmentId: "Departemen", positionId: "Jabatan", managerId: "Atasan", role: "Peran", roleId: "Peran",
  bankName: "Nama bank", bankAccount: "Nomor rekening", accountNumber: "Nomor rekening", accountName: "Nama pemilik rekening",
  startDate: "Tanggal mulai", endDate: "Tanggal berakhir", date: "Tanggal", from: "Tanggal awal", to: "Tanggal akhir", period: "Periode", month: "Bulan", year: "Tahun",
  reason: "Alasan", notes: "Catatan", note: "Catatan", description: "Keterangan", title: "Judul", type: "Jenis", category: "Kategori", status: "Status",
  code: "Kode", quota: "Kuota", days: "Jumlah hari", amount: "Nominal", salary: "Gaji", baseSalary: "Gaji pokok", allowance: "Tunjangan",
  latitude: "Garis lintang", longitude: "Garis bujur", radius: "Radius", lateTolerance: "Toleransi terlambat", checkIn: "Jam masuk", checkOut: "Jam pulang",
  stage: "Tahap", stages: "Tahap seleksi", rejectionReason: "Alasan penolakan", openings: "Jumlah kebutuhan", vacancyId: "Lowongan", candidateId: "Pelamar",
  condition: "Kondisi", inventoryId: "Aset", signature: "Tanda tangan", url: "Tautan", webhookUrl: "URL webhook", scopes: "Cakupan akses", key: "Kunci", licenseKey: "License key",
  target: "Target", weight: "Bobot", score: "Nilai", rating: "Penilaian", file: "Berkas",
};
const ZOD_DEFAULT = /^(Too (small|big)|Invalid|Expected|Required|String must|Number must|Array must|Unrecognized)/i;

type Issue = { code: string; path: PropertyKey[]; minimum?: number | bigint; maximum?: number | bigint; origin?: string; format?: string; message?: string };

export function fieldLabel(key: string) {
  return FIELDS[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

export function validationMessage(issue: Issue | undefined): string {
  if (!issue) return "Periksa kembali data yang diisi.";
  if (issue.message && !ZOD_DEFAULT.test(issue.message)) return issue.message;
  const key = [...issue.path].reverse().find((part) => typeof part === "string") as string | undefined;
  const field = key ? fieldLabel(key) : "Data";
  const n = (value?: number | bigint) => Number(value ?? 0).toLocaleString("id-ID");
  switch (issue.code) {
    case "too_small":
      if (issue.origin === "string") return Number(issue.minimum) <= 1 ? `${field} wajib diisi.` : `${field} minimal ${n(issue.minimum)} karakter.`;
      if (issue.origin === "array" || issue.origin === "set") return `Pilih minimal ${n(issue.minimum)} ${field.toLowerCase()}.`;
      return `${field} minimal ${n(issue.minimum)}.`;
    case "too_big":
      if (issue.origin === "string") return `${field} maksimal ${n(issue.maximum)} karakter.`;
      if (issue.origin === "array" || issue.origin === "set") return `${field} maksimal ${n(issue.maximum)} item.`;
      return `${field} maksimal ${n(issue.maximum)}.`;
    case "invalid_format":
      if (issue.format === "email") return `${field} tidak valid. Contoh: nama@perusahaan.co.id.`;
      if (issue.format === "url") return `${field} harus berupa alamat lengkap, misalnya https://contoh.co.id.`;
      if (issue.format === "datetime" || issue.format === "date") return `${field} bukan tanggal yang valid.`;
      return `Format ${field.toLowerCase()} tidak sesuai.`;
    case "invalid_type": return issue.message?.includes("undefined") ? `${field} wajib diisi.` : `${field} wajib diisi dengan benar.`;
    case "invalid_value": return `Pilihan ${field.toLowerCase()} tidak tersedia. Pilih dari daftar yang ada.`;
    case "unrecognized_keys": return "Ada data tidak dikenal yang ikut terkirim. Muat ulang halaman lalu coba lagi.";
    default: return `Periksa kembali ${field.toLowerCase()}.`;
  }
}
