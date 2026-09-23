/**
 * Employment contracts: types, statuses, template placeholders and rendering.
 * Client-safe, shared by the API, the admin screen and the print page.
 */

export type ContractType =
  | "pkwt"
  | "pkwtt"
  | "probation"
  | "magang"
  | "harian_lepas"
  | "paruh_waktu"
  | "outsource"
  | "lainnya";

export const CONTRACT_TYPES: Array<{
  value: ContractType;
  label: string;
  short: string;
  hint: string;
  /** Contracts of this type end on a date and need a renewal decision. */
  hasEndDate: boolean;
}> = [
  { value: "pkwt", label: "PKWT (kontrak waktu tertentu)", short: "PKWT", hint: "Karyawan kontrak dengan tanggal berakhir", hasEndDate: true },
  { value: "pkwtt", label: "PKWTT (karyawan tetap)", short: "Tetap", hint: "Tanpa tanggal berakhir", hasEndDate: false },
  { value: "probation", label: "Masa percobaan", short: "Percobaan", hint: "Umumnya maksimal 3 bulan, sebelum PKWTT", hasEndDate: true },
  { value: "magang", label: "Magang", short: "Magang", hint: "Perjanjian pemagangan", hasEndDate: true },
  { value: "harian_lepas", label: "Harian lepas", short: "Harian", hint: "Dibayar per hari kerja", hasEndDate: true },
  { value: "paruh_waktu", label: "Paruh waktu", short: "Paruh waktu", hint: "Jam kerja di bawah penuh waktu", hasEndDate: true },
  { value: "outsource", label: "Alih daya (outsource)", short: "Outsource", hint: "Melalui perusahaan penyedia tenaga kerja", hasEndDate: true },
  { value: "lainnya", label: "Lainnya", short: "Lainnya", hint: "Tuliskan nama jenisnya sendiri", hasEndDate: true },
];

export const CONTRACT_TYPE_MAP = Object.fromEntries(CONTRACT_TYPES.map((t) => [t.value, t])) as Record<
  ContractType,
  (typeof CONTRACT_TYPES)[number]
>;

export function contractTypeLabel(type: string, customLabel?: string) {
  if (type === "lainnya" && customLabel) return customLabel;
  return CONTRACT_TYPE_MAP[type as ContractType]?.short ?? type;
}

export type ContractStatus = "draft" | "active" | "ended" | "terminated";
export type ContractDecision = "pending" | "renew" | "permanent" | "not_renew";

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: "Draf",
  active: "Berlaku",
  ended: "Berakhir",
  terminated: "Diakhiri lebih awal",
};

export const DECISION_LABELS: Record<ContractDecision, string> = {
  pending: "Belum diputuskan",
  renew: "Diperpanjang",
  permanent: "Diangkat tetap",
  not_renew: "Tidak diperpanjang",
};

/** Employee `employmentStatus` that follows from a contract type. */
export function employmentStatusFor(type: ContractType): string {
  return type;
}

/* ------------------------------------------------------------------ */
/* Placeholders                                                         */
/* ------------------------------------------------------------------ */

export const PLACEHOLDERS: Array<{ key: string; label: string }> = [
  { key: "nomor_kontrak", label: "Nomor kontrak" },
  { key: "jenis_kontrak", label: "Jenis kontrak" },
  { key: "nama", label: "Nama karyawan" },
  { key: "nip", label: "NIP" },
  { key: "nik", label: "NIK" },
  { key: "tempat_lahir", label: "Tempat lahir" },
  { key: "tanggal_lahir", label: "Tanggal lahir" },
  { key: "alamat", label: "Alamat KTP" },
  { key: "jabatan", label: "Jabatan" },
  { key: "divisi", label: "Divisi" },
  { key: "cabang", label: "Cabang penempatan" },
  { key: "tanggal_mulai", label: "Tanggal mulai" },
  { key: "tanggal_selesai", label: "Tanggal berakhir" },
  { key: "durasi", label: "Lama kontrak" },
  { key: "gaji_pokok", label: "Gaji pokok" },
  { key: "tunjangan", label: "Tunjangan tetap" },
  { key: "nama_perusahaan", label: "Nama perusahaan" },
  { key: "alamat_perusahaan", label: "Alamat perusahaan" },
  { key: "penandatangan", label: "Nama penandatangan perusahaan" },
  { key: "jabatan_penandatangan", label: "Jabatan penandatangan" },
  { key: "kota", label: "Kota penandatanganan" },
  { key: "tanggal_hari_ini", label: "Tanggal dokumen" },
];

/** Replaces `{{key}}` markers. Unknown keys stay visible so a typo is noticed on the preview. */
export function fillPlaceholders(content: string, values: Record<string, string>) {
  return content.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] || "-" : match
  );
}

/**
 * A deliberately small markup, so HR can write a contract in a text box:
 * `# ` centred title, `## ` heading, `- ` bullet, `1. ` numbered item, blank
 * line between paragraphs, `**tebal**` inline.
 */
export type ContractBlock =
  | { type: "title"; text: string }
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "numbered"; items: string[] };

export function parseContract(content: string): ContractBlock[] {
  const blocks: ContractBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (const raw of content.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith("# ")) {
      flush();
      blocks.push({ type: "title", text: line.slice(2) });
    } else if (line.startsWith("## ")) {
      flush();
      blocks.push({ type: "heading", text: line.slice(3) });
    } else if (/^[-•]\s+/.test(line)) {
      flush();
      const last = blocks[blocks.length - 1];
      const item = line.replace(/^[-•]\s+/, "");
      if (last?.type === "bullets") last.items.push(item);
      else blocks.push({ type: "bullets", items: [item] });
    } else if (/^\d+[.)]\s+/.test(line)) {
      flush();
      const last = blocks[blocks.length - 1];
      const item = line.replace(/^\d+[.)]\s+/, "");
      if (last?.type === "numbered") last.items.push(item);
      else blocks.push({ type: "numbered", items: [item] });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

