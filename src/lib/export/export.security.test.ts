import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { toCsv, type ExportTable } from "./table";
import { toXlsx } from "./xlsx";

const table: ExportTable = {
  sheet: "Uji: karyawan/2026",
  columns: [{ label: "Nama" }, { label: "Catatan" }, { label: "Nilai" }],
  rows: [
    ["Budi \"B\" Santoso", "=HYPERLINK(\"http://evil\")", -5],
    ["@SUM(A1)", "+62 812", 1234.5],
    ["Siti & <Rekan>", "baris\u0007kontrol", null],
  ],
};

test("CSV neutralises spreadsheet formulas but keeps real numbers", () => {
  const csv = toCsv(table);
  assert.equal(csv.charCodeAt(0), 0xfeff, "UTF-8 BOM for Excel");
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"")"`));
  assert.ok(csv.includes(`"'@SUM(A1)"`));
  assert.ok(csv.includes(`"'+62 812"`));
  assert.ok(csv.includes(",-5\r\n"), "numeric -5 is not treated as a formula");
  assert.ok(csv.includes(`"Budi ""B"" Santoso"`));
});

/** Reads the entries of a ZIP produced by `zip()` (deflate, no data descriptors). */
function unzip(buffer: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18), nameLength = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extra;
    files.set(name, inflateRawSync(buffer.subarray(start, start + size)).toString("utf8"));
    offset = start + size;
  }
  return files;
}

test("XLSX is a valid package with escaped inline strings and numeric cells", () => {
  const files = unzip(toXlsx(table));
  for (const part of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]) assert.ok(files.has(part), part);
  const sheet = files.get("xl/worksheets/sheet1.xml")!;
  assert.ok(sheet.includes("Siti &amp; &lt;Rekan&gt;"));
  assert.ok(sheet.includes("<v>-5</v>") && sheet.includes("<v>1234.5</v>"));
  assert.ok(!sheet.includes("\u0007"), "control characters are removed");
  assert.ok(!sheet.includes("<f>"), "no formula cells are ever written");
  assert.ok(files.get("xl/workbook.xml")!.includes('name="Uji  karyawan 2026"'), "sheet name stripped of forbidden characters");
});
