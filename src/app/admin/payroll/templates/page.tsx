"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Eye,
  FileText,
  Plus,
  Save,
  Star,
  Trash2,
} from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  ErrorState,
  Field,
  ICON_STROKE,
  Input,
  PageHeader,
  Select,
  SkeletonList,
  Textarea,
  Toggle,
  cn,
} from "@/components/ui";
import { ReorderList } from "@/components/ui/Reorder";
import { LogoField } from "@/components/print/LogoField";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { Paper } from "@/components/print/PrintShell";
import {
  PayslipDocument,
  type PayslipData,
  type PayslipTemplateShape,
} from "@/components/print/PayslipDocument";
import { BLOCK_HINTS, BLOCK_LABELS, type BlockType } from "@/lib/hr/payslip";

interface Template extends PayslipTemplateShape {
  _id: string;
  name: string;
  description: string;
  isDefault: boolean;
  /** Optional on the shared shape; the builder always keeps a value. */
  showLogo: boolean;
  logoUrl: string;
  logoHeight: number;
}

/**
 * Sample figures for the live preview.
 *
 * Deliberately not a real employee's slip: the builder is a layout tool, and
 * loading actual salary data into it would expose one person's pay to anyone
 * who opens the template screen.
 */
const SAMPLE: PayslipData = {
  period: "2026-07",
  employee: {
    employeeId: "EMP-2026-0001",
    name: "Budi Santoso",
    positionName: "Staf Akuntansi",
    divisionName: "Keuangan",
    branchName: "Kantor Pusat Jakarta",
    joinDate: "2024-02-01",
    employmentStatus: "PKWTT (Tetap)",
    taxStatus: "TK/0",
    bankName: "Bank Central Asia",
    bankAccount: "8881234567",
    npwp: "09.254.294.3-407.000",
  },
  basicSalary: 7500000,
  allowances: [
    { name: "Tunjangan Jabatan", amount: 1000000 },
    { name: "Tunjangan Transport", amount: 600000 },
  ],
  deductions: [
    { name: "BPJS Kesehatan (1%)", amount: 75000 },
    { name: "BPJS Ketenagakerjaan (2%)", amount: 150000 },
    { name: "PPh 21 (5%)", amount: 218750 },
    { name: "Potongan keterlambatan (24 menit)", amount: 0 },
  ],
  overtimeSalary: 375000,
  overtimeHours: 15,
  totalEarnings: 9475000,
  totalDeductions: 443750,
  netSalary: 9031250,
  lateMinutes: 24,
  absentDays: 0,
  presentDays: 22,
  workingDays: 23,
};

const BLOCK_ORDER: BlockType[] = [
  "header",
  "employee_info",
  "earnings",
  "deductions",
  "net_salary",
  "attendance",
  "note",
  "signature",
];

