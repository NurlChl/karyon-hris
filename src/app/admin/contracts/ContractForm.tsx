"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Alert, Button, Field, Input, Modal, Toggle } from "@/components/ui";
import { Combobox } from "@/components/ui/Combobox";
import { DatePicker } from "@/components/ui/DatePicker";
import { FileOrLinkInput, attachmentProblem, toAttachmentInputs, type AttachmentItem } from "@/components/ui/FileOrLinkInput";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { CONTRACT_TYPES, CONTRACT_TYPE_MAP, durationLabel, type ContractType } from "@/lib/hr/contracts";

export interface ContractFormInitial {
  employeeId?: string;
  employeeName?: string;
  type?: ContractType;
  customTypeLabel?: string;
  startDate?: string;
  endDate?: string;
  positionName?: string;
  basicSalary?: number;
  allowances?: number;
  templateId?: string;
  previousContractId?: string;
  /** Heading shown in the modal, e.g. "Perpanjang kontrak". */
  title?: string;
  note?: string;
}

interface TemplateOption {
  _id: string;
  name: string;
  type: string;
  isActive: boolean;
}

function addMonths(key: string, months: number) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, d));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function Rupiah({ id, value, onChange }: { id: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-body-sm text-subtle pointer-events-none">Rp</span>
      <Input
        id={id}
        inputMode="numeric"
        className="pl-10 tabular-nums"
        value={value ? value.toLocaleString("id-ID") : ""}
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "").slice(0, 13)) || 0)}
      />
    </div>
  );
}

