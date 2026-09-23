"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  CircleCheck,
  Clock,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  TriangleAlert,
  X,
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
  SkeletonList,
  Textarea,
  cn,
  ICON_STROKE,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate, formatRelative } from "@/lib/time";
import { SelfieCapture } from "./SelfieCapture";

interface FaceStatus {
  enabled: boolean;
  samplesRequired: number;
  consent: { version: string; points: string[] };
  profile: {
    enrolledAt: string;
    updatedAt: string;
    source: "self" | "change_request";
    lastVerifiedAt: string | null;
    consentOutdated: boolean;
    referencePhotoUrl: string;
  } | null;
  pendingRequest: {
    createdAt: string;
    reason: string;
    canCancel: boolean;
    referencePhotoUrl: string;
  } | null;
  lastDecision: { status: "approved" | "rejected"; decidedAt: string | null; note: string } | null;
}

/** What each shot asks for. Small changes of angle make the enrolled face
 *  match later selfies taken on a different day and under different light. */
const SHOT_GUIDE = [
  "Wajah menghadap lurus ke kamera",
  "Tolehkan wajah sedikit ke kiri",
  "Tolehkan wajah sedikit ke kanan",
];

/**
 * Employee-facing face enrolment.
 *
 * Three states: nothing enrolled (enrol directly), enrolled (view, or request a
 * replacement that the supervisor approves), and a replacement waiting.
 */
