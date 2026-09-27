"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {useRouter} from "next/navigation";
import { ArrowUpCircle, Copy, KeyRound, RefreshCw, ShieldCheck, Terminal } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ErrorState, Field, Input, PageHeader, Skeleton } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/client-api";

type Activation =
  | { activated: false }
  | { activated: true; installationId: string; siteOrigin: string; plan: string | null; features: string[]; leaseExpiresAt: string | null; graceUntil: string | null; updatedAt: string };
type Snapshot = {
  plan: string; status: string; features: string[]; expiresAt: string | null; graceUntil: string | null; installationId: string | null; source: string;
  edition: "community" | "pro"; featureLabels: Record<string, string>; activation: Activation; licenseServer: string | null;
  upgrade?:{available:boolean;stage:string;code?:string};
};
type UpgradeCode = { code: string; expiresAt: string; command: string; localCommand: string };

const STATUS_LABEL: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  active: { label: "Aktif", tone: "success" },
  grace: { label: "Masa tenggang", tone: "warning" },
  expired: { label: "Kedaluwarsa", tone: "danger" },
  unlicensed: { label: "Tanpa lisensi", tone: "neutral" },
};
const when = (value: string | null | undefined) => (value ? new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—");

export default function LicensePage() {
  const router=useRouter();
  const toast = useToast();
  const { data: session } = useSession();
  const superadmin = session?.user?.role === "SUPERADMIN";
  const [data, setData] = useState<Snapshot | null>(null), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const [licenseKey, setLicenseKey] = useState(""), [busy, setBusy] = useState(""), [upgrade, setUpgrade] = useState<UpgradeCode | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const upgrading=!!data?.upgrade&&["validating","downloading","restarting","checking","rolling_back"].includes(data.upgrade.stage);
  useEffect(() => { let active = true; api.get<Snapshot>("/api/v1/license", { cache: "no-store" }).then((res) => { if (active) { setData(res.data ?? null); setError(""); } }).catch((err) => { if (active) setError(errorMessage(err)); }); return () => { active = false; }; }, [retry]);
  useEffect(() => { if (!upgrade) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [upgrade]);
  useEffect(()=>{
    if(!upgrading)return;
    let active=true,inFlight=false;
    const timer=setInterval(async()=>{
      if(inFlight)return;inFlight=true;
      try{const response=await api.get<Snapshot>("/api/v1/license",{cache:"no-store"});if(active&&response.data){setData(response.data);setError("");if(response.data.edition==="pro"&&["active","grace"].includes(response.data.status)){router.refresh();}}}
      catch{/* A brief restart is expected while the image switches. Keep the progress view. */}
      finally{inFlight=false;}
    },3000);
    return()=>{active=false;clearInterval(timer);};
  },[upgrading,router]);

  const act = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    try {
      const res = await api.post<UpgradeCode & { activation?: Activation;upgrade?:Snapshot["upgrade"] }>("/api/v1/license", body);
      toast.success("Lisensi", res.message ?? "Berhasil");
      if (body.action === "upgrade-code" && res.data) setUpgrade(res.data);
      if (body.action === "activate") setLicenseKey("");
      if(res.data?.upgrade)setData(current=>current?{...current,upgrade:res.data!.upgrade,activation:res.data!.activation||current.activation}:current);
      if(body.action==="activate"||body.action==="refresh")router.refresh();
      if(!res.data?.upgrade||!["validating","downloading","restarting","checking","rolling_back"].includes(res.data.upgrade.stage))setRetry((n) => n + 1);
    } catch (err) { toast.error("Gagal", errorMessage(err)); }
    finally { setBusy(""); }
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success("Disalin", "Tempel di terminal server HRIS."); } catch { toast.error("Tidak dapat menyalin", "Salin manual."); } };

  const status = data ? STATUS_LABEL[data.status] ?? { label: data.status, tone: "neutral" as const } : null;
  const activation = data?.activation;
  const needsUpgrade = data?.edition === "community" && activation?.activated;
  const secondsLeft = upgrade ? Math.max(0, Math.round((new Date(upgrade.expiresAt).getTime() - now) / 1000)) : 0;

  return (
    <div>
      <PageHeader
        title="Lisensi & Paket"
        description="Tempel lisensi dari pembelian Anda. Sistem akan memeriksa lisensi dan menyiapkan fitur Pro."
      />
      {error ? <ErrorState message={error} onRetry={() => setRetry((n) => n + 1)} /> : !data ? <Skeleton className="h-40" /> : (
        <div className="space-y-6">
          {upgrading&&<Alert title="Sedang menyiapkan HRIS Pro"><span role="status" aria-live="polite">{({validating:"Memeriksa lisensi…",downloading:"Mengunduh fitur Pro. HRIS tetap dapat digunakan selama proses ini.",restarting:"Mengaktifkan fitur Pro. Aplikasi akan tersambung kembali sebentar lagi.",checking:"Memastikan fitur Pro siap digunakan…",rolling_back:"Upgrade belum berhasil. Memulihkan aplikasi sebelumnya…"} as Record<string,string>)[data.upgrade!.stage]} Data Anda tetap tersimpan.</span></Alert>}
          {data.upgrade?.stage==="failed"&&<Alert tone="warning" title="Upgrade belum selesai">{data.upgrade.code==="ROLLBACK_FAILED"?"Aplikasi belum berhasil dipulihkan. Hubungi administrator server untuk memeriksa log instalasi.":"Fitur Pro belum berhasil diaktifkan. Periksa koneksi server lalu coba lagi. Data dan kunci instalasi tetap disimpan."}</Alert>}
          <Card>
            <CardHeader icon={ShieldCheck} title="Status instalasi" actions={status && <Badge tone={status.tone} dot>{status.label}</Badge>} />
            <CardBody className="space-y-5">
              <dl className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="rounded-[var(--radius-control)] bg-surface-2 p-4"><dt className="text-caption text-muted">Edisi aplikasi</dt><dd className="mt-1 text-body-lg font-semibold text-heading">{data.edition === "pro" ? "Pro" : "Community"}</dd></div>
                <div className="rounded-[var(--radius-control)] bg-surface-2 p-4"><dt className="text-caption text-muted">Paket lisensi</dt><dd className="mt-1 text-body-lg font-semibold text-heading capitalize">{activation?.activated ? activation.plan ?? "—" : "Belum aktif"}</dd></div>
                <div className="rounded-[var(--radius-control)] bg-surface-2 p-4"><dt className="text-caption text-muted">Lease berlaku sampai</dt><dd className="mt-1 text-body font-semibold text-heading">{when(data.expiresAt ?? (activation?.activated ? activation.leaseExpiresAt : null))}</dd></div>
                <div className="rounded-[var(--radius-control)] bg-surface-2 p-4"><dt className="text-caption text-muted">Terikat ke website</dt><dd className="mt-1 text-body font-semibold text-heading break-all">{activation?.activated ? activation.siteOrigin : "—"}</dd></div>
              </dl>
              {data.status === "grace" && <Alert tone="warning">Lease belum berhasil diperbarui. Fitur Pro tetap aktif sampai {when(data.graceUntil)}. Periksa koneksi server ke server lisensi.</Alert>}
              {data.status === "expired" && <Alert tone="danger">Lisensi berakhir. Fitur Pro terkunci, tetapi seluruh data tetap tersimpan dan dapat diekspor.</Alert>}
              {data.edition === "pro" && activation?.activated && superadmin && (
                <Button variant="secondary" icon={RefreshCw} loading={busy === "refresh"} onClick={() => void act({ action: "refresh" }, "refresh")}>Perbarui status dari server lisensi</Button>
              )}
              {data.edition==="pro"&&superadmin&&data.upgrade?.available&&<Button variant="secondary" icon={ArrowUpCircle} loading={upgrading||busy==="upgrade-auto"} disabled={upgrading||!!busy} onClick={()=>void act({action:"upgrade"},"upgrade-auto")}>Perbarui aplikasi Pro</Button>}
            </CardBody>
          </Card>

          {superadmin && (!activation?.activated||data.status==="expired") && (
            <Card>
              <CardHeader icon={KeyRound} title="Aktifkan HRIS Pro" description="Masukkan license key dari dashboard akun Anda di website HRIS. Satu lisensi berlaku untuk satu alamat website." />
              <CardBody className="space-y-4">
                {!data.licenseServer ? (
                  <Alert tone="warning" title="Server lisensi belum dikonfigurasi">Isi <code className="font-mono">HRIS_LICENSE_SERVER</code> (alamat website lisensi, HTTPS) pada file <code className="font-mono">.env</code> instalasi, lalu restart. Installer resmi mengisinya otomatis.</Alert>
                ) : (
                  <form className="flex flex-col sm:flex-row gap-3" onSubmit={(e) => { e.preventDefault(); void act({ action: "activate", licenseKey }, "activate"); }}>
                    <Field label="License key" className="flex-1"><Input value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} placeholder="HRIS-XXXX-…" autoComplete="off" spellCheck={false} /></Field>
                    <Button type="submit" className="sm:self-end" loading={busy === "activate"} disabled={licenseKey.trim().length < 16}>Aktifkan</Button>
                  </form>
                )}
                <p className="text-caption text-muted">Belum punya lisensi? Beli Pro di website HRIS, lalu salin license key dari menu Langganan.</p>
              </CardBody>
            </Card>
          )}

          {superadmin && needsUpgrade && data.upgrade?.available && (
            <Card><CardHeader icon={ArrowUpCircle} title="Aktifkan fitur Pro" description="Lisensi Anda sudah tersimpan. Fitur Pro diunduh dan diaktifkan otomatis tanpa memindahkan data."/><CardBody><Button loading={upgrading||busy==="upgrade-auto"} disabled={upgrading||!!busy} onClick={()=>void act({action:"upgrade"},"upgrade-auto")}>{data.upgrade.stage==="failed"?"Coba lagi":"Aktifkan Pro"}</Button></CardBody></Card>
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
                    <Alert>Perintah ini masuk ke registry privat dengan kredensial khusus instalasi ini, menarik image Pro, lalu me-restart aplikasi. Setelah selesai, muat ulang halaman ini: edisi aplikasi berubah menjadi Pro.</Alert>
                  </>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Fitur Pro" description="Setiap endpoint Pro memeriksa lisensi bertanda tangan di server; menu hanya penanda." />
            <ul className="divide-y divide-[var(--border)]">
              {Object.entries(data.featureLabels).map(([key, label]) => (
                <li key={key} className="px-5 py-3 flex items-center justify-between gap-3">
                  <span className="text-body text-foreground">{label}</span>
                  {data.features.includes(key) ? <Badge tone="success" dot>Aktif</Badge> : <Badge dot>Terkunci</Badge>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
