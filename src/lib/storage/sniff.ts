/**
 * File type detection from content.
 *
 * The browser's `file.type` and the file name are both chosen by whoever sends
 * the request, so neither decides what gets stored. A file renamed from
 * `payload.html` to `cv.pdf` still starts with `<html>`, and that is what is
 * checked here. Only formats a person would legitimately attach to an HR
 * process are recognised; everything else is refused.
 */

export type SniffedKind = "pdf" | "jpeg" | "png" | "webp" | "docx" | "xlsx";

export interface Sniffed {
  kind: SniffedKind;
  mime: string;
  ext: string;
  label: string;
}

const TYPES: Record<SniffedKind, Omit<Sniffed, "kind">> = {
  pdf: { mime: "application/pdf", ext: ".pdf", label: "PDF" },
  jpeg: { mime: "image/jpeg", ext: ".jpg", label: "JPG" },
  png: { mime: "image/png", ext: ".png", label: "PNG" },
  webp: { mime: "image/webp", ext: ".webp", label: "WebP" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: ".docx",
    label: "Word (DOCX)",
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: ".xlsx",
    label: "Excel (XLSX)",
  },
};

function startsWith(buf: Buffer, bytes: number[], offset = 0) {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

/**
 * Office Open XML files are ZIP archives; the member names say which kind.
 * Macro-enabled variants (.docm, .xlsm) carry `vbaProject.bin` and are refused:
 * a document that runs code has no place in a job application or a leave form.
 */
function sniffOoxml(buf: Buffer): SniffedKind | null {
  // Only the local file headers near the start need reading; member names are
  // stored in plain text there.
  const head = buf.subarray(0, Math.min(buf.length, 64 * 1024)).toString("latin1");
  if (head.includes("vbaProject.bin")) return null;
  if (!head.includes("[Content_Types].xml")) return null;
  if (head.includes("word/")) return "docx";
  if (head.includes("xl/")) return "xlsx";
  return null;
}

export function sniffFile(buf: Buffer): Sniffed | null {
  let kind: SniffedKind | null = null;

  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) kind = "pdf"; // %PDF-
  else if (startsWith(buf, [0xff, 0xd8, 0xff])) kind = "jpeg";
  else if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) kind = "png";
  else if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) kind = "webp";
  else if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) kind = sniffOoxml(buf);

  return kind ? { kind, ...TYPES[kind] } : null;
}

export const KIND_LABEL: Record<SniffedKind, string> = Object.fromEntries(
  Object.entries(TYPES).map(([k, v]) => [k, v.label])
) as Record<SniffedKind, string>;
