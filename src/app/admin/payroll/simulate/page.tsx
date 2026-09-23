"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, CardBody, Field, Input, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { formatRupiah, wibPeriodKey } from "@/lib/time";
import type { AttendanceFacts, AttendancePolicy, DecisionEvidence } from "@/lib/hr/policy-evidence";

interface Simulation {
  employee: { name: string; employeeId: string };
  snapshot: DecisionEvidence;
  proposedPolicy: AttendancePolicy;
  proposedFacts: AttendanceFacts;
  proposed: { late: number; absent: number; total: number };
  delta: number;
  warnings: string[];
}
type NumericPolicyKey = "latePerMinute" | "latePenaltyCap" | "absentPerDay";
const labels: Record<NumericPolicyKey, string> = {
  latePerMinute: "Nominal keterlambatan sesuai satuan (Rp)",
  latePenaltyCap: "Batas potongan terlambat / periode (Rp; 0 = tanpa batas)",
  absentPerDay: "Tarif alpha / hari (Rp)",
};

export default function PolicySimulationPage() {
  const [employees, setEmployees] = useState<Array<{ _id: string; name: string; employeeId: string }>>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [period, setPeriod] = useState(wibPeriodKey());
  const [policy, setPolicy] = useState<AttendancePolicy>({ latePerMinute: 0, latePenaltyCap: 0, absentPerDay: 0 });
  const [result, setResult] = useState<Simulation | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    // Dedicated payroll-authorized directory; no personal/financial fields.
    api.get<typeof employees>("/api/v1/payroll/simulate").then((res) => {
      if (active) setEmployees(res.data ?? []);
    }).catch((err) => { if (active) setError(errorMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return <div className="space-y-6">
    <PageHeader title="Ruang Uji Kebijakan" eyebrow="Payroll · simulasi" description="Bandingkan potongan presensi sebelum mengambil keputusan. Tidak mengubah pengaturan, presensi, atau slip gaji." />
    <Link className="text-primary underline" href="/admin/payroll">← Kembali ke payroll</Link>
    <Alert tone="info" title="Ruang simulasi, bukan penerbitan kebijakan">Uji tarif, satuan, batas potongan dan ambang keterlambatan menjadi alpha untuk satu karyawan per periode. Menit terlambat mengikuti catatan presensi, bukan menghitung ulang toleransi jadwal. Simulasi tidak membuka kasus sanksi. Persetujuan dan tanggal efektif kebijakan belum tersedia.</Alert>
    {error && <Alert tone="danger" title="Belum dapat diproses">{error}</Alert>}
    <Card><CardBody>
      <form className="space-y-4" onChange={() => setResult(null)} onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); setError(""); setResult(null);
        try {
          const res = await api.post<Simulation>("/api/v1/payroll/simulate", { employeeId, period, policy });
          setResult(res.data ?? null);
        } catch (err) { setError(errorMessage(err)); }
        finally { setBusy(false); }
      }}>
        <fieldset disabled={busy || loading} className="grid gap-4 sm:grid-cols-2">
          <Field label="Karyawan" htmlFor="simulation-employee" required>
            <select id="simulation-employee" required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="w-full rounded-lg border border-line bg-surface p-3 text-foreground">
              <option value="">{loading ? "Memuat karyawan…" : "Pilih karyawan"}</option>
              {employees.map((employee) => <option key={employee._id} value={employee._id}>{employee.name} · {employee.employeeId}</option>)}
            </select>
          </Field>
          <Field label="Periode sumber" htmlFor="simulation-period" required><Input id="simulation-period" type="month" min="2000-01" max={wibPeriodKey()} required value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
          <Field label="Satuan keterlambatan" htmlFor="late-unit"><select id="late-unit" className="w-full rounded-lg border border-line bg-surface p-3" value={policy.lateUnit ?? "minute"} onChange={(e) => setPolicy({ ...policy, lateUnit: e.target.value as AttendancePolicy["lateUnit"] })}><option value="minute">Per menit</option><option value="hour">Per jam (proporsional)</option><option value="day">Per hari terlambat</option></select></Field>
          <label className="flex items-center gap-2"><input type="checkbox" checked={policy.alphaEnabled ?? false} onChange={(e) => setPolicy({ ...policy, alphaEnabled: e.target.checked })} />Terlambat melewati ambang menjadi alpha</label>
          <Field label="Ambang alpha (lebih dari, jam)" htmlFor="alpha-hours"><Input id="alpha-hours" type="number" min={0.01} max={24} step="0.01" value={policy.alphaAfterHours ?? 4} onChange={(e) => setPolicy({ ...policy, alphaAfterHours: Number(e.target.value) })} /></Field>
          {(Object.keys(labels) as NumericPolicyKey[]).map((key) => <Field key={key} label={labels[key]} htmlFor={`simulation-${key}`} required><Input id={`simulation-${key}`} type="number" min={0} max={1e9} step="any" required value={policy[key]} onChange={(e) => setPolicy({ ...policy, [key]: Number(e.target.value) })} /></Field>)}
        </fieldset>
        <Button type="submit" loading={busy} disabled={loading || !employeeId}>Jalankan simulasi</Button>
        <p className="text-caption text-muted">Isi rancangan tarif Anda; nilai awal 0 bukan pengaturan perusahaan saat ini. Tarif saat ini ditampilkan pada hasil pembanding.</p>
      </form>
    </CardBody></Card>
    {result && <Card><CardBody><section className="space-y-4" aria-live="polite">
      <h2 className="text-title text-heading">{result.employee.name} · {result.snapshot.period}</h2>
      <p className="text-body-sm text-muted">Snapshot {new Date(result.snapshot.capturedAt).toLocaleString("id-ID")}. Pengaturan saat ini diterapkan pada data periode pilihan; bukan rekonstruksi kebijakan historis.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-body-sm"><caption className="sr-only">Perbandingan potongan presensi</caption><thead><tr><th className="p-2">Komponen</th><th className="p-2">Pengaturan saat ini</th><th className="p-2">Rancangan</th></tr></thead><tbody>
        {([ ["Keterlambatan", result.snapshot.result.late, result.proposed.late], ["Alpha", result.snapshot.result.absent, result.proposed.absent], ["Total potongan presensi", result.snapshot.result.total, result.proposed.total] ] as const).map(([label, before, after]) => <tr key={label} className="border-t border-line"><th className="p-2">{label}</th><td className="p-2">{formatRupiah(before)}</td><td className="p-2">{formatRupiah(after)}</td></tr>)}
      </tbody></table></div>
      <p className="text-body font-semibold">Selisih: {formatRupiah(result.delta)} ({result.delta > 0 ? "potongan bertambah" : result.delta < 0 ? "potongan berkurang" : "tidak berubah"}). Bukan selisih gaji bersih.</p>
      <p className="text-body-sm">Sumber: {result.snapshot.facts.lateMinutes} menit terlambat, {result.snapshot.facts.absentDays} hari alpha. Pengecualian terlambat: {result.snapshot.facts.exemptLate ? "ya" : "tidak"}; alpha: {result.snapshot.facts.exemptAbsent ? "ya" : "tidak"}.</p>
      <p className="text-body-sm">Setelah aturan rancangan: {result.proposedFacts.lateMinutes} menit pada {result.proposedFacts.lateDays ?? 0} hari terlambat, dan {result.proposedFacts.absentDays} hari alpha. Hari yang menjadi alpha tidak dikenai potongan keterlambatan lagi.</p>
      <details><summary className="cursor-pointer text-primary">Parameter pembanding dan sumber</summary>
        <p>Satuan: {result.snapshot.policy.lateUnit ?? "minute"} → {result.proposedPolicy.lateUnit ?? "minute"}. Alpha otomatis: {result.proposedPolicy.alphaEnabled ? `lebih dari ${result.proposedPolicy.alphaAfterHours} jam` : "nonaktif"}.</p>
        <ul className="space-y-1 text-body-sm mt-2">{(Object.keys(labels) as NumericPolicyKey[]).map((key) => <li key={key}>{labels[key]}: {formatRupiah(result.snapshot.policy[key])} → {formatRupiah(result.proposedPolicy[key])}</li>)}</ul>
        <p className="text-body-sm mt-2">Tanggal alpha: {result.snapshot.absentDates.join(", ") || "Tidak ada"}</p>
        <ul className="text-body-sm">{result.snapshot.attendance.map((row) => <li key={row.id}>{row.date}: {row.lateMinutes} menit terlambat</li>)}</ul>
      </details>
      <Alert tone="warning" title="Periksa sebelum mengambil keputusan"><ul className="list-disc pl-5">{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></Alert>
    </section></CardBody></Card>}
  </div>;
}
