"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ArrowUpCircle, CheckCircle2, Copy, KeyRound, Lock, RefreshCw, ShieldCheck, Terminal, Unplug } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, Field, Input, PageHeader, Skeleton } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";
import { invalidateLicense } from "@/lib/use-license";

type LicenseState = "active" | "expired" | "suspended" | "released" | null;
type Activation =
  | { activated: false; licenseState: LicenseState; keyHint?: string | null }
  | { activated: true; installationId: string; siteOrigin: string; plan: string | null; features: string[]; leaseExpiresAt: string | null; graceUntil: string | null; subscriptionExpiresAt: string | null; keyHint: string | null; licenseState: LicenseState; lastError: string | null; updatedAt: string };
type Snapshot = {
  plan: string; status: string; features: string[]; expiresAt: string | null; graceUntil: string | null; installationId: string | null; source: string;
  edition: "community" | "pro"; featureLabels: Record<string, string>; activation: Activation; licenseServer: string | null;
  upgrade?: { available: boolean; stage: string; code?: string };
};
type UpgradeCode = { code: string; expiresAt: string; command: string; localCommand: string };

const UPGRADING = ["validating", "downloading", "restarting", "checking", "rolling_back"];
const when = (value: string | null | undefined) => (value ? new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—");
const daysLeft = (value: string | null | undefined) => (value ? Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000) : null);

/** One status for the whole page, combining the running edition, the lease and the website's answer. */
function overallStatus(data: Snapshot): { label: string; tone: "success" | "warning" | "danger" | "neutral"; text: string } {
  const activation = data.activation;
  if (!activation.activated) {
    if (activation.licenseState === "released") return { label: "Lisensi dilepas", tone: "neutral", text: "Aplikasi berjalan dengan fitur Community. Masukkan license key untuk mengaktifkan Pro lagi." };
    return { label: "Community (gratis)", tone: "neutral", text: "Semua fitur inti aktif tanpa biaya. Masukkan license key untuk membuka fitur Pro." };
  }
  if (activation.licenseState === "suspended") return { label: "Ditangguhkan", tone: "danger", text: "Lisensi ditangguhkan pengelola. Aplikasi kembali ke fitur Community; data tetap aman. Hubungi billing atau masukkan license key lain." };
  if (activation.licenseState === "released") return { label: "Dilepas", tone: "danger", text: "Lisensi dilepas dari instalasi ini (misalnya dari dashboard pelanggan). Aplikasi kembali ke Community. Masukkan license key untuk mengaktifkan lagi." };
  if (data.edition === "community") return { label: "Lisensi tersimpan", tone: "warning", text: "License key valid, tetapi aplikasi masih edisi Community. Aktifkan fitur Pro di bawah." };
  if (data.status === "grace") return { label: "Masa tenggang", tone: "warning", text: `Server lisensi belum dapat dihubungi. Fitur Pro tetap aktif sampai ${when(data.graceUntil)}.` };
  if (data.status === "expired" || activation.licenseState === "expired") return { label: "Kedaluwarsa", tone: "danger", text: "Masa berlaku lisensi berakhir. Aplikasi otomatis kembali ke fitur Community tanpa kehilangan data. Perpanjang lisensi yang sama (aktif lagi otomatis dalam beberapa menit) atau masukkan license key baru." };
  return { label: "Pro aktif", tone: "success", text: "Seluruh fitur Pro dalam lisensi aktif." };
}

