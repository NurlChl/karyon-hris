"use client";

import React from "react";
import { formatDate, formatPeriod, formatRupiah } from "@/lib/time";
import { EMPLOYEE_FIELD_LABELS, type BlockType } from "@/lib/hr/payslip";

/**
 * Renders a payslip from a template definition plus one payroll record.
 *
 * The same component backs the live preview in the template builder and the
 * printable page, so what an administrator arranges is exactly what an employee
 * receives. Colours are literal hex rather than theme tokens: this markup is
 * printed, and the browser drops custom properties inconsistently when it
 * rasterises for PDF.
 */

export interface PayslipTemplateShape {
  paperSize: "A4" | "Letter";
  accentColor: string;
  baseFontSize: number;
  margin: number;
  companyName: string;
  companyAddress: string;
  documentTitle: string;
  /** Inlined as a data URL so printing never waits on a network fetch. */
  logoUrl?: string;
  showLogo?: boolean;
  /** Printed height in millimetres; width follows the image's own ratio. */
  logoHeight?: number;
  footerNote: string;
  employeeFields: string[];
  signatories: Array<{ label: string; name: string }>;
  blocks: Array<{ type: BlockType; enabled: boolean; title: string; options: Record<string, unknown> }>;
}

export interface PayslipData {
  period: string;
  employee: {
    employeeId: string;
    name: string;
    positionName: string;
    divisionName: string;
    branchName: string;
    joinDate: string;
    employmentStatus: string;
    taxStatus: string;
    bankName: string;
    bankAccount: string;
    npwp: string;
  };
  basicSalary: number;
  allowances: Array<{ name: string; amount: number }>;
  deductions: Array<{ name: string; amount: number }>;
  overtimeSalary: number;
  overtimeHours: number;
  totalEarnings: number;
  totalDeductions: number;
  netSalary: number;
  lateMinutes: number;
  absentDays: number;
  presentDays: number;
  workingDays: number;
  generatedAt?: string;
}

const INK = "#14142b";
const MUTED = "#545876";
const LINE = "#d9dce8";

export function PayslipDocument({
  template,
  data,
}: {
  template: PayslipTemplateShape;
  data: PayslipData;
}) {
  const accent = template.accentColor || "#4f46e5";
  const blocks = template.blocks.filter((b) => b.enabled);

  return (
    <div style={{ color: INK }}>
      {blocks.map((block, i) => (
        <Block key={`${block.type}-${i}`} block={block} template={template} data={data} accent={accent} />
      ))}
    </div>
  );
}