/** Splits `**bold**` runs for rendering. */
export function inlineRuns(text: string): Array<{ text: string; bold: boolean }> {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) => (part.startsWith("**") && part.endsWith("**") ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false }));
}

/* ------------------------------------------------------------------ */
/* Default templates                                                    */
/* ------------------------------------------------------------------ */

export const DEFAULT_CONTRACT_TEMPLATES: Array<{ name: string; type: ContractType; content: string }> = [
  {
    name: "PKWT standar",
    type: "pkwt",
    content: `# PERJANJIAN KERJA WAKTU TERTENTU
Nomor: {{nomor_kontrak}}

Pada tanggal {{tanggal_hari_ini}} di {{kota}}, yang bertanda tangan di bawah ini:

1. **{{penandatangan}}**, {{jabatan_penandatangan}}, bertindak untuk dan atas nama {{nama_perusahaan}}, beralamat di {{alamat_perusahaan}}, selanjutnya disebut **Pihak Pertama**.
2. **{{nama}}**, NIK {{nik}}, lahir di {{tempat_lahir}} pada {{tanggal_lahir}}, beralamat di {{alamat}}, selanjutnya disebut **Pihak Kedua**.

Kedua belah pihak sepakat mengikatkan diri dalam perjanjian kerja waktu tertentu dengan ketentuan sebagai berikut.

## Pasal 1 — Jabatan dan Penempatan
Pihak Kedua dipekerjakan sebagai {{jabatan}} pada divisi {{divisi}}, ditempatkan di {{cabang}}.

## Pasal 2 — Jangka Waktu
Perjanjian ini berlaku selama {{durasi}}, terhitung sejak {{tanggal_mulai}} sampai dengan {{tanggal_selesai}}.

## Pasal 3 — Upah
Pihak Kedua menerima gaji pokok sebesar {{gaji_pokok}} per bulan dan tunjangan tetap sebesar {{tunjangan}} per bulan, dibayarkan setiap akhir bulan.

## Pasal 4 — Waktu Kerja
Waktu kerja mengikuti jadwal yang ditetapkan Pihak Pertama sesuai peraturan perusahaan dan ketentuan perundang-undangan.

## Pasal 5 — Berakhirnya Perjanjian
Perjanjian berakhir pada tanggal yang disebut dalam Pasal 2, atau lebih awal sesuai ketentuan peraturan perusahaan dan perundang-undangan yang berlaku.

Demikian perjanjian ini dibuat dalam dua rangkap bermeterai cukup dan ditandatangani kedua belah pihak dalam keadaan sadar tanpa paksaan.`,
  },
  {
    name: "PKWTT (pengangkatan karyawan tetap)",
    type: "pkwtt",
    content: `# PERJANJIAN KERJA WAKTU TIDAK TERTENTU
Nomor: {{nomor_kontrak}}

Pada tanggal {{tanggal_hari_ini}} di {{kota}}, {{nama_perusahaan}} yang diwakili oleh **{{penandatangan}}** ({{jabatan_penandatangan}}) sebagai **Pihak Pertama**, dan **{{nama}}** (NIK {{nik}}) sebagai **Pihak Kedua**, sepakat bahwa:

## Pasal 1 — Pengangkatan
Terhitung sejak {{tanggal_mulai}}, Pihak Kedua diangkat sebagai karyawan tetap dengan jabatan {{jabatan}} pada divisi {{divisi}}, ditempatkan di {{cabang}}.

## Pasal 2 — Upah
Gaji pokok {{gaji_pokok}} per bulan dan tunjangan tetap {{tunjangan}} per bulan.

## Pasal 3 — Ketentuan Lain
Hak dan kewajiban lain mengikuti peraturan perusahaan dan peraturan perundang-undangan yang berlaku.`,
  },
  {
    name: "Perjanjian magang",
    type: "magang",
    content: `# PERJANJIAN PEMAGANGAN
Nomor: {{nomor_kontrak}}

{{nama_perusahaan}} sebagai **Penyelenggara** dan **{{nama}}** sebagai **Peserta Magang** sepakat melaksanakan pemagangan di bagian {{divisi}} ({{cabang}}) selama {{durasi}}, sejak {{tanggal_mulai}} sampai {{tanggal_selesai}}.

## Hak Peserta
- Bimbingan dari pembimbing yang ditunjuk
- Uang saku sebesar {{gaji_pokok}} per bulan
- Sertifikat setelah menyelesaikan program

## Kewajiban Peserta
- Mematuhi tata tertib perusahaan
- Menjaga kerahasiaan informasi perusahaan`,
  },
];

/** "1 tahun 3 bulan" between two WIB day keys (end inclusive). */
export function durationLabel(startKey: string, endKey?: string | null) {
  if (!endKey) return "tidak ditentukan";
  const [ys, ms, ds] = startKey.split("-").map(Number);
  const [ye, me, de] = endKey.split("-").map(Number);
  let months = (ye - ys) * 12 + (me - ms);
  if (de + 1 < ds) months -= 1;
  if (months < 1) {
    const days = Math.round((Date.UTC(ye, me - 1, de) - Date.UTC(ys, ms - 1, ds)) / 86_400_000) + 1;
    return `${days} hari`;
  }
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} tahun` : "", m ? `${m} bulan` : ""].filter(Boolean).join(" ") || "1 bulan";
}
