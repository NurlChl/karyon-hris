/**
 * Payslip layout vocabulary and defaults.
 *
 * Kept free of Mongoose for the same reason as `lib/hr/kpi.ts`: the template
 * builder is a client component and needs these labels, but importing them from
 * the model file would pull the driver into the browser bundle.
 */

export type BlockType =
  | "header"
  | "employee_info"
  | "earnings"
  | "deductions"
  | "net_salary"
  | "attendance"
  | "note"
  | "signature";

export interface PayslipBlockShape {
  type: BlockType;
  enabled: boolean;
  /** Overrides the block's default heading; empty keeps the default. */
  title: string;
  options: Record<string, unknown>;
}

export const BLOCK_TYPES: BlockType[] = [
  "header",
  "employee_info",
  "earnings",
  "deductions",
  "net_salary",
  "attendance",
  "note",
  "signature",
];

export const BLOCK_LABELS: Record<BlockType, string> = {
  header: "Kop dokumen",
  employee_info: "Identitas karyawan",
  earnings: "Rincian penghasilan",
  deductions: "Rincian potongan",
  net_salary: "Gaji bersih",
  attendance: "Ringkasan kehadiran",
  note: "Catatan kaki",
  signature: "Kolom tanda tangan",
};

export const BLOCK_HINTS: Record<BlockType, string> = {
  header: "Nama perusahaan, alamat, judul dokumen, dan periode.",
  employee_info: "Nama, NIP, jabatan, dan kolom lain yang Anda pilih.",
  earnings: "Gaji pokok, tunjangan, dan lembur.",
  deductions: "Potongan keterlambatan, alpha, BPJS, dan pajak.",
  net_salary: "Total yang diterima, ditonjolkan dengan warna aksen.",
  attendance: "Jumlah kehadiran, keterlambatan, dan hari alpha.",
  note: "Teks bebas di bagian bawah, misalnya ketentuan keberatan.",
  signature: "Satu atau dua kolom tanda tangan.",
};

/** Employee fields the info block can print, with their labels. */
export const EMPLOYEE_FIELD_LABELS: Record<string, string> = {
  employeeId: "NIP",
  name: "Nama",
  positionName: "Jabatan",
  divisionName: "Divisi",
  branchName: "Cabang",
  joinDate: "Tanggal masuk",
  employmentStatus: "Status kepegawaian",
  taxStatus: "Status pajak",
  bankName: "Bank",
  bankAccount: "No. rekening",
  npwp: "NPWP",
};

/** The layout a new template starts from. */
export const DEFAULT_BLOCKS: PayslipBlockShape[] = [
  { type: "header", enabled: true, title: "", options: {} },
  { type: "employee_info", enabled: true, title: "", options: { columns: 2 } },
  { type: "earnings", enabled: true, title: "", options: { showZero: false } },
  { type: "deductions", enabled: true, title: "", options: { showZero: false } },
  { type: "net_salary", enabled: true, title: "", options: { showTerbilang: true } },
  { type: "attendance", enabled: true, title: "", options: {} },
  { type: "note", enabled: true, title: "", options: {} },
  { type: "signature", enabled: false, title: "", options: {} },
];

export const DEFAULT_EMPLOYEE_FIELDS = [
  "employeeId",
  "name",
  "positionName",
  "divisionName",
  "taxStatus",
  "bankAccount",
];

export const DEFAULT_FOOTER_NOTE =
  "Dokumen ini dihasilkan otomatis oleh sistem dan sah tanpa tanda tangan basah. " +
  "Keberatan atas perhitungan dapat diajukan ke HRD paling lambat 7 hari sejak slip diterbitkan.";
