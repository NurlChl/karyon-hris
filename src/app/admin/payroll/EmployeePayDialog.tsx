"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Info, Plus, Target, Trash2, Wallet } from "lucide-react";
import { Alert, Badge, Button, ErrorState, Field, ICON_STROKE, Input, Modal, SkeletonList, Tabs, Toggle, cn } from "@/components/ui";
import { Combobox } from "@/components/ui/Combobox";
import { MonthPicker } from "@/components/ui/DatePicker";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import {
  EMPTY_PROFILE,
  EMPTY_TARGET,
  OVERTIME_MODE_LABELS,
  targetIncentive,
  type OvertimeMode,
  type PayItem,
  type PayProfileData,
} from "@/lib/hr/pay-rules";
import { formatPeriod, formatRupiah } from "@/lib/time";

interface Preview {
  basicSalary: number;
  basicSource: string;
  allowances: Array<{ name: string; amount: number }>;
  deductions: Array<{ name: string; amount: number }>;
  overtimeSalary: number;
  overtimeHours: number;
  totalEarnings: number;
  totalDeductions: number;
  netSalary: number;
  notes: string[];
  warnings: string[];
  problem?: string;
  presentDays: number;
  workingDays: number;
}

function Money({ value, onChange, id, placeholder }: { value: number; onChange: (v: number) => void; id?: string; placeholder?: string }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-label text-subtle pointer-events-none">Rp</span>
      <Input
        id={id}
        inputMode="numeric"
        placeholder={placeholder}
        className="pl-9 tabular-nums h-10"
        value={value ? value.toLocaleString("id-ID") : ""}
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "").slice(0, 13)) || 0)}
      />
    </div>
  );
}

function NumberField({ value, onChange, suffix, id }: { value: number | null; onChange: (v: number | null) => void; suffix?: string; id?: string }) {
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="decimal"
        className={cn("tabular-nums", suffix && (suffix.length <= 2 ? "pr-8" : "pr-16"))}
        value={value === null ? "" : value.toLocaleString("id-ID")}
        onChange={(e) => {
          const raw = e.target.value.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "");
          onChange(raw === "" ? null : Number(raw));
        }}
      />
      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-label text-subtle pointer-events-none">{suffix}</span>}
    </div>
  );
}

