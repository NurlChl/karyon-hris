import { z } from "zod";
import { attachmentInputSchema, httpUrl, type AttachmentInput, type StoredAttachment } from "@/lib/attachments";

/**
 * Application forms, configured per vacancy.
 *
 * One definition drives three things that must never disagree: the builder HR
 * uses, the form a candidate fills in, and the server's validation of what
 * arrives. The server rebuilds its validation from the stored definition on
 * every submission, so a field HR switched off cannot be smuggled in and a
 * required field cannot be skipped by calling the API directly.
 *
 * No server imports here: the career page and the builder both use it.
 */

export type FieldType =
  | "short_text"
  | "long_text"
  | "email"
  | "phone"
  | "number"
  | "currency"
  | "date"
  | "url"
  | "select"
  | "multi_select"
  | "radio"
  | "yes_no"
  | "file"
  | "address";

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  short_text: "Teks singkat",
  long_text: "Paragraf",
  email: "Email",
  phone: "Nomor telepon",
  number: "Angka",
  currency: "Nominal rupiah",
  date: "Tanggal",
  url: "Tautan",
  select: "Pilihan (dropdown)",
  multi_select: "Pilihan ganda (boleh lebih dari satu)",
  radio: "Pilihan tunggal (tombol)",
  yes_no: "Ya / tidak",
  file: "Berkas atau tautan",
  address: "Alamat",
};

export const FIELD_TYPE_HINTS: Record<FieldType, string> = {
  short_text: "Satu baris, misalnya nama sekolah.",
  long_text: "Beberapa kalimat, misalnya pengalaman kerja.",
  email: "Diperiksa formatnya.",
  phone: "Angka, spasi, +, dan tanda hubung.",
  number: "Bilangan, misalnya lama pengalaman dalam tahun.",
  currency: "Nominal dalam rupiah, misalnya gaji yang diharapkan.",
  date: "Dipilih dari kalender.",
  url: "Alamat web yang diawali http:// atau https://.",
  select: "Satu jawaban dari daftar yang bisa dicari.",
  multi_select: "Beberapa jawaban sekaligus.",
  radio: "Satu jawaban, semua pilihan terlihat. Cocok untuk 2–5 pilihan.",
  yes_no: "Jawaban ya atau tidak.",
  file: "Unggah berkas atau tempel tautan, misalnya CV atau sertifikat.",
  address: "Jalan, kota, dan provinsi.",
};

export const TYPES_WITH_OPTIONS: FieldType[] = ["select", "multi_select", "radio"];

/**
 * Fields the system understands by meaning, not just by label.
 *
 * Their answers are copied into dedicated candidate columns (for search and
 * filters) and, on hiring, into the new employee record. Name, email, and
 * phone are always on: a candidate who cannot be identified or contacted is
 * not an application.
 */
export type SystemKey =
  | "name"
  | "email"
  | "phone"
  | "address"
  | "birthDate"
  | "gender"
  | "lastEducation"
  | "cv"
  | "portfolio"
  | "documents"
  | "availableFrom"
  | "expectedSalary"
  | "coverLetter";

export const LOCKED_KEYS: SystemKey[] = ["name", "email", "phone"];

export interface FieldOption {
  value: string;
  label: string;
}

export interface FormField {
  /** Stable identity; answers are stored against it. */
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  enabled: boolean;
  /** Set for system fields; their type cannot be changed. */
  system: SystemKey | null;
  section: string;
  placeholder: string;
  helpText: string;
  options: FieldOption[];
  /** `file` only. */
  maxFiles: number;
  /** `file` only: whether a pasted link is accepted instead of an upload. */
  allowLink: boolean;
}

export const SECTION_SUGGESTIONS = ["Data diri", "Dokumen", "Ketersediaan", "Pertanyaan tambahan"];

export interface AddressValue {
  street: string;
  city: string;
  province: string;
  postalCode: string;
}

const field = (f: Partial<FormField> & Pick<FormField, "key" | "label" | "type">): FormField => ({
  required: false,
  enabled: true,
  system: null,
  section: "Pertanyaan tambahan",
  placeholder: "",
  helpText: "",
  options: [],
  maxFiles: 1,
  allowLink: true,
  ...f,
});

export const EDUCATION_OPTIONS: FieldOption[] = [
  { value: "sma", label: "SMA / SMK sederajat" },
  { value: "d3", label: "Diploma (D1–D3)" },
  { value: "d4s1", label: "Sarjana / D4" },
  { value: "s2", label: "Magister (S2)" },
  { value: "s3", label: "Doktor (S3)" },
];

