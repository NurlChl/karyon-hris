/**
 * RFC 4180 CSV reader for imports. Accepts comma or semicolon delimiters
 * (Excel with an Indonesian locale saves with `;`), quoted fields, CRLF and a
 * UTF-8 BOM. Limits keep a hostile file from exhausting memory.
 */

export const MAX_IMPORT_BYTES = 1_000_000;
export const MAX_IMPORT_ROWS = 5_000;

export class CsvError extends Error {}

export function parseCsv(input: string): { headers: string[]; rows: Array<{ line: number; values: string[] }> } {
  if (input.length > MAX_IMPORT_BYTES) throw new CsvError("Berkas CSV melebihi 1 MB. Pecah menjadi beberapa berkas.");
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const records: Array<{ line: number; values: string[] }> = [];
  let field = "", row: string[] = [], quoted = false, line = 1, rowLine = 1;
  const pushRow = () => {
    row.push(field);
    if (row.some((v) => v.trim() !== "")) records.push({ line: rowLine, values: row });
    row = []; field = "";
    if (records.length > MAX_IMPORT_ROWS + 1) throw new CsvError(`Maksimal ${MAX_IMPORT_ROWS} baris per impor.`);
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else { if (c === "\n") line++; field += c; }
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\r" && text[i + 1] === "\n") continue;
    else if (c === "\n" || c === "\r") { pushRow(); line++; rowLine = line; }
    else field += c;
  }
  if (quoted) throw new CsvError("Tanda kutip tidak ditutup. Periksa kembali berkas CSV.");
  if (field !== "" || row.length) pushRow();
  if (!records.length) throw new CsvError("Berkas CSV kosong.");
  const [header, ...rows] = records;
  return { headers: header.values.map((h) => h.trim()), rows };
}

/**
 * Undoes the apostrophe our exports add in front of formula-like text, then
 * trims. Anything else is kept verbatim.
 */
export function cleanCell(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return /^'[=+\-@]/.test(trimmed) ? trimmed.slice(1) : trimmed;
}

const normalise = (label: string) => label.toLowerCase().replace(/\*/g, "").replace(/\s+/g, " ").trim();

/** Maps the file's header labels to field keys; unknown columns are ignored. */
export function mapHeaders(headers: string[], fields: Array<{ key: string; label: string; aliases?: string[] }>) {
  const index = new Map<string, number>();
  headers.forEach((header, i) => {
    const h = normalise(header);
    const field = fields.find((f) => normalise(f.label) === h || normalise(f.key) === h || f.aliases?.some((a) => normalise(a) === h));
    if (field && !index.has(field.key)) index.set(field.key, i);
  });
  return index;
}

/** `YYYY-MM-DD`, `DD/MM/YYYY` or `DD-MM-YYYY` → `YYYY-MM-DD`; null when invalid. */
export function parseDateCell(value: string): string | null {
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (local) [d, m, y] = [Number(local[1]), Number(local[2]), Number(local[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || y < 1900 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function toCsvTemplate(fields: Array<{ label: string; required?: boolean }>, example: string[]): string {
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return String.fromCharCode(0xfeff) + [fields.map((f) => cell(f.required ? `${f.label}*` : f.label)).join(","), example.map(cell).join(",")].join("\r\n") + "\r\n";
}
