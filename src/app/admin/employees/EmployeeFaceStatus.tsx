"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { RotateCcw, ScanFace } from "lucide-react";
import { Badge, Button, Field, Modal, Textarea, ICON_STROKE } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate, formatRelative } from "@/lib/time";

interface FaceAdminStatus {
  enrolled: boolean;
  enrolledAt: string | null;
  source: "self" | "change_request" | null;
  lastVerifiedAt: string | null;
  pendingChange: boolean;
  referencePhotoUrl: string;
}

/** Only these two roles may see or reset biometric data; the API agrees. */
const FACE_ADMIN_ROLES = ["SUPERADMIN", "HRD"];

/**
 * Face enrolment status inside the employee form, with a reset for HR.
 *
 * Renders nothing for roles that may not handle face data, rather than a panel
 * that would only answer every action with "forbidden".
 */
export function EmployeeFaceStatus({ employeeId }: { employeeId: string }) {
  const { data: session } = useSession();
  const toast = useToast();
  const allowed = FACE_ADMIN_ROLES.includes(session?.user?.role ?? "");

  const [status, setStatus] = useState<FaceAdminStatus | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<FaceAdminStatus>(`/api/v1/face/admin?employeeId=${employeeId}`);
      setStatus(res.data ?? null);
    } catch {
      setStatus(null);
    }
  }, [employeeId]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  if (!allowed || !status) return null;

  const reset = async () => {
    setBusy(true);
    try {
      const res = await api.delete(
        `/api/v1/face/admin?employeeId=${employeeId}&reason=${encodeURIComponent(reason.trim())}`
      );
      toast.success("Data wajah direset", res.message ?? "");
      setResetOpen(false);
      setReason("");
      await load();
    } catch (err) {
      toast.error("Gagal mereset", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-label font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-line">
        <ScanFace className="w-4 h-4" strokeWidth={ICON_STROKE} /> Wajah Presensi
      </h3>

      <div className="flex items-start gap-4">
        {status.referencePhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={status.referencePhotoUrl}
            alt="Foto acuan wajah karyawan"
            className="w-20 h-20 rounded-lg object-cover border border-line shrink-0"
          />
        ) : (
          <div className="w-20 h-20 rounded-lg border border-dashed border-line grid place-items-center shrink-0">
            <ScanFace className="w-6 h-6 text-subtle" strokeWidth={ICON_STROKE} />
          </div>
        )}

        <div className="flex-1 min-w-0 space-y-1.5 text-label">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.enrolled ? "success" : "neutral"} dot>
              {status.enrolled ? "Terdaftar" : "Belum terdaftar"}
            </Badge>
            {status.pendingChange && <Badge tone="warning">Penggantian menunggu SPV</Badge>}
          </div>
          {status.enrolled && (
            <>
              <p className="text-muted">
                Didaftarkan {status.enrolledAt ? formatDate(status.enrolledAt) : "-"}
                {status.source === "change_request" && " (lewat penggantian yang disetujui)"}
              </p>
              <p className="text-muted">
                Terakhir cocok saat absen:{" "}
                {status.lastVerifiedAt ? formatRelative(status.lastVerifiedAt) : "belum pernah"}
              </p>
            </>
          )}
          {(status.enrolled || status.pendingChange) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={RotateCcw}
              className="text-danger -ml-2"
              onClick={() => setResetOpen(true)}
            >
              Reset data wajah
            </Button>
          )}
        </div>
      </div>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset data wajah karyawan?"
        description="Foto acuan dan data wajah dihapus. Karyawan harus mendaftar ulang sebelum dapat absen bila verifikasi wajah aktif. Pendaftaran ulangnya akan diberitahukan ke atasannya."
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>
              Batal
            </Button>
            <Button
              variant="danger"
              icon={RotateCcw}
              loading={busy}
              disabled={reason.trim().length < 10}
              onClick={reset}
            >
              Reset
            </Button>
          </>
        }
      >
        <Field
          label="Alasan reset"
          required
          htmlFor="face-reset-reason"
          hint="Tercatat di jejak audit dan dikirim ke karyawan. Minimal 10 karakter."
        >
          <Textarea
            id="face-reset-reason"
            value={reason}
            maxLength={300}
            className="min-h-20"
            placeholder="Misalnya: foto acuan bukan wajah karyawan ini, atau karyawan meminta datanya dihapus"
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </Modal>
    </div>
  );
}