/** The form a new vacancy starts with. HR adjusts from here. */
export function defaultFormFields(): FormField[] {
  return [
    field({ key: "name", system: "name", label: "Nama lengkap", type: "short_text", required: true, section: "Data diri", placeholder: "Sesuai KTP" }),
    field({ key: "email", system: "email", label: "Email", type: "email", required: true, section: "Data diri", placeholder: "nama@email.com", helpText: "Kabar seleksi dikirim ke alamat ini." }),
    field({ key: "phone", system: "phone", label: "Nomor telepon / WhatsApp", type: "phone", required: true, section: "Data diri", placeholder: "08xx xxxx xxxx" }),
    field({ key: "address", system: "address", label: "Alamat asal", type: "address", required: true, section: "Data diri" }),
    field({ key: "birthDate", system: "birthDate", label: "Tanggal lahir", type: "date", enabled: false, section: "Data diri" }),
    field({
      key: "gender", system: "gender", label: "Jenis kelamin", type: "radio", enabled: false, section: "Data diri",
      options: [{ value: "male", label: "Laki-laki" }, { value: "female", label: "Perempuan" }],
    }),
    field({ key: "lastEducation", system: "lastEducation", label: "Pendidikan terakhir", type: "select", required: true, section: "Data diri", options: EDUCATION_OPTIONS }),
    field({ key: "cv", system: "cv", label: "CV", type: "file", required: true, section: "Dokumen", helpText: "PDF lebih disarankan agar tampilannya tidak berubah." }),
    field({ key: "portfolio", system: "portfolio", label: "Portofolio", type: "file", section: "Dokumen", helpText: "Tautan situs, Behance, GitHub, atau berkas portofolio." }),
    field({ key: "documents", system: "documents", label: "Dokumen tambahan", type: "file", section: "Dokumen", maxFiles: 5, helpText: "Misalnya ijazah, transkrip, sertifikat, atau surat referensi." }),
    field({ key: "availableFrom", system: "availableFrom", label: "Bisa mulai bekerja", type: "date", required: true, section: "Ketersediaan" }),
    field({ key: "expectedSalary", system: "expectedSalary", label: "Gaji yang diharapkan", type: "currency", section: "Ketersediaan", placeholder: "Per bulan" }),
    field({ key: "coverLetter", system: "coverLetter", label: "Surat lamaran singkat", type: "long_text", section: "Pertanyaan tambahan", placeholder: "Ceritakan mengapa Anda cocok untuk posisi ini." }),
  ];
}

export function newCustomField(): FormField {
  return field({
    key: `q_${Math.random().toString(36).slice(2, 8)}`,
    label: "",
    type: "short_text",
  });
}

/** Tidies a definition from the builder before it is stored. */
export function normaliseFields(fields: FormField[]): FormField[] {
  return fields.map((f) => {
    const locked = f.system !== null && (LOCKED_KEYS as string[]).includes(f.system);
    return {
      ...f,
      label: f.label.trim(),
      section: f.section.trim() || "Pertanyaan tambahan",
      enabled: locked ? true : f.enabled,
      required: locked ? true : f.enabled && f.required,
      options: TYPES_WITH_OPTIONS.includes(f.type)
        ? f.options.map((o) => ({ value: o.value.trim() || o.label.trim(), label: o.label.trim() })).filter((o) => o.label)
        : [],
      maxFiles: f.type === "file" ? Math.min(10, Math.max(1, Math.round(f.maxFiles || 1))) : 1,
      allowLink: f.type === "file" ? f.allowLink : false,
    };
  });
}

/** Problems a definition has, in words HR can act on. Empty when valid. */
export function definitionProblems(fields: FormField[]): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const f of fields) {
    if (keys.has(f.key)) problems.push(`Kode kolom "${f.key}" dipakai lebih dari sekali.`);
    keys.add(f.key);
    if (!f.label.trim()) problems.push("Ada kolom tanpa label. Beri nama agar pelamar tahu apa yang diisi.");
    if (TYPES_WITH_OPTIONS.includes(f.type) && f.enabled && f.options.filter((o) => o.label.trim()).length < 2) {
      problems.push(`Kolom "${f.label || "tanpa label"}" butuh minimal dua pilihan.`);
    }
  }
  for (const k of LOCKED_KEYS) {
    if (!fields.some((f) => f.system === k)) problems.push(`Kolom wajib sistem "${k}" tidak boleh dihapus.`);
  }
  return [...new Set(problems)];
}

/* ------------------------------------------------------------------ */
/* Answer validation                                                   */
/* ------------------------------------------------------------------ */

const addressSchema = z.object({
  street: z.string().trim().max(300).default(""),
  city: z.string().trim().max(100).default(""),
  province: z.string().trim().max(100).default(""),
  postalCode: z.string().trim().max(10).default(""),
});