export function ContractForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: ContractFormInitial;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const toast = useToast();
  const [employees, setEmployees] = useState<Array<{ _id: string; name: string; employeeId: string }>>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [employeeId, setEmployeeId] = useState(initial.employeeId ?? "");
  const [type, setType] = useState<ContractType>(initial.type ?? "pkwt");
  const [customTypeLabel, setCustomTypeLabel] = useState(initial.customTypeLabel ?? "");
  const [startDate, setStartDate] = useState(initial.startDate ?? "");
  const [endDate, setEndDate] = useState(initial.endDate ?? "");
  const [positionName, setPositionName] = useState(initial.positionName ?? "");
  const [basicSalary, setBasicSalary] = useState(initial.basicSalary ?? 0);
  const [allowances, setAllowances] = useState(initial.allowances ?? 0);
  const [templateId, setTemplateId] = useState(initial.templateId ?? "");
  const [draft, setDraft] = useState(false);
  const [updateEmployeeStatus, setUpdateEmployeeStatus] = useState(true);
  const [signed, setSigned] = useState<AttachmentItem[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!initial.employeeId) {
      api.get<typeof employees>("/api/v1/employees?limit=500").then((r) => setEmployees(r.data ?? [])).catch(() => {});
    }
    api.get<TemplateOption[]>("/api/v1/contracts/templates").then((r) => setTemplates(r.data ?? [])).catch(() => {});
  }, [initial.employeeId]);

  // Pick the template made for this type, unless one was chosen already.
  useEffect(() => {
    if (templateId || !templates.length) return;
    const match = templates.find((t) => t.isActive && t.type === type);
    if (match) setTemplateId(match._id);
  }, [templates, type, templateId]);

  const hasEnd = CONTRACT_TYPE_MAP[type].hasEndDate;
  const duration = useMemo(() => (startDate && hasEnd && endDate ? durationLabel(startDate, endDate) : ""), [startDate, endDate, hasEnd]);

  const save = async () => {
    const problem = attachmentProblem(signed);
    if (problem) {
      toast.error("Berkas belum siap", problem);
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{ _id: string }>("/api/v1/contracts", {
        employeeId,
        type,
        customTypeLabel,
        startDate,
        endDate: hasEnd ? endDate : "",
        positionName,
        basicSalary,
        allowances,
        templateId,
        notes,
        status: draft ? "draft" : "active",
        previousContractId: initial.previousContractId ?? "",
        updateEmployeeStatus,
        signed: toAttachmentInputs(signed)[0],
      });
      toast.success("Tersimpan", res.message);
      onSaved(res.data!._id);
    } catch (err) {
      toast.error("Gagal menyimpan kontrak", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={initial.title ?? "Buat kontrak"}
      description={initial.employeeName ? `Untuk ${initial.employeeName}` : undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button size="sm" loading={saving} onClick={save} disabled={!employeeId || !startDate || (hasEnd && !endDate)}>
            {draft ? "Simpan draf" : "Simpan & berlakukan"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {initial.note && <Alert tone="info">{initial.note}</Alert>}

        <div className="grid sm:grid-cols-2 gap-4">
          {!initial.employeeId && (
            <Field label="Karyawan" required className="sm:col-span-2">
              <Combobox
                value={employeeId}
                onChange={setEmployeeId}
                options={employees.map((e) => ({ value: e._id, label: e.name, hint: e.employeeId }))}
                placeholder="Pilih karyawan…"
                sheetTitle="Karyawan"
              />
            </Field>
          )}
          <Field label="Jenis kontrak" required hint={CONTRACT_TYPE_MAP[type].hint}>
            <Combobox
              value={type}
              onChange={(v) => {
                setType(v as ContractType);
                setTemplateId("");
              }}
              options={CONTRACT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            />
          </Field>
          {type === "lainnya" ? (
            <Field label="Nama jenis" required>
              <Input maxLength={60} value={customTypeLabel} onChange={(e) => setCustomTypeLabel(e.target.value)} placeholder="Contoh: Kontrak proyek" />
            </Field>
          ) : (
            <Field label="Jabatan dalam kontrak" hint="Kosong = jabatan karyawan saat ini.">
              <Input maxLength={120} value={positionName} onChange={(e) => setPositionName(e.target.value)} />
            </Field>
          )}

          <Field label="Tanggal mulai" required>
            <DatePicker value={startDate} onChange={setStartDate} />
          </Field>
          {hasEnd ? (
            <Field label="Tanggal berakhir" required hint={duration ? `Lama kontrak ${duration}.` : undefined}>
              <DatePicker value={endDate} onChange={setEndDate} min={startDate || undefined} />
              {startDate && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[3, 6, 12, 24].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setEndDate(addMonths(startDate, m))}
                      className="px-2.5 py-1 rounded-full border border-line text-label hover:border-primary hover:text-primary transition-colors cursor-pointer"
                    >
                      {m < 12 ? `${m} bulan` : `${m / 12} tahun`}
                    </button>
                  ))}
                </div>
              )}
            </Field>
          ) : (
            <Alert tone="info" className="self-end">
              Karyawan tetap tidak punya tanggal berakhir, jadi tidak masuk daftar kontrak yang akan habis.
            </Alert>
          )}

          <Field label="Gaji pokok" hint="Dipakai payroll sebagai gaji pokok selama kontrak berlaku.">
            <Rupiah id="ct-basic" value={basicSalary} onChange={setBasicSalary} />
          </Field>
          <Field label="Tunjangan tetap">
            <Rupiah id="ct-allow" value={allowances} onChange={setAllowances} />
          </Field>

          <Field label="Template dokumen" className="sm:col-span-2" hint="Isi dokumen bisa diubah setelah kontrak dibuat. Kosongkan bila hanya mengunggah kontrak yang sudah jadi.">
            <Combobox
              value={templateId}
              onChange={setTemplateId}
              options={templates.filter((t) => t.isActive).map((t) => ({ value: t._id, label: t.name, hint: CONTRACT_TYPE_MAP[t.type as ContractType]?.label }))}
              placeholder="Tanpa template"
              clearable
            />
          </Field>

          <Field label="Kontrak yang sudah ditandatangani" className="sm:col-span-2" hint="Opsional. Bisa juga diunggah nanti setelah dicetak dan ditandatangani.">
            <FileOrLinkInput value={signed} onChange={setSigned} context="contract" disabled={saving} />
          </Field>

          <Field label="Catatan internal" className="sm:col-span-2">
            <Input maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        <div className="pt-4 border-t border-line grid sm:grid-cols-2 gap-4">
          <Toggle checked={draft} onChange={setDraft} label="Simpan sebagai draf" description="Belum berlaku; bisa diubah dan dicetak untuk ditinjau." />
          <Toggle
            checked={updateEmployeeStatus}
            onChange={setUpdateEmployeeStatus}
            label="Perbarui status kepegawaian"
            description="Status karyawan mengikuti jenis kontrak ini saat berlaku."
          />
        </div>
      </div>
    </Modal>
  );
}
