"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BirthdayPanel } from "@/components/BirthdayPanel";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Briefcase,
  CalendarOff,
  ClipboardCheck,
  Clock3,
  FileWarning,
  PartyPopper,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  SkeletonCards,
  StatCard,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate, formatDateLong } from "@/lib/time";

interface DashboardData {
  todayKey: string;
  period: string;
  cards: {
    headcount: number;
    onboarding: number;
    presentToday: number;
    lateToday: number;
    flaggedToday: number;
    onLeaveToday: number;
    absentToday: number;
    pendingApprovals: number;
    openCandidates: number;
    expiringContracts: number;
    branches: number;
  };
  trend: Array<{ dateKey: string; present: number; late: number; isWeekend: boolean }>;
  month: {
    workingDays: number;
    attendanceRate: number;
    punctualityRate: number;
    lateRecords: number;
    lateMinutes: number;
  };
  upcomingHolidays: Array<{ dateKey: string; name: string; type: string }>;
  birthdays: Array<{ _id: string; name: string; day: number }>;
}

/**
 * `useSearchParams` forces a Suspense boundary during prerender, so the banner
 * that reads `?denied=` lives in its own component and the dashboard itself
 * renders immediately.
 */
function DeniedBanner() {
  const denied = useSearchParams().get("denied");
  if (!denied) return null;
  return (
    <Alert tone="warning" title="Akses ditolak">
      Peran Anda tidak memiliki izin membuka halaman <strong>{denied}</strong>. Hubungi
      Superadmin bila Anda memerlukan akses tersebut.
    </Alert>
  );
}