/** Schema for one field's answer, built from its definition. */
function answerSchema(f: FormField): z.ZodType<unknown> {
  const req = (message = `${f.label} wajib diisi.`) => message;
  const optionValues = f.options.map((o) => o.value);

  switch (f.type) {
    case "short_text": {
      const s = z.string().trim().max(200, `${f.label} maksimal 200 karakter.`);
      return f.required ? s.min(1, req()) : s.optional().default("");
    }
    case "long_text": {
      const s = z.string().trim().max(5000, `${f.label} maksimal 5.000 karakter.`);
      return f.required ? s.min(1, req()) : s.optional().default("");
    }
    case "email": {
      const s = z.string().trim().toLowerCase().email(`${f.label} tidak valid.`);
      return f.required ? s : z.union([s, z.literal("")]).optional().default("");
    }
    case "phone": {
      const s = z.string().trim().regex(/^[0-9+()\-\s]{8,20}$/, `${f.label} tidak valid.`);
      return f.required ? s : z.union([s, z.literal("")]).optional().default("");
    }
    case "number":
    case "currency": {
      const n = z.number({ message: `${f.label} harus berupa angka.` }).min(0, `${f.label} tidak boleh negatif.`).max(1e12);
      return f.required ? n : n.nullable().optional().default(null);
    }
    case "date": {
      const s = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${f.label} tidak valid.`);
      return f.required ? s : z.union([s, z.literal("")]).optional().default("");
    }
    case "url":
      return f.required ? httpUrl : z.union([httpUrl, z.literal("")]).optional().default("");
    case "select":
    case "radio": {
      const s = z.string().refine((v) => optionValues.includes(v), `Pilihan ${f.label} tidak dikenali.`);
      return f.required ? s : z.union([s, z.literal("")]).optional().default("");
    }
    case "multi_select": {
      const a = z.array(z.string().refine((v) => optionValues.includes(v), `Pilihan ${f.label} tidak dikenali.`)).max(optionValues.length);
      return f.required ? a.min(1, `Pilih minimal satu untuk ${f.label}.`) : a.optional().default([]);
    }
    case "yes_no":
      return f.required ? z.boolean({ message: req() }) : z.boolean().nullable().optional().default(null);
    case "file": {
      const inputs = z
        .array(attachmentInputSchema)
        .max(f.maxFiles, `${f.label} maksimal ${f.maxFiles} lampiran.`)
        .refine((items) => f.allowLink || items.every((i) => i.kind === "file"), `${f.label} harus berupa berkas.`);
      return f.required ? inputs.min(1, `${f.label} wajib dilampirkan.`) : inputs.optional().default([]);
    }
    case "address":
      return f.required
        ? addressSchema.refine((a) => a.street && a.city, `${f.label}: isi minimal jalan dan kota.`)
        : addressSchema.optional();
  }
}

/** Validates submitted answers against a definition. Unknown keys are dropped. */
export function buildAnswersSchema(fields: FormField[]) {
  const shape: Record<string, z.ZodType<unknown>> = {};
  for (const f of fields) if (f.enabled) shape[f.key] = answerSchema(f);
  return z.object(shape);
}

/* ------------------------------------------------------------------ */
/* Stored answers                                                      */
/* ------------------------------------------------------------------ */

/**
 * One answer as kept on the candidate, with the label and type copied from the
 * definition at the moment of applying. Editing the form later — renaming a
 * question or removing it — must not change what an earlier candidate is shown
 * to have answered.
 */
export interface StoredAnswer {
  key: string;
  label: string;
  type: FieldType;
  section: string;
  system: SystemKey | null;
  value: unknown;
  attachments: StoredAttachment[];
}

/** Human-readable form of a stored value, for tables, search, and exports. */
export function displayAnswer(answer: Pick<StoredAnswer, "type" | "value">, options: FieldOption[] = []): string {
  const v = answer.value;
  if (v === null || v === undefined || v === "") return "";
  const label = (x: string) => options.find((o) => o.value === x)?.label ?? x;
  switch (answer.type) {
    case "yes_no":
      return v ? "Ya" : "Tidak";
    case "currency":
      return typeof v === "number" ? `Rp ${v.toLocaleString("id-ID")}` : String(v);
    case "multi_select":
      return Array.isArray(v) ? v.map((x) => label(String(x))).join(", ") : String(v);
    case "select":
    case "radio":
      return label(String(v));
    case "address": {
      const a = v as Partial<AddressValue>;
      return [a.street, a.city, a.province, a.postalCode].filter(Boolean).join(", ");
    }
    default:
      return String(v);
  }
}

export type { AttachmentInput };
