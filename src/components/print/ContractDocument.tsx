"use client";

import React from "react";
import { fillPlaceholders, inlineRuns, parseContract } from "@/lib/hr/contracts";

const INK = "#14142b";
const MUTED = "#545876";
const LINE = "#d9dce8";

/**
 * A contract as it prints: letterhead, the template text with placeholders
 * filled, and a two-party signature block with room for a revenue stamp.
 */
export function ContractDocument({
  content,
  values,
  branding,
}: {
  content: string;
  values: Record<string, string>;
  branding: {
    companyName: string;
    companyAddress: string;
    showLogo: boolean;
    logoUrl: string;
    logoHeight: number;
    signerName: string;
    signerTitle: string;
  };
}) {
  const blocks = parseContract(fillPlaceholders(content, values));

  const runs = (text: string) =>
    inlineRuns(text).map((r, i) =>
      r.bold ? (
        <strong key={i} style={{ fontWeight: 700 }}>
          {r.text}
        </strong>
      ) : (
        <React.Fragment key={i}>{r.text}</React.Fragment>
      )
    );

  return (
    <div style={{ color: INK, fontFamily: "'Times New Roman', Georgia, serif", fontSize: "11.5pt", lineHeight: 1.6 }}>
      <header
        style={{ display: "flex", alignItems: "center", gap: "4mm", paddingBottom: "4mm", borderBottom: `2px solid ${INK}`, marginBottom: "7mm" }}
      >
        {branding.showLogo && branding.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={branding.logoUrl} alt="" style={{ height: `${branding.logoHeight}mm`, width: "auto", objectFit: "contain" }} />
        )}
        <div style={{ flex: 1, textAlign: branding.showLogo && branding.logoUrl ? "left" : "center" }}>
          <div style={{ fontSize: "14pt", fontWeight: 700, letterSpacing: "0.02em" }}>{branding.companyName}</div>
          {branding.companyAddress && branding.companyAddress !== "-" && (
            <div style={{ fontSize: "9.5pt", color: MUTED }}>{branding.companyAddress}</div>
          )}
        </div>
      </header>

      {blocks.map((b, i) => {
        switch (b.type) {
          case "title":
            return (
              <h1 key={i} style={{ textAlign: "center", fontSize: "13.5pt", fontWeight: 700, margin: i ? "6mm 0 1mm" : "0 0 1mm", textTransform: "uppercase" }}>
                {runs(b.text)}
              </h1>
            );
          case "heading":
            return (
              <h2 key={i} className="avoid-break" style={{ fontSize: "11.5pt", fontWeight: 700, margin: "5mm 0 1.5mm", textAlign: "center" }}>
                {runs(b.text)}
              </h2>
            );
          case "bullets":
            return (
              <ul key={i} style={{ margin: "1.5mm 0 2.5mm", paddingLeft: "7mm", listStyle: "disc" }}>
                {b.items.map((item, j) => (
                  <li key={j} style={{ marginBottom: "1mm" }}>
                    {runs(item)}
                  </li>
                ))}
              </ul>
            );
          case "numbered":
            return (
              <ol key={i} style={{ margin: "1.5mm 0 2.5mm", paddingLeft: "7mm", listStyle: "decimal" }}>
                {b.items.map((item, j) => (
                  <li key={j} style={{ marginBottom: "1.2mm", textAlign: "justify" }}>
                    {runs(item)}
                  </li>
                ))}
              </ol>
            );
          default: {
            const centred = /^nomor\s*:/i.test(b.text);
            return (
              <p key={i} style={{ margin: "0 0 2.5mm", textAlign: centred ? "center" : "justify" }}>
                {runs(b.text)}
              </p>
            );
          }
        }
      })}

      <section className="avoid-break" style={{ marginTop: "10mm" }}>
        <p style={{ textAlign: "right", margin: "0 0 4mm" }}>
          {values.kota ? `${values.kota}, ` : ""}
          {values.tanggal_hari_ini}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12mm", textAlign: "center" }}>
          <div>
            <div style={{ fontWeight: 700 }}>Pihak Pertama</div>
            <div style={{ fontSize: "10pt", color: MUTED }}>{branding.companyName}</div>
            <div style={{ height: "24mm" }} />
            <div style={{ borderTop: `1px solid ${INK}`, paddingTop: "1mm", fontWeight: 700 }}>
              {branding.signerName || "(.................................)"}
            </div>
            {branding.signerTitle && <div style={{ fontSize: "10pt", color: MUTED }}>{branding.signerTitle}</div>}
          </div>
          <div>
            <div style={{ fontWeight: 700 }}>Pihak Kedua</div>
            <div style={{ fontSize: "10pt", color: MUTED }}>Karyawan</div>
            <div style={{ height: "24mm", position: "relative" }}>
              <span
                style={{
                  position: "absolute",
                  left: "4mm",
                  top: "4mm",
                  width: "22mm",
                  height: "16mm",
                  border: `1px dashed ${LINE}`,
                  fontSize: "7pt",
                  color: MUTED,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                Meterai
              </span>
            </div>
            <div style={{ borderTop: `1px solid ${INK}`, paddingTop: "1mm", fontWeight: 700 }}>{values.nama || "(.................................)"}</div>
            {values.nip && <div style={{ fontSize: "10pt", color: MUTED }}>NIP {values.nip}</div>}
          </div>
        </div>
      </section>
    </div>
  );
}
