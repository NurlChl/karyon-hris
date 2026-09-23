"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  Eye,
  FileText,
  FileUp,
  Printer,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  ICON_STROKE,
  Input,
  Modal,
  PageHeader,
  SkeletonList,
  StatCard,
  StatusBadge,
  Tabs,
  TableWrap,
  Td,
  Th,
  Toggle,
  Tr,
  cn,
} from "@/components/ui";
import { Combobox } from "@/components/ui/Combobox";
import { MonthPicker } from "@/components/ui/DatePicker";
import { FileOrLinkInput, attachmentProblem, toAttachmentInputs, type AttachmentItem } from "@/components/ui/FileOrLinkInput";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { formatPeriod, formatRupiah, wibPeriodKey } from "@/lib/time";
import { EmployeePayDialog, Lines } from "./EmployeePayDialog";

interface Employee {
  _id: string;
  name: string;
  employeeId: string;
}

interface PayrollRecord {
  _id: string;
  employeeId: { _id: string; name: string; employeeId: string } | null;
  period: string;
  basicSalary: number;
  allowances: Array<{ name: string; amount: number }>;
  deductions: Array<{ name: string; amount: number }>;
  overtimeSalary: number;
  overtimeHours: number;
  totalEarnings: number;
  totalDeductions: number;
  netSalary: number;
  status: string;
  source?: "generated" | "uploaded";
  uploadedFile?: string;
  uploadedFileName?: string;
  notes?: string[];
}

interface RunFailure {
  id: string;
  name?: string;
  message: string;
}

type StatusTab = "all" | "draft" | "published";

