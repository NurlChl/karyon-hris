"use client";

import React from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Boxes,
  CalendarRange,
  CheckCircle2,
  Clock3,
  Fingerprint,
  Moon,
  ReceiptText,
  Repeat2,
  ScrollText,
  ServerCog,
  ShieldCheck,
  Sun,
  Workflow,
} from "lucide-react";
import { motion } from "framer-motion";
import { useTheme } from "@/components/ThemeProvider";
import { Button, ICON_STROKE, IconTile, type IconType, type TileTone } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

/**
 * Every claim below names a mechanism that actually exists in the code. No
 * adjectives that cannot be checked — a reader should be able to open the
 * matching screen and see exactly the behaviour described here.
 */
const GUARANTEES: Array<{ icon: IconType; title: string; body: string }> = [
  {
    icon: Clock3,
    title: "Jam server, bukan jam HP",
    body: "Waktu presensi diambil dari server dalam WIB. Mengubah jam di perangkat tidak berpengaruh.",
  },
  {
    icon: ShieldCheck,
    title: "NIK & rekening terenkripsi",
    body: "Data identitas dan bank disimpan AES-256-GCM, dibuka hanya untuk peran yang berhak.",
  },
  {
    icon: ScrollText,
    title: "Semua keputusan tercatat",
    body: "Login, persetujuan, akses slip gaji, dan perubahan aturan masuk ke jejak audit.",
  },
  {
    icon: ServerCog,
    title: "Bisa di server sendiri",
    body: "Tanpa ketergantungan layanan berbayar. Penyimpanan berkas tinggal ganti satu variabel.",
  },
];

const MODULES: Array<{ icon: IconType; tone: TileTone; title: string; body: string }> = [
  {
    icon: Fingerprint,
    tone: "primary",
    title: "Presensi bergeofence",
    body: "Setiap absen menyimpan foto, titik GPS, dan jaraknya ke kantor. Kalau GPS meleset padahal karyawan ada di kantor, ada jalur khusus yang otomatis ditandai untuk ditinjau HRD.",
  },
  {
    icon: CalendarRange,
    tone: "info",
    title: "Izin dan cuti",
    body: "Saldo hanya terpotong di hari kerja. Akhir pekan dan tanggal merah di tengah rentang cuti tidak mengurangi kuota, dan saldo langsung ditahan saat pengajuan dikirim.",
  },
  {
    icon: Workflow,
    tone: "accent",
    title: "Persetujuan berjenjang",
    body: "Urutan approver disusun per jenis pengajuan dari dashboard. Cuti, koreksi absen, dan tukar libur memakai satu mesin yang sama, jadi perilakunya tidak pernah berbeda-beda.",
  },
  {
    icon: ReceiptText,
    tone: "success",
    title: "Slip gaji dari data presensi",
    body: "Lembur, potongan telat, potongan alpha, BPJS, dan PPh 21 dihitung dari catatan presensi yang sama. Tarifnya Anda yang tentukan, bukan tertanam di kode.",
  },
  {
    icon: Repeat2,
    tone: "warning",
    title: "Tukar libur",
    body: "Karyawan yang bersedia masuk di tanggal merah menukarnya dengan libur di hari lain. Kalau ternyata hari itu tidak masuk, hak liburnya gugur otomatis keesokan harinya.",
  },
  {
    icon: Boxes,
    tone: "neutral",
    title: "Rekrutmen dan inventaris",
    body: "Pipeline kandidat sampai onboarding, serah terima aset sampai clearance saat resign. Keduanya terhubung ke data karyawan yang sama.",
  },
];

/* ------------------------------------------------------------------ */

