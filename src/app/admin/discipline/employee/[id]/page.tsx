"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Card, CardBody, PageHeader } from "@/components/ui";
import { Pagination } from "@/components/ui/Pagination";
import { api, errorMessage } from "@/lib/client-api";
import { DISCIPLINE_LABELS } from "@/lib/hr/discipline";

interface EmployeeDetail { name: string; employeeId: string; status: string; branchId?: { name: string }; divisionId?: { name: string }; positionId?: { name: string }; supervisorId?: { name: string } }
interface Case { _id: string; title: string; action: keyof typeof DISCIPLINE_LABELS; status: string; description: string; evidence: string; employeeStatement: string; effectiveAt?: string; history: Array<{ at: string; note: string; status: string }> }
export default function EmployeeDisciplineDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [rows, setRows] = useState<Case[]>([]), [error, setError] = useState("");
  const [page, setPage] = useState(1), [total, setTotal] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([api.get<EmployeeDetail>(`/api/v1/discipline/employees/${id}`), api.get<Case[]>(`/api/v1/discipline?employeeId=${id}&page=${page}&limit=25`)])
      .then(([profile, cases]) => { if (active) { setEmployee(profile.data ?? null); setRows(cases.data ?? []); setTotal(cases.meta?.total ?? 0); setError(""); } })
      .catch((err) => { if (active) { setEmployee(null); setRows([]); setError(errorMessage(err)); } });
    return () => { active = false; };
  }, [id, page]);
  return <div className="space-y-5"><PageHeader title={employee?.name ?? "Detail tindakan karyawan"} description="Profil kepegawaian dan riwayat kasus sesuai lingkup izin Disiplin & SP." />
    <Link className="text-primary underline" href="/admin/discipline">← Daftar kasus / tinjau keputusan</Link>
    {error && <Alert tone="danger">{error}</Alert>}
    {employee && <Card><CardBody><p>Nomor: {employee.employeeId} · Status kerja: {employee.status}</p><p>{employee.positionId?.name ?? "—"} · {employee.divisionId?.name ?? "—"} · {employee.branchId?.name ?? "—"}</p><p>Atasan langsung: {employee.supervisorId?.name ?? "Belum ditetapkan"}</p></CardBody></Card>}
    {employee && <h2 className="text-title-sm">Riwayat tindakan ({total})</h2>}
    {rows.map((row) => <Card key={row._id}><CardBody><h3 className="font-semibold">{row.title} · {DISCIPLINE_LABELS[row.action]}</h3><p>Status: {({ open: "Menunggu tinjauan", issued: "Diterbitkan", rejected: "Tidak ditindaklanjuti", closed: "Selesai" } as Record<string, string>)[row.status]}</p><p className="whitespace-pre-wrap">{row.description}</p><details><summary className="cursor-pointer text-primary">Bukti, klarifikasi dan riwayat keputusan</summary><p>Bukti: {row.evidence || "Belum dicatat"}</p><p>Klarifikasi: {row.employeeStatement || "Belum dicatat"}</p>{row.history.map((h, i) => <p key={i}>{new Date(h.at).toLocaleString("id-ID")} · {h.status}: {h.note}</p>)}</details></CardBody></Card>)}
    <Pagination page={page} limit={25} total={total} totalPages={Math.ceil(total / 25)} onPage={setPage} />
  </div>;
}