export default function PayrollPage() {
  const toast = useToast();

  const [period, setPeriod] = useState(wibPeriodKey());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [payrolls, setPayrolls] = useState<PayrollRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [asDraft, setAsDraft] = useState(true);
  const [failures, setFailures] = useState<RunFailure[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<PayrollRecord | null>(null);
  const [payDialog, setPayDialog] = useState<Employee | null>(null);
  const [detail, setDetail] = useState<PayrollRecord | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [summary, setSummary] = useState({ count: 0, drafts: 0, net: 0, deductions: 0 });

  const loadEmployees = useCallback(async () => {
    const [emp, all] = await Promise.all([
      api.get<Employee[]>("/api/v1/employees?status=active&limit=500"),
      api.get<PayrollRecord[]>(`/api/v1/payroll?period=${period}&limit=100`),
    ]);
    setEmployees(emp.data ?? []);
    const rows = all.data ?? [];
    setDoneIds(new Set(rows.map((p) => p.employeeId?._id).filter(Boolean) as string[]));
    setSummary({
      count: all.meta?.total ?? rows.length,
      drafts: rows.filter((r) => r.status === "draft").length,
      net: rows.reduce((n, p) => n + (p.netSalary || 0), 0),
      deductions: rows.reduce((n, p) => n + (p.totalDeductions || 0), 0),
    });
  }, [period]);

  const loadSlips = useCallback(async () => {
    const params = new URLSearchParams({ period, page: String(page), limit: String(limit) });
    if (statusTab !== "all") params.set("status", statusTab);
    const res = await api.get<PayrollRecord[]>(`/api/v1/payroll?${params}`);
    setPayrolls(res.data ?? []);
    setTotal(res.meta?.total ?? 0);
  }, [period, page, limit, statusTab]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadEmployees(), loadSlips()]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [loadEmployees, loadSlips]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = useMemo(
    () =>
      employees
        .filter((e) => !doneIds.has(e._id))
        .filter((e) => !search.trim() || `${e.name} ${e.employeeId}`.toLowerCase().includes(search.trim().toLowerCase())),
    [employees, doneIds, search]
  );

  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allSelected = pending.length > 0 && pending.every((e) => selected.includes(e._id));

  const run = async (ids: string[], publish: boolean) => {
    if (!ids.length) return;
    setSubmitting(true);
    setFailures([]);
    try {
      const res = await api.post<{ results: unknown[]; errors: RunFailure[] }>("/api/v1/payroll", { period, employeeIds: ids, publish });
      const made = res.data?.results?.length ?? 0;
      const failed = res.data?.errors ?? [];
      setFailures(failed);
      setSelected([]);
      if (made && failed.length) toast.warning(`${made} slip dibuat, ${failed.length} gagal`, "Alasan setiap kegagalan tercantum di bawah daftar karyawan.");
      else if (made) toast.success(`${made} slip gaji ${publish ? "diterbitkan" : "dibuat sebagai draf"}`, publish ? "Karyawan sudah diberi tahu." : "Tinjau lalu terbitkan dari daftar slip.");
      else toast.error("Tidak ada slip gaji yang dibuat", "Alasan kegagalan tercantum di bawah daftar karyawan.");
      await load();
    } catch (err) {
      toast.error("Gagal memproses slip gaji", errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const publish = async (ids: string[]) => {
    try {
      const res = await api.patch("/api/v1/payroll", { action: "publish", ids });
      toast.success("Diterbitkan", res.message);
      await load();
    } catch (err) {
      toast.error("Gagal menerbitkan", errorMessage(err));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api.delete("/api/v1/payroll?id=" + deleting._id);
      toast.success("Draf dihapus", `${deleting.employeeId?.name ?? "Karyawan"} dikeluarkan dari periode ini.`);
      setDeleting(null);
      await load();
    } catch (err) {
      toast.error("Gagal menghapus draf", errorMessage(err));
    }
  };

  const draftIds = payrolls.filter((p) => p.status === "draft").map((p) => p._id);

  return (
    <div>
      <PageHeader
        eyebrow="Payroll"
        title="Slip gaji"
        description="Hitung slip dari kontrak dan presensi, tambahkan bonus, potongan, dan insentif target per karyawan, tinjau sebagai draf, lalu terbitkan. Slip PDF buatan sendiri juga bisa diunggah per karyawan."
        actions={
          <>
            <Link href="/admin/payroll/simulate"><Button variant="secondary">Ruang Uji Kebijakan</Button></Link>
            <Button variant="secondary" icon={FileUp} onClick={() => setUploadOpen(true)}>
              Unggah slip PDF
            </Button>
            <Link href="/admin/payroll/templates">
              <Button variant="ghost" icon={FileText}>
                Template slip
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid gap-3 grid-cols-2 2xl:grid-cols-4 mb-6">
        <StatCard label="Slip periode ini" value={summary.count} hint={formatPeriod(period)} icon={ReceiptText} />
        <StatCard label="Masih draf" value={summary.drafts} hint="belum terlihat karyawan" icon={Eye} tone={summary.drafts ? "warning" : "neutral"} />
        <StatCard label="Total gaji bersih" value={formatRupiah(summary.net)} icon={Wallet} tone="success" />
        <StatCard label="Total potongan" value={formatRupiah(summary.deductions)} icon={CalendarDays} tone="neutral" />
      </div>

      {error && <ErrorState message={error} onRetry={load} />}

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)] items-start">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Proses periode" icon={CalendarDays} />
            <CardBody className="space-y-4">
              <Field label="Periode gaji" required>
                <MonthPicker
                  value={period}
                  onChange={(value) => {
                    if (!value) return;
                    setPeriod(value);
                    setSelected([]);
                    setFailures([]);
                    setPage(1);
                  }}
                />
              </Field>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-body-sm font-medium text-foreground">Belum punya slip ({pending.length})</span>
                  {pending.length > 0 && (
                    <button type="button" onClick={() => setSelected(allSelected ? [] : pending.map((e) => e._id))} className="text-body-sm text-primary hover:underline cursor-pointer">
                      {allSelected ? "Kosongkan" : "Pilih semua"}
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-subtle pointer-events-none" strokeWidth={ICON_STROKE} />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari karyawan" className="pl-8 h-9 text-body-sm" aria-label="Cari karyawan" />
                </div>
                {loading && !employees.length ? (
                  <SkeletonList rows={3} />
                ) : pending.length === 0 ? (
                  <p className="text-body-sm text-muted leading-relaxed rounded-[var(--radius-control)] bg-surface-2 p-3.5">
                    {employees.length === 0 ? "Belum ada karyawan aktif." : `Semua karyawan${search ? " yang cocok" : ""} sudah punya slip untuk ${formatPeriod(period)}.`}
                  </p>
                ) : (
                  <div className="max-h-80 overflow-y-auto rounded-[var(--radius-control)] border border-line divide-y divide-[var(--border)]">
                    {pending.map((emp) => (
                      <div key={emp._id} className="flex items-center gap-2 px-3 py-2 hover:bg-surface-2 transition-colors">
                        <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                          <input type="checkbox" checked={selected.includes(emp._id)} onChange={() => toggle(emp._id)} className="w-4 h-4 accent-[var(--primary)] cursor-pointer" />
                          <span className="min-w-0">
                            <span className="block text-body-sm text-foreground truncate">{emp.name}</span>
                            <span className="block text-label text-subtle">{emp.employeeId}</span>
                          </span>
                        </label>
                        <Button variant="ghost" size="sm" icon={SlidersHorizontal} onClick={() => setPayDialog(emp)}>
                          Atur
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Toggle checked={asDraft} onChange={setAsDraft} label="Simpan sebagai draf dulu" description="Karyawan belum melihat slip sampai Anda menerbitkannya." />

              <Button className="w-full justify-center" icon={ReceiptText} loading={submitting} disabled={selected.length === 0} onClick={() => run(selected, !asDraft)}>
                {asDraft ? `Hitung ${selected.length || ""} slip (draf)` : `Hitung & terbitkan ${selected.length || ""} slip`}
              </Button>
            </CardBody>
          </Card>

          {failures.length > 0 && (
            <Card>
              <CardHeader title={`Gagal diproses (${failures.length})`} description="Perbaiki penyebabnya, lalu proses ulang." />
              <CardBody className="space-y-3">
                {failures.map((f) => (
                  <div key={f.id} className="rounded-[var(--radius-control)] bg-danger-soft border border-danger/20 p-3.5">
                    <p className="text-body-sm font-medium text-foreground">{f.name ?? employees.find((e) => e._id === f.id)?.name ?? "Karyawan"}</p>
                    <p className="text-body-sm text-muted leading-relaxed mt-1">{f.message}</p>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader
            title="Slip gaji"
            description={formatPeriod(period)}
            icon={Users}
            actions={
              draftIds.length > 0 && (
                <Button size="sm" icon={Send} onClick={() => publish(draftIds)}>
                  Terbitkan {draftIds.length} draf di halaman ini
                </Button>
              )
            }
          />
          <CardBody className="space-y-4">
            <Tabs<StatusTab>
              value={statusTab}
              onChange={(t) => {
                setStatusTab(t);
                setPage(1);
              }}
              tabs={[
                { id: "all", label: "Semua" },
                { id: "draft", label: "Draf", count: summary.drafts },
                { id: "published", label: "Terbit" },
              ]}
            />
            {loading && !payrolls.length ? (
              <SkeletonList rows={4} />
            ) : payrolls.length === 0 ? (
              <EmptyState icon={ReceiptText} title="Belum ada slip" description="Pilih karyawan di kiri lalu hitung, atau unggah slip PDF." />
            ) : (
              <>
                <TableWrap>
                  <thead>
                    <tr>
                      <Th>Karyawan</Th>
                      <Th className="text-right">Penghasilan</Th>
                      <Th className="text-right">Potongan</Th>
                      <Th className="text-right">Gaji bersih</Th>
                      <Th>Status</Th>
                      <Th className="text-right">Aksi</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrolls.map((pr) => {
                      const uploaded = pr.source === "uploaded";
                      return (
                        <Tr key={pr._id}>
                          <Td>
                            <button type="button" onClick={() => setDetail(pr)} className="text-left cursor-pointer group">
                              <span className="block text-body-sm font-medium text-heading group-hover:text-primary transition-colors">{pr.employeeId?.name ?? "Karyawan terhapus"}</span>
                              <span className="block text-label text-subtle">
                                {pr.employeeId?.employeeId ?? "—"}
                                {uploaded && " · PDF unggahan"}
                              </span>
                            </button>
                          </Td>
                          <Td className="text-right tabular-nums">{uploaded && !pr.totalEarnings ? "—" : formatRupiah(pr.totalEarnings)}</Td>
                          <Td className="text-right tabular-nums text-warning">{uploaded && !pr.totalDeductions ? "—" : formatRupiah(pr.totalDeductions)}</Td>
                          <Td className="text-right tabular-nums font-semibold">{uploaded && !pr.netSalary ? "—" : formatRupiah(pr.netSalary)}</Td>
                          <Td>
                            <StatusBadge status={pr.status} />
                          </Td>
                          <Td className="text-right">
                            <div className="flex items-center justify-end gap-0.5">
                              {pr.status === "draft" && (
                                <Button variant="ghost" size="sm" icon={Send} onClick={() => publish([pr._id])}>
                                  Terbitkan
                                </Button>
                              )}
                              {uploaded ? (
                                <a href={pr.uploadedFile} target="_blank" rel="noreferrer">
                                  <Button variant="ghost" size="icon" aria-label="Buka PDF">
                                    <FileText className="w-4 h-4" strokeWidth={ICON_STROKE} />
                                  </Button>
                                </a>
                              ) : (
                                <>
                                  <Link href={`/print/payslip/${pr._id}`} target="_blank">
                                    <Button variant="ghost" size="icon" aria-label="Cetak">
                                      <Printer className="w-4 h-4" strokeWidth={ICON_STROKE} />
                                    </Button>
                                  </Link>
                                  {pr.employeeId && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label="Atur & hitung ulang"
                                      title="Atur & hitung ulang"
                                      onClick={() => setPayDialog({ _id: pr.employeeId!._id, name: pr.employeeId!.name, employeeId: pr.employeeId!.employeeId })}
                                    >
                                      <SlidersHorizontal className="w-4 h-4" strokeWidth={ICON_STROKE} />
                                    </Button>
                                  )}
                                  {pr.employeeId && (
                                    <Button variant="ghost" size="icon" aria-label="Hitung ulang" title="Hitung ulang dengan data terbaru" onClick={() => run([pr.employeeId!._id], pr.status === "published")}>
                                      <RefreshCw className="w-4 h-4" strokeWidth={ICON_STROKE} />
                                    </Button>
                                  )}
                                </>
                              )}
                              {pr.status === "draft" && (
                                <Button variant="ghost" size="icon" aria-label="Hapus draf" onClick={() => setDeleting(pr)}>
                                  <Trash2 className="w-4 h-4 text-danger" strokeWidth={ICON_STROKE} />
                                </Button>
                              )}
                            </div>
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </TableWrap>
                <Pagination
                  page={page}
                  totalPages={Math.max(1, Math.ceil(total / limit))}
                  total={total}
                  limit={limit}
                  onPage={setPage}
                  onLimit={(l) => {
                    setLimit(l);
                    setPage(1);
                  }}
                />
              </>
            )}
          </CardBody>
        </Card>
      </div>

      {payDialog && <EmployeePayDialog employee={payDialog} period={period} onClose={() => setPayDialog(null)} onChanged={() => void loadEmployees()} />}

      {detail && (
        <Modal open onClose={() => setDetail(null)} size="md" title={`Slip ${detail.employeeId?.name ?? ""}`} description={formatPeriod(detail.period)}>
          {detail.source === "uploaded" ? (
            <div className="space-y-3">
              <Alert tone="info">Slip ini berupa berkas PDF yang diunggah, bukan hasil hitung sistem.</Alert>
              <a href={detail.uploadedFile} target="_blank" rel="noreferrer" className="card p-3.5 flex items-center gap-3 hover:border-primary">
                <FileText className="w-5 h-5 text-primary" strokeWidth={ICON_STROKE} />
                <span className="text-body-sm font-medium">{detail.uploadedFileName || "Buka slip"}</span>
              </a>
            </div>
          ) : (
            <div className="space-y-3 text-body-sm">
              <Lines
                title="Penghasilan"
                rows={[{ name: "Gaji pokok", amount: detail.basicSalary }, ...detail.allowances, ...(detail.overtimeSalary ? [{ name: `Lembur ${detail.overtimeHours} jam`, amount: detail.overtimeSalary }] : [])]}
                total={detail.totalEarnings}
              />
              <Lines title="Potongan" rows={detail.deductions} total={detail.totalDeductions} negative />
              <div className="flex items-center justify-between rounded-lg bg-primary-soft px-3 py-2.5">
                <span className="font-semibold">Gaji bersih</span>
                <span className="font-semibold text-primary tabular-nums">{formatRupiah(detail.netSalary)}</span>
              </div>
              {!!detail.notes?.length && (
                <ul className="list-disc pl-4 text-label text-muted space-y-1">
                  {detail.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Modal>
      )}

      {uploadOpen && <UploadSlipDialog employees={employees} period={period} onClose={() => setUploadOpen(false)} onSaved={() => { setUploadOpen(false); void load(); }} />}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        tone="danger"
        title="Hapus draf slip gaji?"
        message={`Draf slip ${deleting?.employeeId?.name ?? "karyawan ini"} untuk ${formatPeriod(period)} akan dihapus. Anda dapat memprosesnya kembali kapan saja.`}
        confirmLabel="Hapus draf"
      />
    </div>
  );
}

function UploadSlipDialog({
  employees,
  period: initialPeriod,
  onClose,
  onSaved,
}: {
  employees: Employee[];
  period: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [employeeId, setEmployeeId] = useState("");
  const [period, setPeriod] = useState(initialPeriod);
  const [file, setFile] = useState<AttachmentItem[]>([]);
  const [net, setNet] = useState(0);
  const [publishNow, setPublishNow] = useState(true);
  const [replace, setReplace] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const problem = attachmentProblem(file);
    if (problem) return toast.error("Berkas belum siap", problem);
    setSaving(true);
    try {
      const res = await api.patch("/api/v1/payroll", {
        action: "upload",
        employeeId,
        period,
        file: toAttachmentInputs(file)[0],
        netSalary: net || undefined,
        publish: publishNow,
        replace,
      });
      toast.success("Tersimpan", res.message);
      onSaved();
    } catch (err) {
      toast.error("Gagal mengunggah", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Unggah slip gaji PDF"
      description="Untuk slip yang dibuat di luar sistem, misalnya dari software akuntansi. Karyawan melihat berkas ini di portal."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button size="sm" loading={saving} disabled={!employeeId || !file.length} onClick={save}>
            {publishNow ? "Unggah & terbitkan" : "Unggah sebagai draf"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Karyawan" required>
            <Combobox value={employeeId} onChange={setEmployeeId} options={employees.map((e) => ({ value: e._id, label: e.name, hint: e.employeeId }))} placeholder="Pilih karyawan…" sheetTitle="Karyawan" />
          </Field>
          <Field label="Periode" required>
            <MonthPicker value={period} onChange={(v) => v && setPeriod(v)} />
          </Field>
        </div>
        <Field label="Berkas slip (PDF)" required>
          <FileOrLinkInput value={file} onChange={setFile} context="document" allowLink={false} />
        </Field>
        <Field label="Gaji bersih" hint="Opsional, agar total periode di dashboard tetap lengkap.">
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-body-sm text-subtle">Rp</span>
            <Input inputMode="numeric" className="pl-10 tabular-nums" value={net ? net.toLocaleString("id-ID") : ""} onChange={(e) => setNet(Number(e.target.value.replace(/\D/g, "")) || 0)} />
          </div>
        </Field>
        <Toggle checked={publishNow} onChange={setPublishNow} label="Langsung terbitkan" description="Karyawan menerima notifikasi." />
        <Toggle checked={replace} onChange={setReplace} label="Ganti slip yang sudah terbit" description="Bila karyawan sudah punya slip terbit di periode ini." />
      </div>
    </Modal>
  );
}

void cn;
void Badge;
