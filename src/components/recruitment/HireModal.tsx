"use client";

import React, { useEffect, useState } from "react";
import { Alert, Button, Field, Input, Modal, Select } from "@/components/ui";
import { DatePicker } from "@/components/ui/DatePicker";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { CredentialDialog } from "@/components/CredentialDialog";

/**
 * Turns an accepted applicant into an employee. Shared by the vacancy board,
 * the applicant list and the applicant page so the hire flow is identical.
 */
export function HireModal({
  candidate,
  defaultPositionId,
  defaultJoinDate = "",
  onClose,
  onHired,
}: {
  candidate: { _id: string; name: string } | null;
  defaultPositionId: string;
  /** `YYYY-MM-DD`; usually the date the applicant said they can start. */
  defaultJoinDate?: string;
  onClose: () => void;
  onHired: (employeeId?: string) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    branchId: "",
    divisionId: "",
    positionId: "",
    joinDate: "",
    officeEmail: "",
    employmentStatus: "probation",
    roleId: "",
  });
  const [opts, setOpts] = useState<{
    branches: Array<{ _id: string; name: string }>;
    divisions: Array<{ _id: string; name: string }>;
    positions: Array<{ _id: string; name: string }>;
    roles: Array<{ _id: string; name: string }>;
  }>({ branches: [], divisions: [], positions: [], roles: [] });
  const [saving, setSaving] = useState(false);
  const [credential, setCredential] = useState<{ email: string; password: string; name?: string } | null>(null);

  useEffect(() => {
    if (!candidate) return;
    setForm({
      branchId: "",
      divisionId: "",
      positionId: defaultPositionId,
      joinDate: defaultJoinDate,
      officeEmail: "",
      employmentStatus: "probation",
      roleId: "",
    });
    void (async () => {
      try {
        const [b, d, p, r] = await Promise.all([
          api.get<Array<{ _id: string; name: string }>>("/api/v1/branches"),
          api.get<Array<{ _id: string; name: string }>>("/api/v1/divisions"),
          api.get<Array<{ _id: string; name: string }>>("/api/v1/positions"),
          api.get<{ roles: Array<{ _id: string; name: string }> }>("/api/v1/roles"),
        ]);
        setOpts({
          branches: b.data ?? [],
          divisions: d.data ?? [],
          positions: p.data ?? [],
          roles: r.data?.roles ?? [],
        });
      } catch {
        // Selects stay empty; the server validates the required ids anyway.
      }
    })();
  }, [candidate, defaultPositionId, defaultJoinDate]);

  // The credential dialog outlives the hire form, which closes as soon as the
  // hire succeeds.
  if (!candidate) return <CredentialDialog credential={credential} onClose={() => setCredential(null)} />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.put<{ employee: string; generatedPassword: string | null }>("/api/v1/candidates", {
        id: candidate._id,
        ...form,
      });
      toast.success("Karyawan dibuat", res.message);
      if (res.data?.generatedPassword) {
        setCredential({ email: form.officeEmail, password: res.data.generatedPassword, name: candidate.name });
      }
      onHired(res.data?.employee);
    } catch (err) {
      toast.error("Gagal memproses", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Terima ${candidate.name} sebagai karyawan`}
      description="Data dari lamaran dipindahkan ke kartu karyawan baru berstatus onboarding."
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button size="sm" type="submit" form="hire-form" loading={saving}>
            Buat karyawan
          </Button>
        </>
      }
    >
      <form id="hire-form" onSubmit={submit} className="space-y-4">
        <Alert tone="info">
          Nama, email pribadi, telepon, alamat, tanggal lahir, jenis kelamin, dan dokumen lamaran (CV,
          portofolio, lampiran) ikut dipindahkan. NIK, NPWP, rekening, dan kontrak dibiarkan kosong; karyawan
          ini ditandai <strong>Baru</strong> di Data Karyawan sampai HRD melengkapinya.
        </Alert>

        <Field
          label="Email kantor"
          required
          htmlFor="hr-email"
          hint="Dipakai sebagai email login. Harus berbeda dari email pribadi pelamar."
        >
          <Input
            id="hr-email"
            type="email"
            required
            value={form.officeEmail}
            onChange={(e) => setForm({ ...form, officeEmail: e.target.value })}
            placeholder="nama@perusahaan.com"
          />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Cabang" required htmlFor="hr-branch">
            <Select
              id="hr-branch"
              required
              value={form.branchId}
              onChange={(e) => setForm({ ...form, branchId: e.target.value })}
            >
              <option value="">Pilih cabang…</option>
              {opts.branches.map((o) => (
                <option key={o._id} value={o._id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Divisi" required htmlFor="hr-division">
            <Select
              id="hr-division"
              required
              value={form.divisionId}
              onChange={(e) => setForm({ ...form, divisionId: e.target.value })}
            >
              <option value="">Pilih divisi…</option>
              {opts.divisions.map((o) => (
                <option key={o._id} value={o._id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Jabatan" required htmlFor="hr-position">
            <Select
              id="hr-position"
              required
              value={form.positionId}
              onChange={(e) => setForm({ ...form, positionId: e.target.value })}
            >
              <option value="">Pilih jabatan…</option>
              {opts.positions.map((o) => (
                <option key={o._id} value={o._id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tanggal mulai kerja" required htmlFor="hr-join">
            <DatePicker
              id="hr-join"
              required
              value={form.joinDate}
              onChange={(value) => setForm({ ...form, joinDate: value })}
            />
          </Field>
          <Field label="Status kepegawaian" htmlFor="hr-emp">
            <Select
              id="hr-emp"
              value={form.employmentStatus}
              onChange={(e) => setForm({ ...form, employmentStatus: e.target.value })}
            >
              <option value="probation">Masa percobaan</option>
              <option value="pkwt">PKWT (kontrak)</option>
              <option value="pkwtt">PKWTT (tetap)</option>
              <option value="magang">Magang</option>
              <option value="harian_lepas">Harian lepas</option>
              <option value="paruh_waktu">Paruh waktu</option>
              <option value="outsource">Outsource</option>
            </Select>
          </Field>
          <Field
            label="Peran akun"
            htmlFor="hr-role"
            hint="Kosongkan bila akun login dibuat belakangan."
          >
            <Select
              id="hr-role"
              value={form.roleId}
              onChange={(e) => setForm({ ...form, roleId: e.target.value })}
            >
              <option value="">Belum dibuatkan akun</option>
              {opts.roles.map((o) => (
                <option key={o._id} value={o._id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </form>
    </Modal>
  );
}
