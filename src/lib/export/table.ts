/** A rectangular export: one sheet in Excel, one file in CSV. */
export interface ExportTable {
  sheet: string;
  columns: Array<{ label: string; width?: number }>;
  rows: Array<Array<string | number | null | undefined>>;
}

/**
 * Spreadsheet apps execute cells that start with = + - @ (and tab/CR tricks).
 * Text from employees (names, notes) is prefixed with an apostrophe so a value
 * such as `=HYPERLINK(...)` stays text. Real numbers are left alone.
 */
export function neutraliseFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function toCsv(table: ExportTable): string {
  const cell = (value: string | number | null | undefined) => {
    if (value == null) return '""';
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : '""';
    return `"${neutraliseFormula(value).replace(/"/g, '""')}"`;
  };
  const lines = [table.columns.map((c) => cell(c.label)).join(","), ...table.rows.map((row) => row.map(cell).join(","))];
  // BOM so Excel with an Indonesian locale detects UTF-8.
  return String.fromCharCode(0xfeff) + lines.join("\r\n") + "\r\n";
}