export default function LandingPage() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* ---------------- header ---------------- */}
      <header className="h-16 border-b border-line bg-background/85 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-6xl mx-auto w-full h-full px-5 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-[10px] bg-primary text-primary-foreground grid place-items-center font-semibold text-label">
              HR
            </span>
            <span className="font-semibold text-body-lg text-heading tracking-[-0.01em]">HRIS</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            <HeaderLink href="/career">Karier</HeaderLink>
          </nav>

          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Gunakan tampilan terang" : "Gunakan tampilan gelap"}
              className="p-2 rounded-[var(--radius-control)] text-subtle hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
            >
              {theme === "dark" ? (
                <Sun className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
              ) : (
                <Moon className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
              )}
            </button>
            <Link
              href="/auth/login"
              className="inline-flex items-center h-9 px-4 rounded-[var(--radius-control)] bg-primary text-primary-foreground text-body-sm font-semibold hover:bg-primary-hover transition-colors"
            >
              Masuk
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ---------------- hero ---------------- */}
        <section className="relative overflow-hidden border-b border-line">
          <div
            className="absolute inset-0 dot-grid opacity-40 pointer-events-none"
            style={{ maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, #000 40%, transparent 100%)" }}
            aria-hidden
          />
          <div className="relative max-w-6xl mx-auto w-full px-5 py-16 md:py-24 grid lg:grid-cols-[1.1fr_0.95fr] gap-14 lg:gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-line text-label font-medium text-muted">
                <span className="w-1.5 h-1.5 rounded-full bg-success" aria-hidden />
                Sistem informasi kepegawaian
              </span>

              <h1 className="mt-6 text-display sm:text-hero lg:text-hero leading-[1.08] text-heading">
                Aturan HR Anda,
                <br />
                <span className="text-primary">dijalankan sistem.</span>
              </h1>

              <p className="mt-6 text-title-sm text-muted leading-[1.65] max-w-xl">
                Toleransi keterlambatan, radius absen, kuota cuti, urutan approver, sampai tarif
                potongan gaji diatur dari dashboard. Tidak ada angka kebijakan yang terkunci di
                dalam kode program.
              </p>

              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link href="/auth/login">
                  <Button size="lg" iconRight={ArrowRight}>
                    Masuk ke portal
                  </Button>
                </Link>
                <Link href="/career">
                  <Button size="lg" variant="secondary" icon={BookOpen}>
                    Lihat lowongan
                  </Button>
                </Link>
              </div>

              <p className="mt-6 text-body-sm text-subtle">
                Panduan penggunaan tersedia di dalam aplikasi, sesuai peran akun Anda.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
              className="hidden lg:block"
            >
              <AttendancePreview />
            </motion.div>
          </div>
        </section>

        {/* ---------------- guarantees ---------------- */}
        <section className="border-b border-line bg-surface">
          <div className="max-w-6xl mx-auto w-full px-5 py-12">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-9">
              {GUARANTEES.map((g) => (
                <div key={g.title} className="flex gap-3.5">
                  <IconTile icon={g.icon} tone="primary" size="sm" />
                  <div className="min-w-0">
                    <h3 className="text-body font-semibold text-heading leading-snug">{g.title}</h3>
                    <p className="mt-1.5 text-body-sm text-muted leading-relaxed">{g.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- modules ---------------- */}
        <section className="border-b border-line">
          <div className="max-w-6xl mx-auto w-full px-5 py-16 md:py-20">
            <div className="max-w-2xl">
              <p className="eyebrow">Yang dikerjakan sistem</p>
              <h2 className="mt-3 text-display-sm md:text-display text-heading leading-[1.15]">
                Enam modul, satu sumber data.
              </h2>
              <p className="mt-4 text-body-lg text-muted leading-relaxed">
                Presensi yang dicatat pagi ini adalah angka yang sama yang dipakai menghitung
                potongan di slip gaji akhir bulan. Tidak ada rekap manual di antaranya.
              </p>
            </div>

            <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
              {MODULES.map((m) => (
                <article key={m.title} className="card p-6">
                  <IconTile icon={m.icon} tone={m.tone} size="md" />
                  <h3 className="mt-5 text-body-lg font-semibold text-heading">{m.title}</h3>
                  <p className="mt-2.5 text-body-sm text-muted leading-relaxed">{m.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- roles ---------------- */}
        <section className="border-b border-line bg-surface">
          <div className="max-w-6xl mx-auto w-full px-5 py-16 md:py-20 grid lg:grid-cols-[0.9fr_1.1fr] gap-12 lg:gap-16 items-start">
            <div>
              <p className="eyebrow">Hak akses</p>
              <h2 className="mt-3 text-display-sm md:text-display text-heading leading-[1.15]">
                Setiap peran melihat persis bagiannya.
              </h2>
              <p className="mt-4 text-body-lg text-muted leading-relaxed">
                Hak akses disusun sebagai matriks modul, aksi, dan lingkup data di dalam dashboard.
                Menyembunyikan menu saja tidak dianggap cukup. Server memeriksa ulang izin yang
                sama di setiap permintaan.
              </p>
            </div>

            <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-5">
              {[
                ["Karyawan", "Absen, ajukan cuti dan tukar libur, unduh slip gaji, lapor kendala."],
                ["Atasan", "Persetujuan tahap pertama, terbatas pada divisinya sendiri."],
                ["HRD", "Data karyawan, jadwal, payroll, rekrutmen, dan seluruh pengaturan."],
                ["Audit", "Membaca dan mengekspor semua data, memverifikasi pengajuan yang dieskalasi."],
                ["GA", "Aset perusahaan dan serah terima inventaris."],
                ["Direksi", "Ringkasan eksekutif dan persetujuan tahap akhir."],
              ].map(([role, desc]) => (
                <li key={role} className="flex gap-3">
                  <CheckCircle2
                    className="w-[18px] h-[18px] text-primary shrink-0 mt-0.5"
                    strokeWidth={ICON_STROKE}
                  />
                  <div className="min-w-0">
                    <p className="text-body font-semibold text-heading">{role}</p>
                    <p className="text-body-sm text-muted mt-1 leading-relaxed">{desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------------- entry points ---------------- */}
        <section>
          <div className="max-w-6xl mx-auto w-full px-5 py-16 md:py-20">
            <div className="grid md:grid-cols-2 gap-5">
              <EntryCard
                href="/auth/login"
                title="Portal karyawan"
                body="Absen harian, pengajuan cuti, tukar libur, slip gaji, dan pengaduan."
                cta="Masuk ke portal"
              />
              <EntryCard
                href="/career"
                title="Halaman karier"
                body="Lowongan yang sedang dibuka, beserta form lamaran yang langsung masuk ke pipeline rekrutmen."
                cta="Lihat lowongan"
              />
            </div>
          </div>
        </section>
      </main>

      {/* ---------------- footer ---------------- */}
      <footer className="border-t border-line bg-surface">
        <div className="max-w-6xl mx-auto w-full px-5 py-8 flex flex-wrap items-center justify-between gap-4">
          <p className="text-body-sm text-subtle">
            &copy; {new Date().getFullYear()} HRIS. Seluruh waktu dalam WIB.
          </p>
          <nav className="flex items-center gap-5 text-body-sm">
            <Link href="/career" className="text-muted hover:text-foreground transition-colors">
              Karier
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function HeaderLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-2 rounded-[var(--radius-control)] text-body-sm font-medium text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
    >
      {children}
    </Link>
  );
}

function EntryCard({
  href,
  title,
  body,
  cta,
}: {
  href: string;
  title: string;
  body: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="card-interactive group p-7 flex flex-col justify-between min-h-44 hover:border-primary"
    >
      <div>
        <h3 className="text-title-sm font-semibold text-heading">{title}</h3>
        <p className="mt-2.5 text-body text-muted leading-relaxed max-w-sm">{body}</p>
      </div>
      <span className="mt-6 inline-flex items-center gap-1.5 text-body font-semibold text-primary">
        {cta}
        <ArrowRight
          className="w-4 h-4 group-hover:translate-x-0.5 transition-transform"
          strokeWidth={ICON_STROKE}
        />
      </span>
    </Link>
  );
}

/**
 * Static preview of the attendance screen.
 *
 * Built from the same tokens as the real interface rather than a screenshot, so
 * it cannot drift out of date and it renders correctly in both themes.
 */
function AttendancePreview() {
  return (
    <div className="relative">
      <div
        className="absolute -inset-4 rounded-[28px] bg-primary-soft/60 -rotate-1"
        aria-hidden
      />
      <div
        className="relative card p-5 rotate-[0.6deg]"
        style={{ boxShadow: "var(--shadow-pop)" }}
        aria-hidden
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Presensi hari ini</p>
            <p className="mt-2 text-display font-semibold text-heading tabular-nums leading-none tracking-[-0.02em]">
              08:47
              <span className="text-body font-medium text-subtle ml-1.5 tracking-normal">WIB</span>
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success-soft text-success border border-success/15 text-label font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            Tepat waktu
          </span>
        </div>

        <div className="mt-5 space-y-1">
          {[
            { label: "Absen masuk", time: "08:47", done: true },
            { label: "Mulai istirahat", time: "12:03", done: true },
            { label: "Selesai istirahat", time: "12:58", done: true },
            { label: "Absen pulang", time: null, done: false },
          ].map((step, i, arr) => (
            <div key={step.label} className="flex gap-3">
              <div className="flex flex-col items-center shrink-0">
                <span
                  className={
                    step.done
                      ? "grid place-items-center w-7 h-7 rounded-full bg-success-soft text-success"
                      : "grid place-items-center w-7 h-7 rounded-full bg-primary-soft text-primary ring-2 ring-primary/20"
                  }
                >
                  {step.done ? (
                    <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
                  ) : (
                    <Clock3 className="w-3.5 h-3.5" strokeWidth={ICON_STROKE} />
                  )}
                </span>
                {i < arr.length - 1 && (
                  <span className={`w-px flex-1 min-h-3 ${step.done ? "bg-success/30" : "bg-line"}`} />
                )}
              </div>
              <div className="flex-1 flex items-baseline justify-between gap-3 pb-2.5">
                <span
                  className={`text-body-sm ${step.done ? "text-foreground font-medium" : "text-primary font-semibold"}`}
                >
                  {step.label}
                </span>
                <span className="text-body-sm font-semibold text-foreground tabular-nums">
                  {step.time ?? <span className="text-label text-primary">Giliran Anda</span>}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-line flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-label text-muted">
            <Fingerprint className="w-4 h-4 text-subtle" strokeWidth={ICON_STROKE} />
            Kantor Pusat Jakarta · 12 m
          </span>
          <span className="text-label font-medium text-success">Dalam radius</span>
        </div>
      </div>
    </div>
  );
}