export default function LicensePage() {
  const router = useRouter();
  const toast = useToast();
  const { data: session } = useSession();
  const superadmin = session?.user?.role === "SUPERADMIN";
  const [data, setData] = useState<Snapshot | null>(null), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const [licenseKey, setLicenseKey] = useState(""), [busy, setBusy] = useState(""), [upgrade, setUpgrade] = useState<UpgradeCode | null>(null);
  const [replacing, setReplacing] = useState(false), [confirmRelease, setConfirmRelease] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const upgrading = !!data?.upgrade && UPGRADING.includes(data.upgrade.stage);

  useEffect(() => { let active = true; api.get<Snapshot>("/api/v1/license", { cache: "no-store" }).then((res) => { if (active) { setData(res.data ?? null); setError(""); } }).catch((err) => { if (active) setError(errorMessage(err)); }); return () => { active = false; }; }, [retry]);
  useEffect(() => { if (!upgrade) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [upgrade]);
  useEffect(() => {
    if (!upgrading) return;
    let active = true, inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return; inFlight = true;
      try { const response = await api.get<Snapshot>("/api/v1/license", { cache: "no-store" }); if (active && response.data) { setData(response.data); setError(""); if (response.data.edition === "pro" && ["active", "grace"].includes(response.data.status)) router.refresh(); } }
      catch { /* A brief restart is expected while the image switches. Keep the progress view. */ }
      finally { inFlight = false; }
    }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [upgrading, router]);

  const act = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    try {
      const res = await api.post<UpgradeCode & { activation?: Activation; upgrade?: Snapshot["upgrade"] }>("/api/v1/license", body);
      toast.success("Lisensi", res.message ?? "Berhasil");
      invalidateLicense();
      if (body.action === "upgrade-code" && res.data) setUpgrade(res.data);
      if (body.action === "activate") { setLicenseKey(""); setReplacing(false); }
      if (res.data?.upgrade) setData((current) => (current ? { ...current, upgrade: res.data!.upgrade, activation: res.data!.activation || current.activation } : current));
      if (["activate", "refresh", "deactivate"].includes(String(body.action))) router.refresh();
      if (!res.data?.upgrade || !UPGRADING.includes(res.data.upgrade.stage)) setRetry((n) => n + 1);
    } catch (err) { toast.error("Gagal", errorMessage(err)); setRetry((n) => n + 1); }
    finally { setBusy(""); }
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success("Disalin", "Tempel di terminal server HRIS."); } catch { toast.error("Tidak dapat menyalin", "Salin manual."); } };

  const activation = data?.activation;
  const status = data ? overallStatus(data) : null;
  const needsUpgrade = data?.edition === "community" && activation?.activated && activation.licenseState !== "suspended" && activation.licenseState !== "released";
  const secondsLeft = upgrade ? Math.max(0, Math.round((new Date(upgrade.expiresAt).getTime() - now) / 1000)) : 0;
  const lapsed = !!activation?.activated && (activation.licenseState !== "active" || data?.status === "expired");
  const showKeyForm = superadmin && (!activation?.activated || lapsed || replacing);
  const subscriptionDays = activation?.activated ? daysLeft(activation.subscriptionExpiresAt) : null;

  return (
    <div>
      <PageHeader title="Lisensi & Paket" description="Aktifkan, perpanjang, atau ganti lisensi HRIS Pro. Saat lisensi berakhir, aplikasi otomatis kembali ke Community tanpa kehilangan data." />
      {error ? <ErrorState message={error} onRetry={() => setRetry((n) => n + 1)} /> : !data || !status ? <Skeleton className="h-40" /> : (
        <div className="space-y-6">
          {upgrading && <Alert title="Sedang menyiapkan HRIS Pro"><span role="status" aria-live="polite">{({ validating: "Memeriksa lisensi…", downloading: "Mengunduh fitur Pro. HRIS tetap dapat digunakan selama proses ini.", restarting: "Mengaktifkan fitur Pro. Aplikasi akan tersambung kembali sebentar lagi.", checking: "Memastikan fitur Pro siap digunakan…", rolling_back: "Upgrade belum berhasil. Memulihkan aplikasi sebelumnya…" } as Record<string, string>)[data.upgrade!.stage]} Data Anda tetap tersimpan.</span></Alert>}
          {data.upgrade?.stage === "failed" && <Alert tone="warning" title="Upgrade belum selesai">{data.upgrade.code === "ROLLBACK_FAILED" ? "Aplikasi belum berhasil dipulihkan. Hubungi administrator server untuk memeriksa log instalasi." : "Fitur Pro belum berhasil diaktifkan. Periksa koneksi server lalu coba lagi. Data dan kunci instalasi tetap disimpan."}</Alert>}

          <Card>
            <CardHeader icon={ShieldCheck} title="Status lisensi" actions={<Badge tone={status.tone} dot>{status.label}</Badge>} />
            <CardBody className="space-y-5">
              <p className="text-body text-muted leading-relaxed">{status.text}</p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-[var(--radius-control)] bg-surface-2 p-4"><dt className="text-caption text-muted">Edisi aplikasi</dt><dd className="mt-1 text-body-lg font-semibold text-heading">{data.edition === "pro" ? "Pro" : "Community"}</dd></div>
                <div className="rounded-[var(--radius-control)] bg-surface-2 p-4"><dt className="text-caption text-muted">License key</dt><dd className="mt-1 text-body-lg font-semibold text-heading font-mono">{activation?.keyHint ? `…${activation.keyHint}` : "—"}</dd></div>
                <div className="rounded-[var(--radius-control)] bg-surface-2 p-4"><dt className="text-caption text-muted">Langganan berakhir</dt><dd className="mt-1 text-body font-semibold text-heading">{activation?.activated ? when(activation.subscriptionExpiresAt ?? activation.leaseExpiresAt) : "—"}{subscriptionDays !== null && subscriptionDays >= 0 && subscriptionDays <= 14 && <span className="block text-caption text-warning">{subscriptionDays} hari lagi</span>}</dd></div>
                <div className="rounded-[var(--radius-control)] bg-surface-2 p-4"><dt className="text-caption text-muted">Terikat ke website</dt><dd className="mt-1 text-body font-semibold text-heading break-all">{activation?.activated ? activation.siteOrigin : "—"}</dd></div>
              </dl>
              {activation?.activated && activation.lastError && lapsed && <Alert tone="warning" title="Jawaban server lisensi">{activation.lastError}</Alert>}
              {subscriptionDays !== null && subscriptionDays >= 0 && subscriptionDays <= 14 && !lapsed && <Alert tone="warning">Lisensi berakhir dalam {subscriptionDays} hari. Perpanjang dari dashboard pelanggan di website lisensi; aplikasi memperbarui status otomatis.</Alert>}
              {superadmin && (
                <div className="flex flex-wrap gap-2">
                  {activation?.activated && <Button variant="secondary" icon={RefreshCw} loading={busy === "refresh"} disabled={!!busy} onClick={() => void act({ action: "refresh" }, "refresh")}>Periksa ulang status</Button>}
                  {activation?.activated && !replacing && !lapsed && <Button variant="secondary" icon={KeyRound} disabled={!!busy} onClick={() => setReplacing(true)}>Ganti license key</Button>}
                  {activation?.activated && <Button variant="ghost" icon={Unplug} disabled={!!busy} onClick={() => setConfirmRelease(true)}>Lepas lisensi</Button>}
                  {data.edition === "pro" && data.upgrade?.available && <Button variant="secondary" icon={ArrowUpCircle} loading={upgrading || busy === "upgrade-auto"} disabled={upgrading || !!busy} onClick={() => void act({ action: "upgrade" }, "upgrade-auto")}>Perbarui aplikasi Pro</Button>}
                </div>
              )}
            </CardBody>
          </Card>

          {showKeyForm && (
            <Card>
              <CardHeader icon={KeyRound} title={activation?.activated ? (lapsed ? "Aktifkan kembali atau ganti lisensi" : "Ganti license key") : "Aktifkan HRIS Pro"} description={activation?.activated ? "Masukkan license key baru atau key yang sudah diperpanjang. Lisensi lama otomatis dilepas sehingga dapat dipakai di server lain." : "Salin license key dari dashboard pelanggan di website lisensi. Satu lisensi berlaku untuk satu alamat website HRIS."} />
              <CardBody className="space-y-4">
                {!data.licenseServer ? (
                  <Alert tone="warning" title="Server lisensi belum dikonfigurasi">Isi <code className="font-mono">HRIS_LICENSE_SERVER</code> (alamat website lisensi, HTTPS) pada file <code className="font-mono">.env</code> instalasi, lalu restart. Installer resmi mengisinya otomatis.</Alert>
                ) : (
                  <form className="flex flex-col sm:flex-row gap-3" onSubmit={(e) => { e.preventDefault(); void act({ action: "activate", licenseKey: licenseKey.trim() }, "activate"); }}>
                    <Field label="License key" className="flex-1"><Input value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} placeholder="HRIS-PRO-…" autoComplete="off" spellCheck={false} autoFocus={replacing} /></Field>
                    <div className="flex gap-2 sm:self-end">
                      {replacing && <Button type="button" variant="secondary" onClick={() => { setReplacing(false); setLicenseKey(""); }}>Batal</Button>}
                      <Button type="submit" loading={busy === "activate"} disabled={licenseKey.trim().length < 16 || !!busy}>{activation?.activated ? "Simpan & aktifkan" : "Aktifkan"}</Button>
                    </div>
                  </form>
                )}
                {lapsed && activation?.activated && <p className="text-caption text-muted">Perpanjang lisensi yang sama? Tidak perlu memasukkan key lagi — setelah pembayaran dikonfirmasi, klik <b>Periksa ulang status</b> atau tunggu beberapa menit.</p>}
                <p className="text-caption text-muted">Belum punya lisensi? Beli Pro di website lisensi, lalu lihat license key di dashboard pelanggan (perlu konfirmasi kata sandi).</p>
              </CardBody>
            </Card>
          )}

          {superadmin && needsUpgrade && data.upgrade?.available && (
            <Card><CardHeader icon={ArrowUpCircle} title="Aktifkan fitur Pro" description="Lisensi Anda sudah tersimpan. Fitur Pro diunduh dan diaktifkan otomatis tanpa memindahkan data." /><CardBody><Button loading={upgrading || busy === "upgrade-auto"} disabled={upgrading || !!busy} onClick={() => void act({ action: "upgrade" }, "upgrade-auto")}>{data.upgrade.stage === "failed" ? "Coba lagi" : "Aktifkan Pro"}</Button></CardBody></Card>
          )}
          {superadmin && needsUpgrade && !data.upgrade?.available && (
            <Card>
              <CardHeader icon={ArrowUpCircle} tone="accent" title="Perbarui installer sekali" description="Instalasi lama ini belum memiliki pengelola upgrade otomatis. Jalankan installer terbaru di folder instalasi yang sama; setelah itu upgrade dapat dilakukan dari halaman ini." />
              <CardBody className="space-y-4">
                {!upgrade || secondsLeft === 0 ? (
                  <Button icon={Terminal} loading={busy === "upgrade"} onClick={() => void act({ action: "upgrade-code" }, "upgrade")}>{upgrade ? "Buat perintah baru" : "Buat perintah upgrade"}</Button>
                ) : (
                  <>
                    <p className="text-body-sm text-muted">Jalankan di folder instalasi (tempat file <code className="font-mono">.env</code> dan <code className="font-mono">compose.image.yml</code> berada). Kode sekali pakai, berlaku {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")} lagi.</p>
                    <div className="flex items-stretch gap-2">
                      <code className="flex-1 min-w-0 break-all rounded-[var(--radius-control)] border border-line bg-surface-2 p-3 font-mono text-label">{upgrade.command}</code>
                      <Button variant="secondary" icon={Copy} onClick={() => void copy(upgrade.command)}>Salin</Button>
                    </div>
                    <p className="text-caption text-muted">Sudah punya file install.sh? Alternatif: <code className="font-mono break-all">{upgrade.localCommand}</code></p>
                    <Alert>Perintah ini mengunduh HRIS Pro khusus untuk instalasi ini lalu me-restart aplikasi sebentar. Setelah selesai, muat ulang halaman ini: edisi aplikasi berubah menjadi Pro.</Alert>
                  </>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Fitur Pro" description="Fitur yang terbuka sesuai lisensi Anda. Fitur Community tetap berjalan apa pun status lisensinya." />
            <ul className="divide-y divide-[var(--border)]">
              {Object.entries(data.featureLabels).map(([key, label]) => {
                const on = data.edition === "pro" && data.features.includes(key);
                return (
                  <li key={key} className="px-5 py-3 flex items-center justify-between gap-3 transition-colors hover:bg-surface-2">
                    <span className="flex items-center gap-2 text-body text-foreground">{on ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Lock className="w-4 h-4 text-subtle" />}{label}</span>
                    {on ? <Badge tone="success" dot>Aktif</Badge> : <Badge dot>Terkunci</Badge>}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}
      <ConfirmDialog
        open={confirmRelease}
        onClose={() => setConfirmRelease(false)}
        onConfirm={() => { setConfirmRelease(false); void act({ action: "deactivate" }, "deactivate"); }}
        loading={busy === "deactivate"}
        title="Lepas lisensi dari instalasi ini?"
        message="Aplikasi segera kembali ke fitur Community (data tetap aman) dan license key dapat diaktifkan di server HRIS lain. Anda dapat memasukkan key kembali kapan saja."
        confirmLabel="Lepas lisensi"
      />
    </div>
  );
}
