"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ErrorState, SkeletonList } from "@/components/ui";
import { Paper, PrintShell } from "@/components/print/PrintShell";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate, formatDateTime } from "@/lib/time";
import { RECOMMENDATION_LABELS, SCORE_MODE_MAX } from "@/lib/hr/kpi";

interface Score {
  aspectKey: string;
  aspectName: string;
  aspectWeight: number;
  indicatorKey: string;
  indicatorName: string;
  indicatorWeight: number;
  rawScore: number;
  score: number;
  note: string;
}

interface Evaluation {
  _id: string;
  period: string;
  periodType: string;
  scoreMode: string;
  scores: Score[];
  finalScore: number;
  gradeLabel: string;
  strengths: string;
  improvements: string;
  developmentPlan: string;
  recommendation: string;
  notes: string;
  employeeComment: string;
  status: string;
  submittedAt?: string | null;
  acknowledgedAt?: string | null;
  finalizedAt?: string | null;
  branding?: {
    companyName: string;
    companyAddress: string;
    showLogo: boolean;
    logoUrl: string;
    logoHeight: number;
  };
  employeeId: {
    name: string;
    employeeId: string;
    divisionId?: { name: string } | null;
    positionId?: { name: string } | null;
    branchId?: { name: string } | null;
  } | null;
  templateId: { name: string; description?: string } | null;
}

const INK = "#14142b";
const MUTED = "#545876";
const LINE = "#d9dce8";
const ACCENT = "#4f46e5";

export default function KpiPrintPage() {
  return (
    <Suspense fallback={<div className="p-8 max-w-3xl mx-auto"><SkeletonList rows={3} /></div>}>
      <KpiPrint />
    </Suspense>
  );
}