export function FaceEnrollment() {
  const toast = useToast();
  const [status, setStatus] = useState<FaceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [capturing, setCapturing] = useState(false);
  const [photos, setPhotos] = useState<Array<string | null>>([]);
  const [consented, setConsented] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<FaceStatus>("/api/v1/face");
      setStatus(res.data ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const beginCapture = () => {
    if (!status) return;
    setPhotos(Array(status.samplesRequired).fill(null));
    setConsented(false);
    setReason("");
    setCapturing(true);
  };

  const abortCapture = () => {
    setCapturing(false);
    setPhotos([]);
  };

  const current = photos.findIndex((p) => p === null);
  const allTaken = photos.length > 0 && current === -1;
  const isReplacement = Boolean(status?.profile);

  const submit = async () => {
    if (!status || !allTaken || !consented) return;
    setSubmitting(true);
    try {
      const res = await api.post("/api/v1/face", {
        photos,
        consent: true,
        consentVersion: status.consent.version,
        reason: isReplacement ? reason.trim() : undefined,
      });
      toast.success("Permintaan wajah dikirim", res.message ?? "");
      abortCapture();
      await load();
    } catch (err) {
      // Quality problems name the photo number; keep the photos so only the
      // offending one needs retaking.
      toast.error(isReplacement ? "Permintaan belum terkirim" : "Pendaftaran gagal", errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const cancelRequest = async () => {
    try {
      const res = await api.delete("/api/v1/face");
      toast.success("Dibatalkan", res.message ?? "");
      setConfirmCancel(false);
      await load();
    } catch (err) {
      toast.error("Gagal membatalkan", errorMessage(err));
    }
  };

  if (loading) return <SkeletonList rows={3} />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!status) return null;

  /* ---------------- capture flow ---------------- */
  if (capturing) {
    return (
      <Card>
        <CardHeader
          icon={ScanFace}
          title={isReplacement ? "Ambil foto wajah pengganti" : "Daftarkan wajah"}
          description={`Ambil ${status.samplesRequired} foto di tempat yang terang, tanpa masker, kacamata hitam, atau topi.`}
          actions={
            <Button variant="ghost" size="sm" icon={X} onClick={abortCapture} disabled={submitting}>
              Batal
            </Button>
          }
        />
        <CardBody className="space-y-5">
          <ol className="grid grid-cols-3 gap-2">
            {photos.map((photo, i) => (
              <li key={i} className="space-y-1.5">
                <div
                  className={cn(
                    "relative aspect-square rounded-[var(--radius-control)] border overflow-hidden grid place-items-center",
                    i === current ? "border-primary bg-primary-soft" : "border-line bg-surface-2"
                  )}
                >
                  {photo ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => setPhotos((prev) => prev.map((p, j) => (j === i ? null : p)))}
                        aria-label={`Ambil ulang foto ${i + 1}`}
                        className="absolute top-1 right-1 p-1 rounded-md bg-black/55 text-white hover:bg-black/75"
                      >
                        <RefreshCw className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
                      </button>
                    </>
                  ) : (
                    <span className="text-label font-semibold text-subtle tabular-nums">{i + 1}</span>
                  )}
                </div>
                <p className="text-caption text-muted leading-snug">{SHOT_GUIDE[i] ?? `Foto ${i + 1}`}</p>
              </li>
            ))}
          </ol>

          {current !== -1 && (
            <div className="space-y-2">
              <p className="text-body-sm font-medium text-foreground">
                Foto {current + 1} dari {photos.length}: {SHOT_GUIDE[current]}
              </p>
              <SelfieCapture
                key={current}
                photo={null}
                autoStart={photos.some(Boolean)}
                idleHint="Nyalakan kamera, posisikan wajah di tengah bingkai, lalu ambil foto."
                onCapture={(dataUrl) =>
                  setPhotos((prev) => prev.map((p, j) => (j === current ? dataUrl : p)))
                }
                onClear={() => {}}
                disabled={submitting}
              />
            </div>
          )}

          {allTaken && (
            <>
              {isReplacement && (
                <Field
                  label="Alasan penggantian"
                  required
                  htmlFor="face-reason"
                  hint="Dibaca atasan Anda saat memutuskan. Minimal 10 karakter."
                >
                  <Textarea
                    id="face-reason"
                    value={reason}
                    maxLength={500}
                    className="min-h-20"
                    placeholder="Misalnya: penampilan berubah setelah potong rambut, foto lama kurang jelas"
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
              )}

              <div className="rounded-[var(--radius-control)] border border-line p-4 space-y-3">
                <p className="text-body-sm font-medium text-foreground flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-primary" strokeWidth={ICON_STROKE} />
                  Persetujuan pengolahan data wajah
                </p>
                <ul className="space-y-1.5 text-body-sm text-muted leading-relaxed list-disc pl-5">
                  {status.consent.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consented}
                    onChange={(e) => setConsented(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-line accent-[var(--primary)] cursor-pointer"
                  />
                  <span className="text-body-sm text-foreground leading-relaxed">
                    Saya telah membaca dan menyetujui pengolahan data wajah saya sebagaimana di atas.
                  </span>
                </label>
              </div>

              <Button
                className="w-full justify-center"
                icon={ScanFace}
                loading={submitting}
                disabled={!consented || (isReplacement && reason.trim().length < 10)}
                onClick={submit}
              >
                {submitting
                  ? "Memeriksa wajah…"
                  : isReplacement
                    ? "Kirim permintaan ke atasan"
                    : "Daftarkan wajah"}
              </Button>
            </>
          )}
        </CardBody>
      </Card>
    );
  }

  /* ---------------- status ---------------- */
  return (
    <div className="space-y-5">
      {status.enabled && !status.profile && (
        <Alert tone="warning" title="Wajah belum terdaftar">
          Perusahaan mewajibkan verifikasi wajah saat presensi. Anda belum dapat absen sampai wajah
          didaftarkan.
        </Alert>
      )}
      {!status.enabled && (
        <Alert tone="info" title="Verifikasi wajah belum diaktifkan">
          Anda sudah dapat mendaftarkan wajah sekarang. Wajah baru dipakai untuk mencocokkan foto
          presensi setelah HRD mengaktifkan fitur ini.
        </Alert>
      )}

      {status.lastDecision?.status === "rejected" && !status.pendingRequest && (
        <Alert tone="danger" title="Permintaan penggantian wajah terakhir ditolak">
          {status.lastDecision.note ? `Catatan atasan: ${status.lastDecision.note}` : "Tanpa catatan."}
          {status.lastDecision.decidedAt && ` (${formatDate(status.lastDecision.decidedAt)})`}
        </Alert>
      )}

      <Card>
        <CardHeader
          icon={ScanFace}
          title="Wajah presensi"
          description="Foto presensi dicocokkan dengan wajah yang Anda daftarkan di sini."
        />
        <CardBody>
          {status.profile ? (
            <div className="flex flex-col sm:flex-row gap-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={status.profile.referencePhotoUrl}
                alt="Foto acuan wajah Anda"
                className="w-32 h-32 rounded-[var(--radius)] object-cover border border-line shrink-0"
              />
              <div className="flex-1 min-w-0 space-y-3">
                <Badge tone="success" dot>
                  Terdaftar
                </Badge>
                <dl className="grid gap-2 text-body-sm">
                  <div className="flex gap-2">
                    <dt className="text-muted w-40 shrink-0">Didaftarkan</dt>
                    <dd className="text-foreground">{formatDate(status.profile.enrolledAt)}</dd>
                  </div>
                  {status.profile.source === "change_request" && (
                    <div className="flex gap-2">
                      <dt className="text-muted w-40 shrink-0">Terakhir diganti</dt>
                      <dd className="text-foreground">{formatDate(status.profile.updatedAt)}</dd>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <dt className="text-muted w-40 shrink-0">Terakhir cocok saat absen</dt>
                    <dd className="text-foreground">
                      {status.profile.lastVerifiedAt ? formatRelative(status.profile.lastVerifiedAt) : "Belum pernah"}
                    </dd>
                  </div>
                </dl>

                {!status.pendingRequest && (
                  <Button variant="secondary" size="sm" icon={RefreshCw} onClick={beginCapture}>
                    Ajukan penggantian wajah
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-6 space-y-4">
              <div className="w-14 h-14 mx-auto grid place-items-center rounded-full bg-primary-soft">
                <ScanFace className="w-7 h-7 text-primary" strokeWidth={ICON_STROKE} />
              </div>
              <div className="max-w-md mx-auto space-y-1.5">
                <p className="text-body font-medium text-foreground">Wajah belum didaftarkan</p>
                <p className="text-body-sm text-muted leading-relaxed">
                  Pendaftaran pertama memerlukan persetujuan atasan. Setelah terdaftar, penggantian
                  wajah perlu disetujui atasan Anda.
                </p>
              </div>
              <Button icon={ScanFace} onClick={beginCapture}>
                Daftarkan wajah
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      {status.pendingRequest && (
        <Card>
          <CardHeader
            icon={Clock}
            title="Permintaan penggantian menunggu persetujuan"
            description={`Diajukan ${formatRelative(status.pendingRequest.createdAt)}. Selama menunggu, presensi tetap memakai wajah yang lama.`}
          />
          <CardBody className="flex flex-col sm:flex-row gap-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={status.pendingRequest.referencePhotoUrl}
              alt="Foto wajah pengganti yang diajukan"
              className="w-32 h-32 rounded-[var(--radius)] object-cover border border-line shrink-0"
            />
            <div className="flex-1 min-w-0 space-y-3">
              <p className="text-body-sm text-muted">
                <span className="text-foreground font-medium">Alasan:</span> {status.pendingRequest.reason}
              </p>
              {status.pendingRequest.canCancel ? (
                <Button variant="ghost" size="sm" icon={X} className="text-danger" onClick={() => setConfirmCancel(true)}>
                  Batalkan permintaan
                </Button>
              ) : (
                <p className="text-label text-subtle flex items-center gap-1.5">
                  <TriangleAlert className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
                  Sudah mulai diproses atasan, tidak dapat dibatalkan.
                </p>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="space-y-2">
          <p className="text-body-sm font-medium text-foreground flex items-center gap-2">
            <CircleCheck className="w-4 h-4 text-success" strokeWidth={ICON_STROKE} />
            Tips agar wajah cepat dikenali
          </p>
          <ul className="text-body-sm text-muted leading-relaxed list-disc pl-5 space-y-1">
            <li>Absen di tempat yang cukup terang; hindari cahaya kuat dari belakang kepala.</li>
            <li>Pegang ponsel sejajar wajah, jangan terlalu jauh — wajah mengisi sebagian besar bingkai.</li>
            <li>Lepas masker dan kacamata hitam saat mengambil foto.</li>
            <li>Bila wajah terus ditolak padahal Anda sendiri, ajukan koreksi absen dan beri tahu atasan.</li>
          </ul>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={cancelRequest}
        tone="danger"
        title="Batalkan permintaan penggantian wajah?"
        message="Foto pengganti akan dihapus. Presensi tetap memakai wajah yang sudah terdaftar."
        confirmLabel="Batalkan permintaan"
      />
    </div>
  );
}
