"use client";

import React, { useEffect, useState } from "react";
import { Alert, Button, Field, Modal, SkeletonList, Textarea } from "@/components/ui";
import { Combobox } from "@/components/ui/Combobox";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError, errorMessage } from "@/lib/client-api";
import type { FormField } from "@/lib/hr/application-form";
import {
  ApplicationFormRenderer,
  focusFirstError,
  initialValues,
  prepareAnswers,
  serverFieldErrors,
  type FormErrors,
  type FormValues,
  type RenderField,
} from "./ApplicationFormRenderer";

const CONTACT_KEYS = ["name", "email", "phone"];

/**
 * Adds an applicant who came through another channel, using the vacancy's own
 * application form. Only name, email and phone are required here: staff often
 * have little more than a referral's contact details.
 */
export function AddCandidateModal({
  open,
  vacancyId: fixedVacancyId,
  vacancies,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Set on a vacancy's board; otherwise the vacancy is picked in the modal. */
  vacancyId?: string;
  vacancies?: Array<{ _id: string; title: string }>;
  onClose: () => void;
  onSaved: (candidateId?: string) => void;
}) {
  const toast = useToast();
  const [vacancyId, setVacancyId] = useState(fixedVacancyId ?? "");
  const [fields, setFields] = useState<RenderField[] | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [note, setNote] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVacancyId(fixedVacancyId ?? "");
    setNote("");
    setErrors({});
  }, [open, fixedVacancyId]);

  useEffect(() => {
    if (!open || !vacancyId) {
      setFields(null);
      return;
    }
    let cancelled = false;
    setLoadError("");
    setFields(null);
    api
      .get<{ fields: FormField[] }>(`/api/v1/vacancies/${vacancyId}/form`)
      .then((res) => {
        if (cancelled) return;
        const next = (res.data?.fields ?? [])
          .filter((f) => f.enabled)
          .map((f) => ({ ...f, required: CONTACT_KEYS.includes(f.system ?? "") }));
        setFields(next);
        setValues(initialValues(next));
      })
      .catch((err) => !cancelled && setLoadError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [open, vacancyId]);

  const submit = async () => {
    if (!fields) return;
    const { answers, errors: found } = prepareAnswers(fields, values);
    setErrors(found);
    if (Object.keys(found).length) {
      focusFirstError(found, fields);
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{ _id: string }>("/api/v1/candidates", {
        vacancyId,
        answers,
        note: note.trim() || undefined,
      });
      toast.success("Pelamar ditambahkan", res.message);
      onSaved(res.data?._id);
    } catch (err) {
      const fieldErrors = err instanceof ApiError ? serverFieldErrors(err.details) : {};
      if (Object.keys(fieldErrors).length) setErrors(fieldErrors);
      toast.error("Gagal menambahkan", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tambah pelamar manual"
      description="Untuk lamaran dari jalur lain, misalnya referensi karyawan, walk-in, atau job fair. Hanya nama, email, dan telepon yang wajib."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button size="sm" onClick={submit} loading={saving} disabled={!fields}>
            Tambahkan
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {!fixedVacancyId && (
          <Field label="Lowongan" required htmlFor="ac-vacancy">
            <Combobox
              id="ac-vacancy"
              value={vacancyId}
              onChange={setVacancyId}
              options={(vacancies ?? []).map((v) => ({ value: v._id, label: v.title }))}
              placeholder="Pilih lowongan…"
              sheetTitle="Lowongan"
            />
          </Field>
        )}

        {loadError ? (
          <Alert tone="danger">{loadError}</Alert>
        ) : !vacancyId ? (
          <p className="text-body-sm text-muted">Pilih lowongan dulu untuk memuat formulirnya.</p>
        ) : !fields ? (
          <SkeletonList rows={3} />
        ) : (
          <>
            <ApplicationFormRenderer
              fields={fields}
              values={values}
              errors={errors}
              disabled={saving}
              idPrefix="ac"
              onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
            />
            <Field label="Catatan internal" htmlFor="ac-note" hint="Tidak terlihat pelamar. Misalnya siapa yang mereferensikan.">
              <Textarea id="ac-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
