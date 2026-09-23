"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ClipboardList,
  ListFilter,
  MapPin,
  Star,
  CircleCheck,
  CircleX,
  FileText,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ICON_STROKE,
  PageHeader,
  SkeletonList,
  StatCard,
  StatusBadge,
  cn,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";
import { formatDateTime, formatRelative } from "@/lib/time";

import { AddCandidateModal } from "@/components/recruitment/AddCandidateModal";
interface HistoryEntry {
  _id: string;
  stage: string;
  status: string;
  notes?: string;
  createdAt: string;
  interviewerId?: { name?: string } | null;
}

interface Candidate {
  _id: string;
  name: string;
  email: string;
  phone: string;
  source: string;
  currentStage: string;
  status: string;
  cvUrl?: string;
  coverLetter?: string;
  portfolioUrl?: string;
  rejectionReason?: string;
  city?: string;
  rating?: number;
  nextInterviewAt?: string | null;
  employeeId?: string | null;
  offeringSalary?: number;
  createdAt: string;
  updatedAt: string;
  history: HistoryEntry[];
}

interface BoardData {
  vacancy: {
    _id: string;
    title: string;
    slug: string;
    status: string;
    stages: string[];
    openings: number;
    divisionId?: { name: string } | null;
    branchId?: { name: string } | null;
    positionId?: { _id: string; name: string } | null;
  };
  board: Record<string, Candidate[]>;
  orphaned: Candidate[];
  total: number;
  byStatus: Record<string, number>;
}

export default function VacancyBoardPage() {
  const params = useParams<{ id: string }>();

  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<BoardData>(`/api/v1/vacancies/${params.id}`);
      setData(res.data ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-64" />
        <SkeletonList rows={4} />
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const { vacancy, board, orphaned } = data;

  return (
    <div>
      <Link
        href="/admin/vacancies"
        className="inline-flex items-center gap-2 text-body-sm font-medium text-muted hover:text-foreground transition-colors mb-5"
      >
        <ArrowLeft className="w-4 h-4" strokeWidth={ICON_STROKE} />
        Semua lowongan
      </Link>

      <PageHeader
        eyebrow="Papan pelamar"
        title={vacancy.title}
        description={
          [vacancy.divisionId?.name, vacancy.branchId?.name].filter(Boolean).join(" · ") ||
          "Penempatan belum diatur"
        }
        actions={
          <>
            <Link href={`/admin/recruitment?vacancyId=${vacancy._id}`}>
              <Button variant="ghost" icon={ListFilter}>
                Daftar & filter
              </Button>
            </Link>
            <Link href={`/admin/vacancies/${vacancy._id}/form`}>
              <Button variant="secondary" icon={ClipboardList}>
                Atur formulir lamaran
              </Button>
            </Link>
            <Button icon={UserPlus} onClick={() => setAddOpen(true)}>
              Tambah pelamar
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-7">
        <StatCard label="Total pelamar" value={data.total} icon={Users} />
        <StatCard
          label="Sedang diproses"
          value={data.byStatus.in_progress ?? 0}
          hint="masuk tahap seleksi"
          icon={ArrowRight}
          tone="info"
        />
        <StatCard
          label="Lolos"
          value={data.byStatus.passed ?? 0}
          hint={`kebutuhan ${vacancy.openings} posisi`}
          icon={CircleCheck}
          tone="success"
        />
        <StatCard
          label="Tidak lolos"
          value={data.byStatus.rejected ?? 0}
          icon={CircleX}
          tone={data.byStatus.rejected ? "danger" : "neutral"}
        />
      </div>

      {orphaned.length > 0 && (
        <Alert tone="warning" title="Ada pelamar di tahap yang sudah dihapus" className="mb-6">
          {orphaned.length} pelamar masih tercatat pada tahap yang tidak lagi ada di lowongan ini.
          Buka kartunya dan pindahkan ke salah satu tahap aktif.
        </Alert>
      )}

      {data.total === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="Belum ada pelamar"
            description={
              vacancy.status === "open"
                ? "Lowongan sudah tayang. Lamaran yang masuk lewat halaman karier akan muncul di sini."
                : "Lowongan ini belum tayang, jadi belum bisa menerima lamaran dari halaman karier."
            }
            action={
              <Button size="sm" icon={UserPlus} onClick={() => setAddOpen(true)}>
                Tambah pelamar manual
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="overflow-x-auto pb-4 -mx-1 px-1">
          <div className="flex gap-4 min-w-max">
            {vacancy.stages.map((stage) => (
              <StageColumn
                key={stage}
                stage={stage}
                candidates={board[stage] ?? []}
              />
            ))}
            {orphaned.length > 0 && (
              <StageColumn stage="Tahap tidak dikenal" candidates={orphaned} orphan />
            )}
          </div>
        </div>
      )}

      <AddCandidateModal
        open={addOpen}
        vacancyId={vacancy._id}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          setAddOpen(false);
          void load();
        }}
      />

    </div>
  );
}

/* ------------------------------------------------------------------ */

function StageColumn({
  stage,
  candidates,
  orphan = false,
}: {
  stage: string;
  candidates: Candidate[];
  orphan?: boolean;
}) {
  return (
    <section className="w-[290px] shrink-0">
      <header
        className={cn(
          "flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-t-[var(--radius)] border border-b-0 border-line",
          orphan ? "bg-warning-soft" : "bg-surface-2"
        )}
      >
        <h2 className="text-body-sm font-semibold text-heading truncate">{stage}</h2>
        <span className="text-label font-semibold text-subtle tabular-nums shrink-0">
          {candidates.length}
        </span>
      </header>

      <div className="border border-line rounded-b-[var(--radius)] bg-surface/50 p-2 space-y-2 min-h-32">
        {candidates.length === 0 ? (
          <p className="text-label text-subtle text-center py-8 px-3 leading-relaxed">
            Belum ada pelamar di tahap ini.
          </p>
        ) : (
          candidates.map((c) => (
            <Link
              key={c._id}
              href={`/admin/recruitment/${c._id}`}
              className="block w-full text-left card p-3.5 hover:border-primary transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-body-sm font-semibold text-heading truncate">{c.name}</p>
                <StatusBadge status={c.status} />
              </div>
              <p className="mt-1.5 text-label text-muted truncate">{c.email}</p>
              {(c.city || (c.rating ?? 0) > 0) && (
                <div className="mt-1.5 flex items-center gap-3 text-label text-muted">
                  {c.city && (
                    <span className="inline-flex items-center gap-1 truncate">
                      <MapPin className="w-3 h-3 shrink-0" strokeWidth={ICON_STROKE} />
                      {c.city}
                    </span>
                  )}
                  {(c.rating ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1 text-warning shrink-0">
                      <Star className="w-3 h-3 fill-current" strokeWidth={ICON_STROKE} />
                      {c.rating}
                    </span>
                  )}
                </div>
              )}
              {c.nextInterviewAt && !c.employeeId && c.status !== "rejected" && new Date(c.nextInterviewAt) > new Date() && (
                <p className="mt-1.5 inline-flex items-center gap-1 text-label text-info">
                  <CalendarClock className="w-3 h-3" strokeWidth={ICON_STROKE} />
                  {formatDateTime(c.nextInterviewAt)}
                </p>
              )}
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <span className="text-caption text-subtle">{formatRelative(c.updatedAt)}</span>
                {c.cvUrl && (
                  <span className="inline-flex items-center gap-1 text-caption text-subtle">
                    <FileText className="w-3 h-3" strokeWidth={ICON_STROKE} />
                    CV
                  </span>
                )}
              </div>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