function ItemsEditor({
  items,
  onChange,
  withUntil,
}: {
  items: PayItem[];
  onChange: (items: PayItem[]) => void;
  withUntil?: boolean;
}) {
  const update = (i: number, patch: Partial<PayItem>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  return (
    <div className="space-y-2">
      {items.length === 0 && <p className="text-body-sm text-muted">Belum ada.</p>}
      {items.map((it, i) => (
        <div key={i} className={cn("grid gap-2 items-start rounded-lg border border-line p-2.5", withUntil ? "sm:grid-cols-[130px_minmax(0,1fr)_150px_140px_36px]" : "sm:grid-cols-[130px_minmax(0,1fr)_150px_36px]")}>
          <Combobox
            size="sm"
            value={it.kind}
            onChange={(v) => update(i, { kind: v as PayItem["kind"] })}
            options={[
              { value: "earning", label: "Tambahan" },
              { value: "deduction", label: "Potongan" },
            ]}
            aria-label="Jenis"
          />
          <Input className="h-10" placeholder={it.kind === "earning" ? "Contoh: Bonus Lebaran" : "Contoh: Cicilan kasbon"} value={it.name} maxLength={80} onChange={(e) => update(i, { name: e.target.value })} aria-label="Nama" />
          <Money value={it.amount} onChange={(v) => update(i, { amount: v })} />
          {withUntil && (
            <MonthPicker value={it.untilPeriod ?? ""} onChange={(v) => update(i, { untilPeriod: v })} clearable placeholder="Setiap bulan" />
          )}
          <Button variant="ghost" size="icon" aria-label="Hapus" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <Trash2 className="w-4 h-4 text-danger" strokeWidth={ICON_STROKE} />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" icon={Plus} onClick={() => onChange([...items, { kind: "earning", name: "", amount: 0, untilPeriod: "" }])}>
        Tambah baris
      </Button>
    </div>
  );
}

export function EmployeePayDialog({
  employee,
  period: initialPeriod,
  onClose,
  onChanged,
}: {
  employee: { _id: string; name: string; employeeId: string };
  period: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<"period" | "profile">("period");
  const [period, setPeriod] = useState(initialPeriod);
  const [profile, setProfile] = useState<PayProfileData | null>(null);
  const [adjustments, setAdjustments] = useState<PayItem[]>([]);
  const [targetActual, setTargetActual] = useState<number | null>(null);
  const [targetNote, setTargetNote] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadPreview = useCallback(async () => {
    try {
      const res = await api.get<Preview>(`/api/v1/payroll/preview?employeeId=${employee._id}&period=${period}`);
      setPreview(res.data ?? null);
    } catch {
      setPreview(null);
    }
  }, [employee._id, period]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [p, inp] = await Promise.all([
        api.get<PayProfileData>(`/api/v1/payroll/profiles?employeeId=${employee._id}`),
        api.get<{ adjustments: PayItem[]; targetActual: number | null; targetNote: string }>(`/api/v1/payroll/inputs?employeeId=${employee._id}&period=${period}`),
      ]);
      const prof = { ...EMPTY_PROFILE, ...p.data, target: { ...EMPTY_TARGET, ...(p.data?.target ?? {}) } } as PayProfileData;
      if (!prof.target.tiers?.length) prof.target.tiers = EMPTY_TARGET.tiers;
      setProfile(prof);
      setAdjustments(inp.data?.adjustments ?? []);
      setTargetActual(inp.data?.targetActual ?? null);
      setTargetNote(inp.data?.targetNote ?? "");
      void loadPreview();
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [employee._id, period, loadPreview]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveInputs = async () => {
    setSaving(true);
    try {
      const res = await api.put("/api/v1/payroll/inputs", {
        employeeId: employee._id,
        period,
        adjustments: adjustments.filter((a) => a.name.trim() && a.amount > 0).map(({ kind, name, amount, note }) => ({ kind, name, amount, note: note ?? "" })),
        targetActual,
        targetNote,
      });
      toast.success("Tersimpan", res.message);
      await loadPreview();
      onChanged();
    } catch (err) {
      toast.error("Gagal menyimpan", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const saveProfile = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const res = await api.put("/api/v1/payroll/profiles", {
        employeeId: employee._id,
        ...profile,
        recurring: profile.recurring.filter((r) => r.name.trim() && r.amount > 0).map((r) => ({ ...r, note: r.note ?? "", untilPeriod: r.untilPeriod ?? "" })),
      });
      toast.success("Tersimpan", res.message);
      await loadPreview();
      onChanged();
    } catch (err) {
      toast.error("Gagal menyimpan", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const setP = (patch: Partial<PayProfileData>) => setProfile((p) => (p ? { ...p, ...patch } : p));
  const setT = (patch: Partial<PayProfileData["target"]>) => setProfile((p) => (p ? { ...p, target: { ...p.target, ...patch } } : p));
  const liveTarget = profile ? targetIncentive(profile.target, targetActual) : null;

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`Gaji ${employee.name}`}
      description={`${employee.employeeId} · atur komponen, lalu lihat hasil hitungannya di sebelah kanan.`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Tutup
          </Button>
          <Button size="sm" loading={saving} onClick={tab === "period" ? saveInputs : saveProfile} disabled={!profile}>
            {tab === "period" ? "Simpan periode ini" : "Simpan komponen tetap"}
          </Button>
        </>
      }
    >
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !profile ? (
        <SkeletonList rows={5} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-5 min-w-0">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: "period", label: "Periode ini", icon: Wallet },
                { id: "profile", label: "Komponen tetap & aturan", icon: Target },
              ]}
            />

            {tab === "period" ? (
              <>
                <Field label="Periode">
                  <MonthPicker value={period} onChange={(v) => v && setPeriod(v)} />
                </Field>
                <section>
                  <p className="text-body-sm font-semibold text-heading">Bonus & potongan khusus bulan ini</p>
                  <p className="text-label text-muted mb-2">Hanya untuk {formatPeriod(period)}. Contoh: bonus Lebaran, kasbon, denda kehilangan barang.</p>
                  <ItemsEditor items={adjustments} onChange={setAdjustments} />
                </section>

                {profile.target.enabled ? (
                  <section className="rounded-[var(--radius)] border border-line p-4 space-y-3">
                    <p className="text-body-sm font-semibold text-heading flex items-center gap-2">
                      <Target className="w-4 h-4 text-primary" strokeWidth={ICON_STROKE} />
                      Capaian {profile.target.name.toLowerCase()}
                    </p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <Field label={`Tercapai (target ${profile.target.targetValue.toLocaleString("id-ID")} ${profile.target.unit})`}>
                        <NumberField value={targetActual} onChange={setTargetActual} suffix={profile.target.unit} />
                      </Field>
                      <Field label="Catatan capaian">
                        <Input maxLength={500} value={targetNote} onChange={(e) => setTargetNote(e.target.value)} placeholder="Opsional" />
                      </Field>
                    </div>
                    {liveTarget && (
                      <Alert tone={liveTarget.amount ? "success" : "info"}>
                        {liveTarget.explanation}. Insentif: <strong>{formatRupiah(liveTarget.amount)}</strong>
                      </Alert>
                    )}
                  </section>
                ) : (
                  <p className="text-label text-muted flex items-start gap-1.5">
                    <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" strokeWidth={ICON_STROKE} />
                    Karyawan ini tidak punya target berinsentif. Aktifkan di tab Komponen tetap & aturan bila ada kesepakatan target.
                  </p>
                )}
              </>
            ) : (
              <>
                <section className="space-y-3">
                  <p className="text-body-sm font-semibold text-heading">Lembur</p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Combobox
                      value={profile.overtimeMode}
                      onChange={(v) => setP({ overtimeMode: v as OvertimeMode })}
                      options={(Object.keys(OVERTIME_MODE_LABELS) as OvertimeMode[]).map((m) => ({ value: m, label: OVERTIME_MODE_LABELS[m].label, hint: OVERTIME_MODE_LABELS[m].hint }))}
                      aria-label="Pembayaran lembur"
                    />
                    {profile.overtimeMode === "custom_rate" && <Money value={profile.overtimeRate} onChange={(v) => setP({ overtimeRate: v })} placeholder="Tarif per jam" />}
                  </div>
                </section>

                <section className="grid sm:grid-cols-2 gap-3">
                  <Toggle checked={profile.exemptLatePenalty} onChange={(v) => setP({ exemptLatePenalty: v })} label="Tanpa potongan terlambat" description="Misalnya untuk jabatan dengan jam kerja fleksibel." />
                  <Toggle checked={profile.exemptAbsentPenalty} onChange={(v) => setP({ exemptAbsentPenalty: v })} label="Tanpa potongan alpha" />
                </section>

                <section>
                  <p className="text-body-sm font-semibold text-heading">Tunjangan & potongan tetap setiap bulan</p>
                  <p className="text-label text-muted mb-2">
                    Selain gaji pokok dan tunjangan di kontrak. Isi bulan terakhir untuk yang berakhir, misalnya cicilan pinjaman.
                  </p>
                  <ItemsEditor items={profile.recurring} onChange={(recurring) => setP({ recurring })} withUntil />
                </section>

                <section className="rounded-[var(--radius)] border border-line p-4 space-y-4">
                  <Toggle
                    checked={profile.target.enabled}
                    onChange={(enabled) => setT({ enabled })}
                    label="Insentif berdasarkan target"
                    description="Karyawan mendapat bonus sesuai kesepakatan bila capaian bulanannya melewati tingkat tertentu."
                  />
                  {profile.target.enabled && (
                    <>
                      <div className="grid sm:grid-cols-3 gap-3">
                        <Field label="Nama target">
                          <Input maxLength={60} value={profile.target.name} onChange={(e) => setT({ name: e.target.value })} />
                        </Field>
                        <Field label="Target per bulan">
                          <NumberField value={profile.target.targetValue || null} onChange={(v) => setT({ targetValue: v ?? 0 })} />
                        </Field>
                        <Field label="Satuan">
                          <Input maxLength={20} value={profile.target.unit} onChange={(e) => setT({ unit: e.target.value })} placeholder="unit, Rp, kunjungan" />
                        </Field>
                      </div>
                      <div>
                        <p className="text-body-sm font-medium text-foreground">Tingkat bonus</p>
                        <p className="text-label text-muted mb-2">Yang dibayar adalah tingkat tertinggi yang tercapai, bukan dijumlahkan.</p>
                        <div className="space-y-2">
                          <div className="grid grid-cols-[120px_minmax(0,1fr)_36px] gap-2 text-label text-subtle">
                            <span>Capaian minimal</span>
                            <span>Bonus</span>
                          </div>
                          {profile.target.tiers.map((t, i) => (
                            <div key={i} className="grid grid-cols-[120px_minmax(0,1fr)_36px] gap-2 items-center">
                              <NumberField value={t.minPct} onChange={(v) => setT({ tiers: profile.target.tiers.map((x, j) => (j === i ? { ...x, minPct: v ?? 0 } : x)) })} suffix="%" />
                              <Money value={t.amount} onChange={(v) => setT({ tiers: profile.target.tiers.map((x, j) => (j === i ? { ...x, amount: v } : x)) })} />
                              <Button variant="ghost" size="icon" aria-label="Hapus tingkat" onClick={() => setT({ tiers: profile.target.tiers.filter((_, j) => j !== i) })}>
                                <Trash2 className="w-4 h-4 text-danger" strokeWidth={ICON_STROKE} />
                              </Button>
                            </div>
                          ))}
                          <Button variant="ghost" size="sm" icon={Plus} onClick={() => setT({ tiers: [...profile.target.tiers, { minPct: 120, amount: 0 }] })} disabled={profile.target.tiers.length >= 8}>
                            Tambah tingkat
                          </Button>
                        </div>
                      </div>
                      <Field label={`Tambahan per ${profile.target.unit || "unit"} di atas target`} hint="Opsional, dibayar di samping tingkat bonus. 0 = tidak ada.">
                        <Money value={profile.target.excessRate} onChange={(v) => setT({ excessRate: v })} />
                      </Field>
                      <Field label="Isi kesepakatan" hint="Catatan internal, misalnya nomor memo atau tanggal kesepakatan.">
                        <Input maxLength={1000} value={profile.target.note} onChange={(e) => setT({ note: e.target.value })} />
                      </Field>
                      {profile.target.targetValue > 0 && (
                        <div className="rounded-lg bg-surface-2 p-3 text-label text-muted space-y-0.5">
                          <p className="font-semibold text-foreground">Contoh hitungan</p>
                          {[0.8, 1, 1.2].map((ratio) => {
                            const r = targetIncentive(profile.target, Math.round(profile.target.targetValue * ratio));
                            return r ? <p key={ratio}>{r.explanation} → {formatRupiah(r.amount)}</p> : null;
                          })}
                        </div>
                      )}
                    </>
                  )}
                </section>
              </>
            )}
          </div>

          <aside className="lg:border-l lg:border-line lg:pl-6 min-w-0">
            <p className="eyebrow mb-3">Hasil hitung {formatPeriod(period)}</p>
            {!preview ? (
              <SkeletonList rows={4} />
            ) : preview.problem ? (
              <Alert tone="danger">{preview.problem}</Alert>
            ) : (
              <div className="space-y-3 text-body-sm">
                <p className="text-label text-muted">
                  Hadir {preview.presentDays}/{preview.workingDays} hari kerja · gaji pokok dari {preview.basicSource.toLowerCase()}
                </p>
                <Lines title="Penghasilan" rows={[{ name: "Gaji pokok", amount: preview.basicSalary }, ...preview.allowances, ...(preview.overtimeSalary ? [{ name: `Lembur ${preview.overtimeHours} jam`, amount: preview.overtimeSalary }] : [])]} total={preview.totalEarnings} />
                <Lines title="Potongan" rows={preview.deductions} total={preview.totalDeductions} negative />
                <div className="flex items-center justify-between rounded-lg bg-primary-soft px-3 py-2.5">
                  <span className="font-semibold text-heading">Gaji bersih</span>
                  <span className="font-semibold text-primary tabular-nums">{formatRupiah(preview.netSalary)}</span>
                </div>
                {preview.warnings.map((w) => (
                  <Alert key={w} tone="warning">
                    {w}
                  </Alert>
                ))}
                {preview.notes.length > 0 && (
                  <ul className="space-y-1 text-label text-muted list-disc pl-4">
                    {preview.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
                <p className="text-caption text-subtle">Hasil hitung diperbarui setelah Anda menyimpan.</p>
              </div>
            )}
          </aside>
        </div>
      )}
    </Modal>
  );
}

export function Lines({ title, rows, total, negative }: { title: string; rows: Array<{ name: string; amount: number }>; total: number; negative?: boolean }) {
  return (
    <div>
      <p className="text-label font-semibold text-subtle uppercase tracking-wider mb-1">{title}</p>
      <ul className="divide-y divide-[var(--border)]">
        {rows.length === 0 && <li className="py-1.5 text-label text-subtle">Tidak ada</li>}
        {rows.map((r, i) => (
          <li key={i} className="flex items-start justify-between gap-3 py-1.5">
            <span className="text-foreground/85 min-w-0">{r.name}</span>
            <span className={cn("tabular-nums shrink-0", negative && "text-danger")}>{formatRupiah(r.amount)}</span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 pt-1.5 font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatRupiah(total)}</span>
        </li>
      </ul>
    </div>
  );
}

void Badge;