function Block({
  block,
  template,
  data,
  accent,
}: {
  block: PayslipTemplateShape["blocks"][number];
  template: PayslipTemplateShape;
  data: PayslipData;
  accent: string;
}) {
  switch (block.type) {
    case "header":
      return (
        <header
          className="avoid-break"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 24,
            borderBottom: `2px solid ${accent}`,
            paddingBottom: 14,
            marginBottom: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, minWidth: 0 }}>
            {template.showLogo && template.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={template.logoUrl}
                alt=""
                style={{
                  height: `${template.logoHeight ?? 14}mm`,
                  width: "auto",
                  maxWidth: "45mm",
                  objectFit: "contain",
                  // Chrome drops background images from a print job unless the
                  // user ticks "Background graphics"; a real <img> is always
                  // printed, which is why the logo is not a CSS background.
                  flexShrink: 0,
                }}
              />
            )}
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: "1.5em", fontWeight: 600, letterSpacing: "-0.01em" }}>
                {block.title || template.documentTitle || "SLIP GAJI KARYAWAN"}
              </h1>
              <p style={{ margin: "6px 0 0", color: MUTED, fontSize: "0.95em" }}>
                Periode {formatPeriod(data.period)}
              </p>
            </div>
          </div>
          <div style={{ textAlign: "right", maxWidth: "45%" }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{template.companyName || "—"}</p>
            {template.companyAddress && (
              <p style={{ margin: "4px 0 0", color: MUTED, fontSize: "0.9em", lineHeight: 1.5 }}>
                {template.companyAddress}
              </p>
            )}
          </div>
        </header>
      );

    case "employee_info": {
      const columns = Number(block.options?.columns) === 1 ? 1 : 2;
      const fields = template.employeeFields.filter(
        (f) => data.employee[f as keyof PayslipData["employee"]]
      );
      if (!fields.length) return null;
      return (
        <section className="avoid-break" style={{ marginBottom: 22 }}>
          {block.title && <SectionTitle accent={accent}>{block.title}</SectionTitle>}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap: "8px 28px",
            }}
          >
            {fields.map((field) => (
              <div key={field} style={{ display: "flex", gap: 8, fontSize: "0.95em" }}>
                <span style={{ color: MUTED, minWidth: 108 }}>
                  {EMPLOYEE_FIELD_LABELS[field] ?? field}
                </span>
                <span style={{ fontWeight: 500 }}>
                  {formatEmployeeField(field, data.employee[field as keyof PayslipData["employee"]])}
                </span>
              </div>
            ))}
          </div>
        </section>
      );
    }

    case "earnings": {
      const showZero = Boolean(block.options?.showZero);
      const rows: Array<{ name: string; amount: number }> = [
        { name: "Gaji Pokok", amount: data.basicSalary },
        ...data.allowances,
      ];
      if (data.overtimeSalary > 0 || showZero) {
        rows.push({
          name: `Lembur${data.overtimeHours ? ` (${data.overtimeHours} jam)` : ""}`,
          amount: data.overtimeSalary,
        });
      }
      return (
        <MoneyTable
          title={block.title || "Penghasilan"}
          accent={accent}
          rows={showZero ? rows : rows.filter((r) => r.amount !== 0)}
          totalLabel="Total Penghasilan"
          total={data.totalEarnings}
          emptyText="Tidak ada komponen penghasilan pada periode ini."
        />
      );
    }

    case "deductions": {
      const showZero = Boolean(block.options?.showZero);
      const rows = showZero ? data.deductions : data.deductions.filter((d) => d.amount !== 0);
      return (
        <MoneyTable
          title={block.title || "Potongan"}
          accent={accent}
          rows={rows}
          totalLabel="Total Potongan"
          total={data.totalDeductions}
          emptyText="Tidak ada potongan pada periode ini."
        />
      );
    }

    case "net_salary":
      return (
        <section
          className="avoid-break"
          style={{
            marginBottom: 22,
            padding: "14px 18px",
            borderRadius: 8,
            background: hexToSoft(accent),
            border: `1px solid ${hexToBorder(accent)}`,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
            <span style={{ fontWeight: 600, letterSpacing: "0.02em", fontSize: "0.95em" }}>
              {block.title || "GAJI BERSIH DITERIMA"}
            </span>
            <span style={{ fontWeight: 600, fontSize: "1.35em", color: accent }}>
              {formatRupiah(data.netSalary)}
            </span>
          </div>
          {Boolean(block.options?.showTerbilang) && (
            <p style={{ margin: "8px 0 0", color: MUTED, fontSize: "0.85em", fontStyle: "italic" }}>
              Terbilang: {terbilang(data.netSalary)} rupiah
            </p>
          )}
        </section>
      );

    case "attendance":
      return (
        <section className="avoid-break" style={{ marginBottom: 22 }}>
          <SectionTitle accent={accent}>{block.title || "Ringkasan Kehadiran"}</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
            <Stat label="Hari kerja" value={String(data.workingDays)} />
            <Stat label="Hadir" value={String(data.presentDays)} />
            <Stat label="Terlambat" value={`${data.lateMinutes} mnt`} />
            <Stat label="Alpha" value={`${data.absentDays} hari`} />
          </div>
        </section>
      );

    case "note":
      return (
        <section
          className="avoid-break"
          style={{
            marginTop: 24,
            paddingTop: 12,
            borderTop: `1px solid ${LINE}`,
            color: MUTED,
            fontSize: "0.82em",
            lineHeight: 1.65,
          }}
        >
          {block.title && <p style={{ margin: "0 0 4px", fontWeight: 600, color: INK }}>{block.title}</p>}
          {template.footerNote}
        </section>
      );

    case "signature": {
      const signatories = template.signatories.filter((s) => s.label);
      if (!signatories.length) return null;
      return (
        <section
          className="avoid-break"
          style={{
            marginTop: 32,
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(signatories.length, 3)}, minmax(0,1fr))`,
            gap: 24,
          }}
        >
          {signatories.map((s, i) => (
            <div key={i} style={{ textAlign: "center" }}>
              <p style={{ margin: 0, color: MUTED, fontSize: "0.88em" }}>{s.label}</p>
              {/* Fixed gap so every slip leaves the same room for a wet signature. */}
              <div style={{ height: 56 }} />
              <p
                style={{
                  margin: 0,
                  borderTop: `1px solid ${LINE}`,
                  paddingTop: 6,
                  fontWeight: 500,
                  fontSize: "0.9em",
                }}
              >
                {s.name || " "}
              </p>
            </div>
          ))}
        </section>
      );
    }

    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */

function SectionTitle({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <h2
      style={{
        margin: "0 0 10px",
        fontSize: "0.78em",
        fontWeight: 600,
        letterSpacing: "0.09em",
        textTransform: "uppercase",
        color: accent,
      }}
    >
      {children}
    </h2>
  );
}

function MoneyTable({
  title,
  accent,
  rows,
  totalLabel,
  total,
  emptyText,
}: {
  title: string;
  accent: string;
  rows: Array<{ name: string; amount: number }>;
  totalLabel: string;
  total: number;
  emptyText: string;
}) {
  return (
    <section style={{ marginBottom: 22 }}>
      <SectionTitle accent={accent}>{title}</SectionTitle>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td style={{ padding: "6px 0", color: MUTED, fontSize: "0.92em" }}>{emptyText}</td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={`${r.name}-${i}`}>
                <td style={{ padding: "6px 0", borderBottom: `1px solid ${LINE}` }}>{r.name}</td>
                <td
                  style={{
                    padding: "6px 0",
                    borderBottom: `1px solid ${LINE}`,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatRupiah(r.amount)}
                </td>
              </tr>
            ))
          )}
          <tr>
            <td style={{ padding: "8px 0 0", fontWeight: 600 }}>{totalLabel}</td>
            <td
              style={{
                padding: "8px 0 0",
                fontWeight: 600,
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {formatRupiah(total)}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 6, padding: "8px 10px" }}>
      <p style={{ margin: 0, color: MUTED, fontSize: "0.78em" }}>{label}</p>
      <p style={{ margin: "2px 0 0", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</p>
    </div>
  );
}

function formatEmployeeField(field: string, value: string): string {
  if (!value) return "—";
  if (field === "joinDate") return formatDate(value);
  return value;
}

/** Softens the accent to roughly 8% for the net-salary panel. */
function hexToSoft(hex: string): string {
  const { r, g, b } = parseHex(hex);
  return `rgb(${Math.round(r + (255 - r) * 0.92)}, ${Math.round(g + (255 - g) * 0.92)}, ${Math.round(
    b + (255 - b) * 0.92
  )})`;
}

function hexToBorder(hex: string): string {
  const { r, g, b } = parseHex(hex);
  return `rgb(${Math.round(r + (255 - r) * 0.72)}, ${Math.round(g + (255 - g) * 0.72)}, ${Math.round(
    b + (255 - b) * 0.72
  )})`;
}

function parseHex(hex: string) {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  };
}

const UNITS = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan"];

/**
 * Indonesian number-to-words, used for the "terbilang" line that payslips and
 * receipts conventionally carry.
 */
export function terbilang(n: number): string {
  const value = Math.floor(Math.abs(n));
  if (value === 0) return "nol";

  const say = (num: number): string => {
    if (num < 10) return UNITS[num];
    // 11 is "sebelas", not "satu belas" — the only irregular teen.
    if (num === 10) return "sepuluh";
    if (num === 11) return "sebelas";
    if (num < 20) return `${UNITS[num - 10]} belas`;
    if (num < 100) {
      const tens = Math.floor(num / 10);
      const rest = num % 10;
      return `${UNITS[tens]} puluh${rest ? ` ${UNITS[rest]}` : ""}`;
    }
    if (num < 200) return `seratus${num % 100 ? ` ${say(num % 100)}` : ""}`;
    if (num < 1000) {
      const hundreds = Math.floor(num / 100);
      const rest = num % 100;
      return `${UNITS[hundreds]} ratus${rest ? ` ${say(rest)}` : ""}`;
    }
    if (num < 2000) return `seribu${num % 1000 ? ` ${say(num % 1000)}` : ""}`;
    if (num < 1_000_000) {
      const thousands = Math.floor(num / 1000);
      const rest = num % 1000;
      return `${say(thousands)} ribu${rest ? ` ${say(rest)}` : ""}`;
    }
    if (num < 1_000_000_000) {
      const millions = Math.floor(num / 1_000_000);
      const rest = num % 1_000_000;
      return `${say(millions)} juta${rest ? ` ${say(rest)}` : ""}`;
    }
    const billions = Math.floor(num / 1_000_000_000);
    const rest = num % 1_000_000_000;
    return `${say(billions)} miliar${rest ? ` ${say(rest)}` : ""}`;
  };

  const words = say(value).replace(/\s+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