function KpiPrint() {
  const params = useParams<{ id: string }>();
  const autoPrint = useSearchParams().get("print") === "1";

  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<Evaluation>(`/api/v1/kpi/evaluations?id=${params.id}`);
      setEvaluation(res.data ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <SkeletonList rows={3} />
      </div>
    );
  }

  if (error || !evaluation) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <ErrorState message={error || "Dokumen tidak tersedia."} onRetry={load} />
      </div>
    );
  }

  const emp = evaluation.employeeId;
  const max = SCORE_MODE_MAX[evaluation.scoreMode as keyof typeof SCORE_MODE_MAX] ?? 5;

  // Scores arrive flat; the document groups them back into the aspects the
  // template defined, which is how an appraisal form is meant to read.
  const aspects = groupByAspect(evaluation.scores);

  return (
    <PrintShell
      backHref="/portal/kpi"
      backLabel="Kembali ke penilaian"
      title={`Penilaian kinerja ${evaluation.period}`}
      subtitle={emp ? `${emp.name} · ${emp.employeeId}` : undefined}
      autoPrint={autoPrint}
    >
      <Paper size="A4" margin={18} fontSize={12}>
        <div style={{ color: INK }}>
          {/* ---------- header ---------- */}
          <header
            className="avoid-break"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 24,
              borderBottom: `2px solid ${ACCENT}`,
              paddingBottom: 14,
              marginBottom: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, minWidth: 0 }}>
              {evaluation.branding?.showLogo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={evaluation.branding.logoUrl}
                  alt=""
                  style={{
                    height: `${evaluation.branding.logoHeight}mm`,
                    width: "auto",
                    maxWidth: "45mm",
                    objectFit: "contain",
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ minWidth: 0 }}>
                <h1 style={{ margin: 0, fontSize: "1.5em", fontWeight: 600, letterSpacing: "-0.01em" }}>
                  FORMULIR PENILAIAN KINERJA
                </h1>
                <p style={{ margin: "6px 0 0", color: MUTED, fontSize: "0.95em" }}>
                  {evaluation.templateId?.name ?? "Template dihapus"} · Periode {evaluation.period}
                </p>
              </div>
            </div>
            {evaluation.branding?.companyName && (
              <div style={{ textAlign: "right", maxWidth: "45%" }}>
                <p style={{ margin: 0, fontWeight: 600 }}>{evaluation.branding.companyName}</p>
                {evaluation.branding.companyAddress && evaluation.branding.companyAddress !== "-" && (
                  <p style={{ margin: "4px 0 0", color: MUTED, fontSize: "0.9em", lineHeight: 1.5 }}>
                    {evaluation.branding.companyAddress}
                  </p>
                )}
              </div>
            )}
          </header>

          {/* ---------- identity ---------- */}
          <section className="avoid-break" style={{ marginBottom: 20 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0,1fr))",
                gap: "8px 28px",
                fontSize: "0.95em",
              }}
            >
              <Row label="Nama" value={emp?.name ?? "—"} />
              <Row label="NIP" value={emp?.employeeId ?? "—"} />
              <Row label="Jabatan" value={emp?.positionId?.name ?? "—"} />
              <Row label="Divisi" value={emp?.divisionId?.name ?? "—"} />
              <Row label="Cabang" value={emp?.branchId?.name ?? "—"} />
              <Row label="Skala nilai" value={`1 – ${max}`} />
            </div>
          </section>

          {/* ---------- score summary ---------- */}
          <section
            className="avoid-break"
            style={{
              marginBottom: 22,
              padding: "14px 18px",
              borderRadius: 8,
              background: "#eeedfe",
              border: "1px solid #cfcbfa",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div>
              <p style={{ margin: 0, fontSize: "0.8em", letterSpacing: "0.08em", color: MUTED }}>
                NILAI AKHIR
              </p>
              <p style={{ margin: "2px 0 0", fontSize: "1.9em", fontWeight: 600, color: ACCENT }}>
                {evaluation.finalScore.toFixed(2)}
                <span style={{ fontSize: "0.45em", color: MUTED, fontWeight: 400 }}> / 100</span>
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: "0.8em", letterSpacing: "0.08em", color: MUTED }}>
                PREDIKAT
              </p>
              <p style={{ margin: "2px 0 0", fontSize: "1.25em", fontWeight: 600 }}>
                {evaluation.gradeLabel || "—"}
              </p>
            </div>
          </section>

          {/* ---------- score tables ---------- */}
          {aspects.map((aspect) => (
            <section key={aspect.key} style={{ marginBottom: 18 }}>
              <h2
                style={{
                  margin: "0 0 8px",
                  fontSize: "0.85em",
                  fontWeight: 600,
                  color: ACCENT,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>{aspect.name}</span>
                <span style={{ color: MUTED, fontWeight: 500 }}>Bobot {aspect.weight}%</span>
              </h2>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.92em" }}>
                <thead>
                  <tr>
                    <Th style={{ width: "46%" }}>Indikator</Th>
                    <Th style={{ width: "10%", textAlign: "right" }}>Bobot</Th>
                    <Th style={{ width: "12%", textAlign: "right" }}>Nilai</Th>
                    <Th>Catatan</Th>
                  </tr>
                </thead>
                <tbody>
                  {aspect.items.map((s) => (
                    <tr key={s.indicatorKey}>
                      <Td>{s.indicatorName}</Td>
                      <Td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {s.indicatorWeight}%
                      </Td>
                      <Td
                        style={{
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          fontWeight: 600,
                        }}
                      >
                        {s.rawScore} / {max}
                      </Td>
                      <Td style={{ color: MUTED }}>{s.note || "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}

          {/* ---------- narrative ---------- */}
          <section className="avoid-break" style={{ marginTop: 22 }}>
            <Narrative title="Kekuatan" body={evaluation.strengths} />
            <Narrative title="Hal yang perlu ditingkatkan" body={evaluation.improvements} />
            <Narrative title="Rencana pengembangan" body={evaluation.developmentPlan} />
            <Narrative
              title="Rekomendasi"
              body={RECOMMENDATION_LABELS[evaluation.recommendation] ?? "—"}
            />
            {evaluation.notes && <Narrative title="Catatan penilai" body={evaluation.notes} />}
            {evaluation.employeeComment && (
              <Narrative title="Tanggapan karyawan" body={evaluation.employeeComment} />
            )}
          </section>

          {/* ---------- signatures ---------- */}
          <section
            className="avoid-break"
            style={{
              marginTop: 30,
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0,1fr))",
              gap: 24,
            }}
          >
            {[
              { label: "Karyawan", name: emp?.name ?? "", at: evaluation.acknowledgedAt },
              { label: "Atasan penilai", name: "", at: evaluation.submittedAt },
              { label: "HRD", name: "", at: evaluation.finalizedAt },
            ].map((s) => (
              <div key={s.label} style={{ textAlign: "center" }}>
                <p style={{ margin: 0, color: MUTED, fontSize: "0.85em" }}>{s.label}</p>
                <div style={{ height: 52 }} />
                <p
                  style={{
                    margin: 0,
                    borderTop: `1px solid ${LINE}`,
                    paddingTop: 6,
                    fontWeight: 500,
                    fontSize: "0.88em",
                  }}
                >
                  {s.name || " "}
                </p>
                <p style={{ margin: "2px 0 0", color: MUTED, fontSize: "0.75em" }}>
                  {s.at ? formatDate(s.at) : "—"}
                </p>
              </div>
            ))}
          </section>

          <footer
            style={{
              marginTop: 24,
              paddingTop: 10,
              borderTop: `1px solid ${LINE}`,
              color: MUTED,
              fontSize: "0.78em",
              lineHeight: 1.6,
            }}
          >
            Dokumen ini dihasilkan otomatis oleh sistem HRIS.
            {evaluation.status === "finalized"
              ? ` Difinalkan pada ${formatDateTime(evaluation.finalizedAt)} dan tidak dapat diubah lagi.`
              : " Status dokumen belum final, isinya masih dapat berubah."}
          </footer>
        </div>
      </Paper>
    </PrintShell>
  );
}

/* ------------------------------------------------------------------ */

function groupByAspect(scores: Score[]) {
  const map = new Map<string, { key: string; name: string; weight: number; items: Score[] }>();
  for (const s of scores) {
    const entry = map.get(s.aspectKey) ?? {
      key: s.aspectKey,
      name: s.aspectName,
      weight: s.aspectWeight,
      items: [],
    };
    entry.items.push(s);
    map.set(s.aspectKey, entry);
  }
  return [...map.values()];
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <span style={{ color: MUTED, minWidth: 92 }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "6px 8px",
        background: "#f1f2f8",
        borderBottom: `1px solid ${LINE}`,
        fontWeight: 600,
        fontSize: "0.88em",
        color: MUTED,
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <td style={{ padding: "6px 8px", borderBottom: `1px solid ${LINE}`, verticalAlign: "top", ...style }}>
      {children}
    </td>
  );
}

function Narrative({ title, body }: { title: string; body: string }) {
  if (!body) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <h3 style={{ margin: "0 0 4px", fontSize: "0.85em", fontWeight: 600 }}>{title}</h3>
      <p style={{ margin: 0, color: MUTED, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{body}</p>
    </div>
  );
}
