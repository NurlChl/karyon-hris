"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Cake } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader } from "@/components/ui";
import { Pagination } from "@/components/ui/Pagination";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate } from "@/lib/time";

interface Directory { today: string; from: string; to: string; showBirthYearAndAge: boolean; total: number; items: Array<{ _id: string; name: string; day: number; month: number; occurrence: string; daysAway: number; birthYear?: number; ageAtOccurrence?: number }> }
export function BirthdayPanel({ compact = false, href = "/portal/birthdays" }: { compact?: boolean; href?: string }) {
  const [data, setData] = useState<Directory | null>(null), [error, setError] = useState("");
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const limit = compact ? 5 : 25;
  useEffect(() => {
    let active = true;
    api.get<Directory>(`/api/v1/birthdays?page=${page}&limit=${limit}`, { cache: "no-store" }).then((res) => { if (active) { setData(res.data ?? null); setError(""); } }).catch((err) => { if (active) setError(errorMessage(err)); });
    return () => { active = false; };
  }, [page, limit, retry]);
  return <Card><CardHeader icon={Cake} title="Ulang tahun karyawan" /><CardBody className="space-y-3">
    {error ? <Alert tone="danger">{error}<Button variant="secondary" onClick={() => setRetry((n) => n + 1)}>Coba lagi</Button></Alert> : !data ? <p role="status">Memuat ulang tahun…</p> : <>
      <p className="text-caption text-muted">{formatDate(data.from)} – {formatDate(data.to)} · {data.total} ulang tahun. Periode mengikuti pengaturan perusahaan.</p>
      {data.items.length === 0 ? <p>Belum ada ulang tahun pada periode ini. Hanya karyawan aktif dengan tanggal lahir terisi yang ditampilkan.</p> : <ul className="divide-y divide-[var(--border)]">{data.items.map((person) => <li key={`${person._id}:${person.occurrence}`} className="py-3 flex flex-wrap justify-between gap-2"><span><span className="font-medium">{person.name}</span>{data.showBirthYearAndAge && person.birthYear && person.ageAtOccurrence !== undefined ? <span className="block text-caption text-muted">Lahir {person.birthYear} · usia {person.ageAtOccurrence} tahun pada ulang tahun ini</span> : null}</span><span className="text-body-sm text-muted">{new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", timeZone: "Asia/Jakarta" }).format(new Date(`${person.occurrence}T12:00:00+07:00`))} · {person.daysAway === 0 ? "Hari ini 🎂" : person.daysAway < 0 ? `${-person.daysAway} hari lalu` : `${person.daysAway} hari lagi`}</span></li>)}</ul>}
      {compact ? <Link href={href} className="text-primary underline">Lihat semua ulang tahun</Link> : <><Pagination page={page} limit={limit} total={data.total} totalPages={Math.ceil(data.total / limit)} onPage={(value) => { setData(null); setPage(value); }} /><p className="text-caption text-muted">{data.showBirthYearAndAge ? "Tahun lahir dan usia ditampilkan sesuai pengaturan perusahaan. " : "Tahun lahir dan usia disembunyikan sesuai pengaturan perusahaan. "}Ulang tahun 29 Februari ditampilkan pada 28 Februari di tahun nonkabisat.</p></>}
    </>}
  </CardBody></Card>;
}