export default function PayslipTemplatesPage() {
  const toast = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [fieldOptions, setFieldOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [defaults, setDefaults] = useState<{
    blocks: Template["blocks"];
    employeeFields: string[];
    companyName: string;
    companyAddress: string;
  } | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<{
        templates: Template[];
        fieldOptions: Array<{ id: string; label: string }>;
        defaults: typeof defaults;
      }>("/api/v1/payroll/templates");
      const list = res.data?.templates ?? [];
      setTemplates(list);
      setFieldOptions(res.data?.fieldOptions ?? []);
      setDefaults(res.data?.defaults ?? null);
      setActiveId((cur) => cur ?? list.find((t) => t.isDefault)?._id ?? list[0]?._id ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const found = templates.find((t) => t._id === activeId);
    setDraft(found ? structuredClone(found) : null);
  }, [activeId, templates]);

  const createNew = () => {
    if (!defaults) return;
    setActiveId(null);
    setDraft({
      _id: "",
      name: "",
      description: "",
      isDefault: templates.length === 0,
      paperSize: "A4",
      accentColor: "#4f46e5",
      baseFontSize: 12,
      margin: 18,
      showLogo: false,
      logoUrl: "",
      logoHeight: 14,
      companyName: defaults.companyName,
      companyAddress: defaults.companyAddress,
      documentTitle: "SLIP GAJI KARYAWAN",
      footerNote:
        "Dokumen ini dihasilkan otomatis oleh sistem dan sah tanpa tanda tangan basah. " +
        "Keberatan atas perhitungan dapat diajukan ke HRD paling lambat 7 hari sejak slip diterbitkan.",
      employeeFields: [...defaults.employeeFields],
      signatories: [
        { label: "Diterima oleh", name: "" },
        { label: "Disetujui oleh", name: "" },
      ],
      blocks: structuredClone(defaults.blocks),
    });
  };

  const set = useCallback(<K extends keyof Template>(key: K, value: Template[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await api.post<Template>("/api/v1/payroll/templates", {
        ...draft,
        id: draft._id || undefined,
      });
      toast.success("Tersimpan", res.message);
      const savedId = res.data?._id ?? draft._id;
      await load();
      if (savedId) setActiveId(savedId);
    } catch (err) {
      toast.error("Gagal menyimpan", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await api.delete(`/api/v1/payroll/templates?id=${deleteTarget._id}`);
      toast.success("Dihapus", res.message);
      setDeleteTarget(null);
      setActiveId(null);
      await load();
    } catch (err) {
      toast.error("Gagal menghapus", errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };



  const patchBlock = (index: number, patch: Partial<Template["blocks"][number]>) => {
    if (!draft) return;
    const blocks = draft.blocks.map((b, i) => (i === index ? { ...b, ...patch } : b));
    set("blocks", blocks);
  };

  const missingBlocks = useMemo(
    () => (draft ? BLOCK_ORDER.filter((t) => !draft.blocks.some((b) => b.type === t)) : []),
    [draft]
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-64" />
        <SkeletonList rows={4} />
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/admin/payroll"
        className="inline-flex items-center gap-2 text-body-sm font-medium text-muted hover:text-foreground transition-colors mb-5"
      >
        <ArrowLeft className="w-4 h-4" strokeWidth={ICON_STROKE} />
        Kembali ke slip gaji
      </Link>

      <PageHeader
        eyebrow="Payroll"
        title="Template Slip Gaji"
        description="Susun tata letak slip gaji dari blok yang bisa dinyalakan, diurutkan, dan diberi judul sendiri. Pratinjau di kanan memakai angka contoh."
        actions={
          <>
            <Button variant="secondary" icon={Plus} onClick={createNew}>
              Template baru
            </Button>
            <Button icon={Save} onClick={save} loading={saving} disabled={!draft}>
              Simpan
            </Button>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={load} />}

      <div className="grid gap-6 xl:grid-cols-[380px_1fr] items-start">
        {/* ---------------- editor ---------------- */}
        <div className="space-y-5">
          <Card>
            <CardHeader title="Template tersimpan" icon={FileText} />
            <CardBody className="p-2">
              {templates.length === 0 ? (
                <p className="text-body-sm text-muted px-3 py-4 leading-relaxed">
                  Belum ada template. Slip gaji sementara memakai tata letak bawaan sistem.
                </p>
              ) : (
                <ul className="space-y-1">
                  {templates.map((t) => (
                    <li key={t._id}>
                      <button
                        onClick={() => setActiveId(t._id)}
                        className={cn(
                          "w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-[var(--radius-control)] text-left transition-colors cursor-pointer",
                          t._id === activeId ? "bg-primary-soft" : "hover:bg-surface-2"
                        )}
                      >
                        <span className="min-w-0">
                          <span
                            className={cn(
                              "block text-body-sm font-medium truncate",
                              t._id === activeId ? "text-primary" : "text-foreground"
                            )}
                          >
                            {t.name}
                          </span>
                          {t.description && (
                            <span className="block text-label text-subtle truncate mt-0.5">
                              {t.description}
                            </span>
                          )}
                        </span>
                        {t.isDefault && (
                          <Badge tone="success" icon={Star}>
                            Utama
                          </Badge>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {draft && (
            <>
              <Card>
                <CardHeader title="Identitas" />
                <CardBody className="space-y-4">
                  <Field label="Nama template" required htmlFor="pt-name">
                    <Input
                      id="pt-name"
                      value={draft.name}
                      onChange={(e) => set("name", e.target.value)}
                      placeholder="Contoh: Slip Gaji Standar"
                    />
                  </Field>
                  <Field label="Keterangan" htmlFor="pt-desc">
                    <Input
                      id="pt-desc"
                      value={draft.description}
                      onChange={(e) => set("description", e.target.value)}
                      placeholder="Dipakai untuk karyawan tetap"
                    />
                  </Field>
                  <Field label="Judul dokumen" htmlFor="pt-title">
                    <Input
                      id="pt-title"
                      value={draft.documentTitle}
                      onChange={(e) => set("documentTitle", e.target.value)}
                    />
                  </Field>
                  <Field label="Nama perusahaan" htmlFor="pt-company">
                    <Input
                      id="pt-company"
                      value={draft.companyName}
                      onChange={(e) => set("companyName", e.target.value)}
                    />
                  </Field>
                  <Field label="Alamat perusahaan" htmlFor="pt-address">
                    <Textarea
                      id="pt-address"
                      className="min-h-20"
                      value={draft.companyAddress}
                      onChange={(e) => set("companyAddress", e.target.value)}
                    />
                  </Field>
                  <LogoField
                    logoUrl={draft.logoUrl}
                    showLogo={draft.showLogo}
                    logoHeight={draft.logoHeight}
                    onChange={(patch) =>
                      setDraft((d) => (d ? { ...d, ...patch } : d))
                    }
                  />

                  <div className="rounded-[var(--radius-control)] border border-line px-3">
                    <Toggle
                      checked={draft.isDefault}
                      onChange={(v) => set("isDefault", v)}
                      label="Jadikan template utama"
                      description="Dipakai otomatis untuk slip gaji yang dibuat setelah ini."
                    />
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Tampilan" />
                <CardBody className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Ukuran kertas" htmlFor="pt-paper">
                      <Select
                        id="pt-paper"
                        value={draft.paperSize}
                        onChange={(e) => set("paperSize", e.target.value as "A4" | "Letter")}
                      >
                        <option value="A4">A4</option>
                        <option value="Letter">Letter</option>
                      </Select>
                    </Field>
                    <Field label="Warna aksen" htmlFor="pt-accent">
                      <div className="flex gap-2">
                        <input
                          id="pt-accent"
                          type="color"
                          value={draft.accentColor}
                          onChange={(e) => set("accentColor", e.target.value)}
                          className="h-11 w-12 rounded-[var(--radius-control)] border border-line bg-surface cursor-pointer p-1"
                        />
                        <Input
                          value={draft.accentColor}
                          onChange={(e) => set("accentColor", e.target.value)}
                          aria-label="Kode warna aksen"
                          className="font-mono"
                        />
                      </div>
                    </Field>
                    <Field label="Ukuran huruf" htmlFor="pt-font" hint="9–16 px">
                      <Input
                        id="pt-font"
                        type="number"
                        min={9}
                        max={16}
                        value={draft.baseFontSize}
                        onChange={(e) =>
                          set(
                            "baseFontSize",
                            Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 12
                          )
                        }
                      />
                    </Field>
                    <Field label="Margin" htmlFor="pt-margin" hint="dalam milimeter">
                      <Input
                        id="pt-margin"
                        type="number"
                        min={5}
                        max={40}
                        value={draft.margin}
                        onChange={(e) =>
                          set("margin", Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 18)
                        }
                      />
                    </Field>
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Blok dokumen"
                  description="Nyalakan dan beri judul sendiri. Seret gagang di kiri untuk mengubah urutan, atau fokuskan gagang itu lalu tekan panah atas/bawah. Blok yang mati tidak ikut tercetak."
                />
                <CardBody className="p-2 space-y-1.5">
                  <ReorderList
                    items={draft.blocks}
                    getKey={(block, i) => `${block.type}-${i}`}
                    onReorder={(next) => set("blocks", next)}
                    describeItem={(block) => BLOCK_LABELS[block.type]}
                    renderItem={(block, i) => (
                      <BlockRow
                        block={block}
                        index={i}
                        onPatch={patchBlock}
                        onRemove={() =>
                          set(
                            "blocks",
                            draft.blocks.filter((_, idx) => idx !== i)
                          )
                        }
                      />
                    )}
                  />

                  {missingBlocks.length > 0 && (
                    <div className="px-2 pt-2 border-t border-line mt-2">
                      <p className="text-label text-subtle mb-2">Tambahkan blok</p>
                      <div className="flex flex-wrap gap-1.5">
                        {missingBlocks.map((type) => (
                          <Button
                            key={type}
                            variant="secondary"
                            size="sm"
                            icon={Plus}
                            onClick={() =>
                              set("blocks", [
                                ...draft.blocks,
                                { type, enabled: true, title: "", options: {} },
                              ])
                            }
                          >
                            {BLOCK_LABELS[type]}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Kolom identitas karyawan"
                  description="Kolom yang dicentang muncul pada blok Identitas karyawan."
                />
                <CardBody className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                  {fieldOptions.map((f) => (
                    <label key={f.id} className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.employeeFields.includes(f.id)}
                        onChange={(e) =>
                          set(
                            "employeeFields",
                            e.target.checked
                              ? [...draft.employeeFields, f.id]
                              : draft.employeeFields.filter((x) => x !== f.id)
                          )
                        }
                        className="w-4 h-4 rounded accent-[var(--primary)] cursor-pointer"
                      />
                      <span className="text-body-sm text-foreground">{f.label}</span>
                    </label>
                  ))}
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Kolom tanda tangan" />
                <CardBody className="space-y-3">
                  {draft.signatories.map((s, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={s.label}
                        onChange={(e) => {
                          const next = [...draft.signatories];
                          next[i] = { ...next[i], label: e.target.value };
                          set("signatories", next);
                        }}
                        placeholder="Label, misalnya Disetujui oleh"
                        aria-label={`Label tanda tangan ${i + 1}`}
                      />
                      <Input
                        value={s.name}
                        onChange={(e) => {
                          const next = [...draft.signatories];
                          next[i] = { ...next[i], name: e.target.value };
                          set("signatories", next);
                        }}
                        placeholder="Nama (opsional)"
                        aria-label={`Nama penanda tangan ${i + 1}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Hapus kolom tanda tangan"
                        onClick={() =>
                          set(
                            "signatories",
                            draft.signatories.filter((_, idx) => idx !== i)
                          )
                        }
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={ICON_STROKE} />
                      </Button>
                    </div>
                  ))}
                  {draft.signatories.length < 3 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Plus}
                      onClick={() => set("signatories", [...draft.signatories, { label: "", name: "" }])}
                    >
                      Tambah kolom
                    </Button>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Catatan kaki" />
                <CardBody>
                  <Textarea
                    value={draft.footerNote}
                    onChange={(e) => set("footerNote", e.target.value)}
                    className="min-h-28"
                    aria-label="Catatan kaki slip gaji"
                  />
                </CardBody>
              </Card>

              {draft._id && (
                <Button
                  variant="ghost"
                  icon={Trash2}
                  className="text-danger"
                  onClick={() => setDeleteTarget(draft)}
                >
                  Hapus template ini
                </Button>
              )}
            </>
          )}

          {!draft && (
            <Alert tone="info" title="Pilih atau buat template">
              Pilih salah satu template di atas untuk mengubahnya, atau buat yang baru. Selama belum
              ada template tersimpan, slip gaji memakai tata letak bawaan sistem.
            </Alert>
          )}
        </div>

        {/* ---------------- preview ---------------- */}
        {/* min-w-0 lets this grid track shrink below the paper's natural width;
            without it the A4 sheet widens the whole page instead of scrolling. */}
        <div className="min-w-0 xl:sticky xl:top-24">
          <div className="flex items-center gap-2 mb-3">
            <Eye className="w-4 h-4 text-subtle" strokeWidth={ICON_STROKE} />
            <p className="eyebrow">Pratinjau · angka contoh</p>
          </div>

          {draft ? (
            <div className="overflow-x-auto rounded-[var(--radius)] bg-[#eceef4] p-5">
              {/* `zoom` rather than `transform: scale()`: a transform leaves the
                  element's layout box at full size, so the sheet would still
                  reserve 210mm and overflow the column. */}
              <div style={{ zoom: 0.86 }}>
                <Paper size={draft.paperSize} margin={draft.margin} fontSize={draft.baseFontSize}>
                  <PayslipDocument template={draft} data={SAMPLE} />
                </Paper>
              </div>
            </div>
          ) : (
            <Card>
              <CardBody className="py-16 text-center text-body-sm text-muted">
                Pratinjau muncul setelah Anda memilih atau membuat template.
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        loading={deleting}
        title="Hapus template?"
        confirmLabel="Ya, hapus"
        message={`Template "${deleteTarget?.name}" akan dihapus. Slip gaji yang sudah terbit tidak terpengaruh karena dokumennya sudah tersimpan.`}
      />
    </div>
  );
}


/* ------------------------------------------------------------------ */

function BlockRow({
  block,
  index,
  onPatch,
  onRemove,
}: {
  block: { type: BlockType; enabled: boolean; title: string; options: Record<string, unknown> };
  index: number;
  onPatch: (i: number, patch: Partial<{ enabled: boolean; title: string; options: Record<string, unknown> }>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        "rounded-[var(--radius-control)] border transition-colors",
        block.enabled ? "border-line bg-surface" : "border-line bg-surface-2/60"
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 min-w-0 text-left cursor-pointer"
        >
          <span
            className={cn(
              "block text-body-sm font-medium truncate",
              block.enabled ? "text-foreground" : "text-subtle"
            )}
          >
            {block.title || BLOCK_LABELS[block.type]}
          </span>
          <span className="block text-caption text-subtle truncate mt-0.5">
            {BLOCK_HINTS[block.type]}
          </span>
        </button>

        <input
          type="checkbox"
          checked={block.enabled}
          onChange={(e) => onPatch(index, { enabled: e.target.checked })}
          aria-label={`Aktifkan blok ${BLOCK_LABELS[block.type]}`}
          className="w-4 h-4 rounded accent-[var(--primary)] cursor-pointer shrink-0"
        />
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-line">
          <Field label="Judul khusus" htmlFor={`blk-${index}`} hint="Kosongkan untuk memakai judul bawaan.">
            <Input
              id={`blk-${index}`}
              value={block.title}
              onChange={(e) => onPatch(index, { title: e.target.value })}
              placeholder={BLOCK_LABELS[block.type]}
            />
          </Field>

          {block.type === "employee_info" && (
            <Field label="Jumlah kolom" htmlFor={`blk-col-${index}`}>
              <Select
                id={`blk-col-${index}`}
                value={String(block.options.columns ?? 2)}
                onChange={(e) => onPatch(index, { options: { ...block.options, columns: Number(e.target.value) } })}
              >
                <option value="1">Satu kolom</option>
                <option value="2">Dua kolom</option>
              </Select>
            </Field>
          )}

          {(block.type === "earnings" || block.type === "deductions") && (
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(block.options.showZero)}
                onChange={(e) => onPatch(index, { options: { ...block.options, showZero: e.target.checked } })}
                className="w-4 h-4 rounded accent-[var(--primary)] cursor-pointer"
              />
              <span className="text-body-sm text-foreground">Tampilkan baris bernilai nol</span>
            </label>
          )}

          {block.type === "net_salary" && (
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(block.options.showTerbilang)}
                onChange={(e) =>
                  onPatch(index, { options: { ...block.options, showTerbilang: e.target.checked } })
                }
                className="w-4 h-4 rounded accent-[var(--primary)] cursor-pointer"
              />
              <span className="text-body-sm text-foreground">Tampilkan nominal dalam huruf</span>
            </label>
          )}

          <Button variant="ghost" size="sm" icon={Trash2} className="text-danger" onClick={onRemove}>
            Hapus blok
          </Button>
        </div>
      )}
    </div>
  );
}
