"use client";

import React, { useEffect, useState } from "react";
import { Button, Field, Input, Modal, Toggle } from "@/components/ui";
import { Combobox } from "@/components/ui/Combobox";
import { FileOrLinkInput, attachmentProblem, toAttachmentInputs, type AttachmentItem } from "@/components/ui/FileOrLinkInput";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";

const PERIOD_TYPES = [
  { value: "monthly", label: "Bulanan", example: "2026-09" },
  { value: "quarterly", label: "Kuartal", example: "2026-Q3" },
  { value: "semester", label: "Semester", example: "2026-S2" },
  { value: "annual", label: "Tahunan", example: "2026" },
];

/** Attaches an appraisal made outside the system as a PDF for one employee. */
export function UploadEvaluationDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [employees, setEmployees] = useState<Array<{ _id: string; name: string; employeeId: string }>>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [periodType, setPeriodType] = useState("quarterly");
  const [period, setPeriod] = useState("");
  const [title, setTitle] = useState("Penilaian kinerja");
  const [file, setFile] = useState<AttachmentItem[]>([]);
  const [score, setScore] = useState("");
  const [grade, setGrade] = useState("");
  const [notes, setNotes] = useState("");
  const [share, setShare] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<typeof employees>("/api/v1/employees?status=active&limit=500").then((r) => setEmployees(r.data ?? [])).catch(() => {});
  }, []);

  const example = PERIOD_TYPES.find((p) => p.value === periodType)?.example ?? "";

  const save = async () => {
    const problem = attachmentProblem(file);
    if (problem) return toast.error("Berkas belum siap", problem);
    setSaving(true);
    try {
      const res = await api.post("/api/v1/kpi/evaluations/upload", {
        employeeId,
        periodType,
        period: period.trim(),
        title,
        file: toAttachmentInputs(file)[0],
        finalScore: score ? Number(score.replace(",", ".")) : null,
        gradeLabel: grade,
        notes,
        share,
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
      title="Unggah penilaian (PDF)"
      description="Untuk penilaian yang dibuat dengan formulir perusahaan sendiri. Alurnya sama: karyawan membaca, menanggapi, lalu HRD memfinalkan."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button size="sm" loading={saving} disabled={!employeeId || !period.trim() || !file.length} onClick={save}>
            {share ? "Unggah & bagikan" : "Simpan draf"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Karyawan" required>
          <Combobox value={employeeId} onChange={setEmployeeId} options={employees.map((e) => ({ value: e._id, label: e.name, hint: e.employeeId }))} placeholder="Pilih karyawan…" sheetTitle="Karyawan" />
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Jenis periode">
            <Combobox value={periodType} onChange={setPeriodType} options={PERIOD_TYPES.map((p) => ({ value: p.value, label: p.label }))} />
          </Field>
          <Field label="Periode" required hint={`Contoh: ${example}`}>
            <Input value={period} onChange={(e) => setPeriod(e.target.value.toUpperCase())} placeholder={example} maxLength={10} />
          </Field>
        </div>
        <Field label="Judul dokumen" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Berkas penilaian (PDF)" required>
          <FileOrLinkInput value={file} onChange={setFile} context="document" allowLink={false} />
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nilai akhir (0–100)" hint="Opsional, agar masuk ringkasan kinerja.">
            <Input inputMode="decimal" value={score} onChange={(e) => setScore(e.target.value.replace(/[^\d.,]/g, "").slice(0, 5))} />
          </Field>
          <Field label="Predikat" hint="Opsional, misalnya Baik.">
            <Input value={grade} onChange={(e) => setGrade(e.target.value)} maxLength={40} />
          </Field>
        </div>
        <Field label="Catatan">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </Field>
        <Toggle checked={share} onChange={setShare} label="Langsung bagikan ke karyawan" description="Karyawan menerima notifikasi dan dapat menanggapi." />
      </div>
    </Modal>
  );
}