export default function AdminDashboardPage() {

  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<DashboardData>("/api/v1/dashboard");
      setData(res.data ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-display-sm md:text-display text-heading">Ringkasan Hari Ini</h1>
        <p className="text-body text-muted mt-2 leading-relaxed">
          {data ? formatDateLong(data.todayKey) : "Memuat…"} · seluruh waktu dalam WIB
        </p>
      </header>

      <Suspense fallback={null}>
        <DeniedBanner />
      </Suspense>

      {error && <ErrorState message={error} onRetry={load} />}

      {loading ? (
        <SkeletonCards count={4} />
      ) : data ? (
        <>
          {/* Attention first: things that need a human today. */}
          {(data.cards.pendingApprovals > 0 || data.cards.flaggedToday > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.cards.pendingApprovals > 0 && (
                <Link href="/admin/approvals" className="card p-4 flex items-center gap-3 hover:border-primary transition-colors">
                  <span className="grid place-items-center w-10 h-10 rounded-lg bg-warning-soft text-warning shrink-0">
                    <ClipboardCheck className="w-5 h-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-body font-semibold">
                      {data.cards.pendingApprovals} pengajuan menunggu Anda
                    </span>
                    <span className="block text-label text-muted">Buka antrean persetujuan →</span>
                  </span>
                </Link>
              )}
              {data.cards.flaggedToday > 0 && (
                <Link href="/admin/employees" className="card p-4 flex items-center gap-3 hover:border-primary transition-colors">
                  <span className="grid place-items-center w-10 h-10 rounded-lg bg-danger-soft text-danger shrink-0">
                    <FileWarning className="w-5 h-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-body font-semibold">
                      {data.cards.flaggedToday} presensi perlu ditinjau
                    </span>
                    <span className="block text-label text-muted">
                      Kendala lokasi, lintas cabang, atau foto manual
                    </span>
                  </span>
                </Link>
              )}
            </div>
          )}

          {/* Today */}
          <section>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="eyebrow">Kehadiran hari ini</h2>
              <Link href="/admin/attendance" className="text-label font-semibold text-primary hover:underline">Lihat detail per karyawan →</Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Sudah absen masuk"
                value={data.cards.presentToday}
                hint={`dari ${data.cards.headcount} karyawan aktif`}
                icon={UserCheck}
                tone="success"
              />
              <StatCard
                label="Terlambat"
                value={data.cards.lateToday}
                hint="melewati jadwal + toleransi"
                icon={Clock3}
                tone={data.cards.lateToday > 0 ? "warning" : "neutral"}
              />
              <StatCard
                label="Cuti / izin"
                value={data.cards.onLeaveToday}
                hint="pengajuan disetujui"
                icon={CalendarOff}
                tone="info"
              />
              <StatCard
                label="Belum absen / alpha"
                value={data.cards.absentToday}
                hint="jadwal sudah mulai, tanpa presensi & izin"
                icon={AlertTriangle}
                tone={data.cards.absentToday > 0 ? "danger" : "neutral"}
              />
            </div>
          </section>

          {/* Organisation */}
          <section>
            <h2 className="eyebrow mb-3">
              Organisasi
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Karyawan aktif" value={data.cards.headcount} hint={`${data.cards.branches} cabang`} icon={Users} />
              <StatCard label="Dalam onboarding" value={data.cards.onboarding} hint="belum berstatus aktif" icon={UserPlus} tone="info" />
              <StatCard label="Kandidat berjalan" value={data.cards.openCandidates} hint="di pipeline rekrutmen" icon={Briefcase} tone="primary" />
              <StatCard
                label="Kontrak segera berakhir"
                value={data.cards.expiringContracts}
                hint="dalam 30 hari ke depan"
                icon={FileWarning}
                tone={data.cards.expiringContracts > 0 ? "warning" : "neutral"}
              />
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Trend */}
            <Card className="lg:col-span-2">
              <CardHeader
                icon={TrendingUp}
                title="Tren kehadiran 14 hari terakhir"
                description={`Bulan berjalan: ${data.month.attendanceRate}% kehadiran · ${data.month.punctualityRate}% tepat waktu dari ${data.month.workingDays} hari kerja.`}
              />
              <CardBody>
                <TrendChart trend={data.trend} headcount={data.cards.headcount} />
                <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-4 pt-4 border-t border-line">
                  <Metric label="Hari kerja berjalan" value={data.month.workingDays} />
                  <Metric label="Kejadian terlambat" value={data.month.lateRecords} />
                  <Metric
                    label="Akumulasi keterlambatan"
                    value={`${data.month.lateMinutes} mnt`}
                  />
                </div>
              </CardBody>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader icon={PartyPopper} title="Hari libur berikutnya" />
                <CardBody className="p-0">
                  {data.upcomingHolidays.length === 0 ? (
                    <EmptyState
                      icon={PartyPopper}
                      title="Belum ada data"
                      description="Tambahkan tanggal merah di menu Hari Libur Nasional."
                    />
                  ) : (
                    <ul className="divide-y divide-[var(--border)]">
                      {data.upcomingHolidays.map((h) => (
                        <li key={h.dateKey} className="flex items-center justify-between gap-3 px-5 py-3">
                          <span className="min-w-0">
                            <span className="block text-label font-semibold truncate">{h.name}</span>
                            <span className="block text-caption text-subtle">{formatDate(h.dateKey)}</span>
                          </span>
                          <Badge tone={h.type === "cuti_bersama" ? "warning" : "danger"}>
                            {h.type === "cuti_bersama" ? "Cuti bersama" : "Libur"}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>

              <BirthdayPanel compact href="/admin/birthdays" />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-caption text-subtle">{label}</p>
      <p className="text-body-lg font-semibold tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

/**
 * Inline bar chart.
 *
 * Drawn with plain divs rather than a chart library: it is a single series over
 * 14 points, and shipping a charting bundle for it would cost far more than it
 * returns. Weekends are dimmed so a natural dip does not read as a problem.
 */
function TrendChart({
  trend,
  headcount,
}: {
  trend: DashboardData["trend"];
  headcount: number;
}) {
  const max = Math.max(headcount, ...trend.map((t) => t.present), 1);

  return (
    <div>
      <div className="flex items-end gap-1.5 h-32" role="img" aria-label="Grafik kehadiran 14 hari terakhir">
        {trend.map((t) => {
          const pct = Math.round((t.present / max) * 100);
          const latePct = t.present ? Math.round((t.late / t.present) * pct) : 0;
          return (
            <div key={t.dateKey} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
              <div
                className="w-full flex-1 flex items-end rounded-t bg-surface-2 overflow-hidden"
                title={`${formatDate(t.dateKey)} — hadir ${t.present}, terlambat ${t.late}`}
              >
                <div
                  className={`w-full rounded-t transition-all ${t.isWeekend ? "bg-line-strong" : "bg-primary"}`}
                  style={{ height: `${Math.max(pct, t.present ? 6 : 0)}%` }}
                >
                  {latePct > 0 && (
                    <div className="w-full bg-warning" style={{ height: `${(latePct / Math.max(pct, 1)) * 100}%` }} />
                  )}
                </div>
              </div>
              <span className="text-caption text-subtle tabular-nums">{t.dateKey.slice(-2)}</span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-4 mt-4 text-caption text-subtle">
        <LegendDot className="bg-primary" label="Hadir" />
        <LegendDot className="bg-warning" label="Terlambat" />
        <LegendDot className="bg-line-strong" label="Akhir pekan" />
      </div>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-sm ${className}`} />
      {label}
    </span>
  );
}
