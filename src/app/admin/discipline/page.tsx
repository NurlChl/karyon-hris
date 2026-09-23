"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, CardBody, Field, Input, Modal, PageHeader, Select, Textarea } from "@/components/ui";
import { Pagination } from "@/components/ui/Pagination";
import { api, errorMessage } from "@/lib/client-api";
import { DISCIPLINE_ACTIONS, DISCIPLINE_LABELS } from "@/lib/hr/discipline";
import { formatRupiah, wibDateKey } from "@/lib/time";
import type { DecisionEvidence } from "@/lib/hr/policy-evidence";
type Action = typeof DISCIPLINE_ACTIONS[number];
interface Case { _id: string; employeeId: { _id: string; name: string; employeeId: string } | null; title: string; description: string; category: string; evidence: string; employeeStatement: string; action: Action; status: string; revision: number; effectiveAt?: string; expiresAt?: string; snapshot?: DecisionEvidence; history: Array<{ at: string; status: string; note: string }> }
const statuses: Record<string, string> = { open: "Menunggu tinjauan", issued: "Keputusan diterbitkan", rejected: "Tidak ditindaklanjuti", closed: "Selesai" };
export default function DisciplinePage() {
  const [rows, setRows] = useState<Case[]>([]), [employees, setEmployees] = useState<Array<{ _id: string; name: string }>>([]);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1), [total, setTotal] = useState(0), [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Case | null>(null), [note, setNote] = useState(""), [action, setAction] = useState<Action>("coaching"), [confirmed, setConfirmed] = useState(false);
  const [effective, setEffective] = useState(wibDateKey()), [expires, setExpires] = useState("");
  const [access, setAccess] = useState({ write: false, approve: false });
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [draft, setDraft] = useState({ employeeId: "", title: "", description: "", evidence: "", employeeStatement: "", category: "misconduct", action: "coaching" as Action, occurredAt: wibDateKey() });
  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await api.get<Case[]>(`/api/v1/discipline?page=${page}&limit=25${filter ? `&status=${filter}` : ""}`); setRows(res.data ?? []); setTotal(res.meta?.total ?? 0); }
    catch (err) { setError(errorMessage(err)); } finally { setLoading(false); }
  }, [page, filter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api.get<typeof access>("/api/v1/discipline?view=access").then((res) => setAccess(res.data ?? { write: false, approve: false })).catch((err) => setError(errorMessage(err))); }, []);
  useEffect(() => {
    if (!access.write) return;
    let active = true;
    const timer = setTimeout(() => { api.get<typeof employees>(`/api/v1/discipline?view=employees&q=${encodeURIComponent(employeeQuery)}`).then((res) => { if (active) setEmployees(res.data ?? []); }).catch((err) => { if (active) setError(errorMessage(err)); }); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [access.write, employeeQuery]);
  async function inspect(row: Case) {
    setSelected(row); setAction(row.action); setNote(""); setConfirmed(false); setExpires(""); setEffective(wibDateKey()); setBusy(true); setError("");
    try {
      const res = await api.get<Case[]>(`/api/v1/discipline?id=${row._id}`);
      const fresh = res.data?.[0];
      if (!fresh) throw new Error("Kasus tidak lagi tersedia dalam lingkup akses Anda.");
      setSelected(fresh); setAction(fresh.action);
    } catch (err) { setError(errorMessage(err)); setSelected(null); } finally { setBusy(false); }
  }
  async function decide(status: "issued" | "rejected" | "closed") {
    if (!selected) return; setBusy(true); setError(""); setMessage("");
    try {
      const res = await api.patch("/api/v1/discipline", { id: selected._id, revision: selected.revision, status, action, note, confirmed,
        ...(status === "issued" ? { effectiveAt: `${effective}T00:00:00+07:00`, ...(expires ? { expiresAt: `${expires}T23:59:59+07:00` } : {}) } : {}),
      });
      setMessage(res.message ?? "Keputusan disimpan."); setSelected(null); await load();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return <div className="space-y-5">
    <PageHeader title="Disiplin & Status Akhir Kerja" description="Kasus ditautkan ke karyawan. Akses lihat, pencatatan, keputusan dan lingkup karyawan mengikuti Pengaturan → Peran & Hak Akses → Disiplin & SP." />
    <Alert tone="warning" title="Keputusan manusia, bukan sanksi otomatis">Verifikasi bukti dan klarifikasi karyawan sebelum menerbitkan keputusan. Resign bukan pelanggaran. Mencatat PHK/resign di sini tidak mengakhiri kontrak atau menonaktifkan akun; lakukan offboarding melalui master karyawan/kontrak setelah proses perusahaan selesai.</Alert>
    {error && <Alert tone="danger">{error}</Alert>}{message && <Alert tone="success">{message}</Alert>}
    {access.write && <Card><CardBody><details><summary className="cursor-pointer font-semibold text-primary">Catat kasus / pengunduran diri baru</summary>
      <form className="space-y-4 mt-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError("");
        try { await api.post("/api/v1/discipline", { ...draft, occurredAt: `${draft.occurredAt}T00:00:00+07:00` }); setMessage("Kasus baru disimpan untuk ditinjau."); setDraft({ ...draft, title: "", description: "", evidence: "", employeeStatement: "" }); await load(); }
        catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
      }}><fieldset disabled={busy} className="grid gap-4 md:grid-cols-2">
        <Field label="Cari karyawan dalam lingkup Anda" htmlFor="case-search"><Input id="case-search" value={employeeQuery} onChange={(e) => setEmployeeQuery(e.target.value)} placeholder="Nama / nomor karyawan (maks. 100 hasil)" /></Field>
        <Field label="Karyawan penerima tindakan (wajib)" htmlFor="case-employee"><Select id="case-employee" required value={draft.employeeId} onChange={(e) => setDraft({ ...draft, employeeId: e.target.value })}><option value="">Pilih karyawan</option>{employees.map((employee) => <option key={employee._id} value={employee._id}>{employee.name}</option>)}</Select></Field>
        <Field label="Kategori" htmlFor="case-category"><Select id="case-category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}><option value="misconduct">Pelanggaran</option><option value="fatal">Pelanggaran berat / fatal (perlu verifikasi)</option><option value="separation">Pengakhiran kerja / pengunduran diri</option></Select></Field>
        <Field label="Usulan tindakan" htmlFor="case-action"><Select id="case-action" value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value as Action })}>{DISCIPLINE_ACTIONS.map((key) => <option key={key} value={key}>{DISCIPLINE_LABELS[key]}</option>)}</Select></Field>
        <Field label="Tanggal kejadian" htmlFor="case-date"><Input id="case-date" type="date" required value={draft.occurredAt} onChange={(e) => setDraft({ ...draft, occurredAt: e.target.value })} /></Field>
        <Field label="Judul" htmlFor="case-title"><Input id="case-title" required minLength={5} maxLength={150} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
        <Field label="Kronologi" htmlFor="case-description"><Textarea id="case-description" required minLength={15} maxLength={5000} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
        <Field label="Referensi bukti / nomor dokumen" htmlFor="case-evidence"><Textarea id="case-evidence" maxLength={2000} value={draft.evidence} onChange={(e) => setDraft({ ...draft, evidence: e.target.value })} /></Field>
        <Field label="Klarifikasi karyawan" htmlFor="case-statement"><Textarea id="case-statement" maxLength={3000} value={draft.employeeStatement} onChange={(e) => setDraft({ ...draft, employeeStatement: e.target.value })} /></Field>
      </fieldset><Button type="submit" loading={busy}>Simpan untuk ditinjau</Button></form>
    </details></CardBody></Card>}
    <Field label="Filter status" htmlFor="case-filter"><Select id="case-filter" value={filter} onChange={(e) => { setPage(1); setFilter(e.target.value); }}><option value="">Semua status</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>
    {loading ? <p role="status">Memuat kasus…</p> : rows.length === 0 ? <p>Belum ada kasus untuk filter ini.</p> : rows.map((row) => <Card key={row._id}><CardBody><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-title-sm text-heading">{row.title}</h2><p>{row.employeeId?.name ?? "Karyawan tidak tersedia"} · {DISCIPLINE_LABELS[row.action]} · {statuses[row.status]}</p></div><Button type="button" variant="secondary" disabled={busy} onClick={() => void inspect(row)}>Lihat / tinjau</Button></div></CardBody></Card>)}
    <Pagination page={page} limit={25} total={total} totalPages={Math.ceil(total / 25)} onPage={setPage} />
    <Modal open={!!selected} onClose={() => { if (!busy) setSelected(null); }} title="Detail karyawan & tindakan" size="lg">{selected && <section className="space-y-4"><h2 className="text-title-sm">{selected.employeeId?.name} · {selected.employeeId?.employeeId}</h2><p>{selected.title} — {DISCIPLINE_LABELS[selected.action]} · {statuses[selected.status]}</p>{busy && <p role="status">Memproses data kasus…</p>}{error && <Alert tone="danger">{error}</Alert>}<p className="whitespace-pre-wrap">{selected.description}</p><p className="whitespace-pre-wrap">Bukti: {selected.evidence || "Belum dicatat"}</p><p className="whitespace-pre-wrap">Klarifikasi: {selected.employeeStatement || "Belum dicatat"}</p>
      {selected.snapshot && <Alert tone="info" title={`Bukti perhitungan payroll ${selected.snapshot.period}`}><p>Potongan sebelum batas: {formatRupiah(selected.snapshot.uncappedLate ?? 0)}. Batas bulanan: {formatRupiah(selected.snapshot.policy.latePenaltyCap)}. Potongan diterapkan: {formatRupiah(selected.snapshot.result.late)}.</p><p>Snapshot {new Date(selected.snapshot.capturedAt).toLocaleString("id-ID")}; bukan jaminan slip telah diterbitkan. Jika payroll dihitung ulang, cocokkan kembali bukti sebelum mengambil keputusan.</p></Alert>}
      <ul className="space-y-2">{selected.history.map((entry, i) => <li key={i}>{new Date(entry.at).toLocaleString("id-ID")} · {statuses[entry.status] ?? entry.status}: {entry.note}</li>)}</ul>
      {selected.effectiveAt && <p>Berlaku {new Date(selected.effectiveAt).toLocaleDateString("id-ID")} {selected.expiresAt ? `sampai ${new Date(selected.expiresAt).toLocaleDateString("id-ID")}` : "(tanpa tanggal akhir tercatat)"}</p>}
      {access.approve && ["open", "issued"].includes(selected.status) && <fieldset disabled={busy} className="space-y-3">
        <Field label="Tindakan yang diputuskan" htmlFor="decision-action"><Select id="decision-action" disabled={selected.status !== "open"} value={action} onChange={(e) => setAction(e.target.value as Action)}>{DISCIPLINE_ACTIONS.map((key) => <option key={key} value={key}>{DISCIPLINE_LABELS[key]}</option>)}</Select></Field>
        <Field label="Dasar keputusan / hasil klarifikasi (minimal 15 karakter)" htmlFor="decision-note"><Textarea id="decision-note" value={note} maxLength={3000} onChange={(e) => setNote(e.target.value)} /></Field>
        {selected.status === "open" && <div className="grid gap-3 sm:grid-cols-2"><Field label="Tanggal efektif" htmlFor="decision-date"><Input id="decision-date" type="date" value={effective} onChange={(e) => setEffective(e.target.value)} /></Field><Field label="Akhir berlaku (opsional)" htmlFor="decision-expires"><Input id="decision-expires" type="date" min={effective} value={expires} onChange={(e) => setExpires(e.target.value)} /></Field></div>}
        <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />Saya telah meninjau bukti dan mencatat dasar keputusan sesuai proses perusahaan.</label>
        <div className="flex flex-wrap gap-2">{selected.status === "open" ? <><Button disabled={!confirmed || note.trim().length < 15 || !effective} onClick={() => void decide("issued")}>Terbitkan keputusan</Button><Button variant="secondary" disabled={!confirmed || note.trim().length < 15} onClick={() => void decide("rejected")}>Tidak ditindaklanjuti</Button></> : <Button disabled={!confirmed || note.trim().length < 15} onClick={() => void decide("closed")}>Tandai selesai</Button>}</div>
      </fieldset>}
      {selected.employeeId && <Link className="text-primary underline" href={`/admin/discipline/employee/${selected.employeeId._id}`}>Buka detail dan seluruh riwayat tindakan karyawan ini</Link>}<Button variant="ghost" disabled={busy} onClick={() => setSelected(null)}>Tutup rincian</Button>
    </section>}</Modal>
  </div>;
}
