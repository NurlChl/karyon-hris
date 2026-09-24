"use client";
import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { Card, IconTile, PageHeader, ICON_STROKE } from "@/components/ui";

/**
 * Shown by Community pages whose engine ships only in the Pro distribution.
 * Existing data stays in the database; nothing here hides that it exists.
 */
export function ProFeatureNotice({
  title,
  description,
  included,
}: {
  title: string;
  description: string;
  included: string[];
}) {
  return (
    <div>
      <PageHeader eyebrow="HRIS Pro" title={title} description={description} />
      <Card className="p-6 md:p-8 max-w-3xl">
        <div className="flex items-start gap-4">
          <IconTile icon={Lock} tone="accent" size="lg" />
          <div className="min-w-0">
            <h2 className="text-body-lg font-semibold text-heading">Tersedia pada distribusi Pro</h2>
            <p className="text-body-sm text-muted mt-1 leading-relaxed">
              Instalasi ini berjalan sebagai Community. Data yang sudah ada tetap tersimpan dan tidak dihapus;
              mesin fitur ini hanya ikut pada image HRIS Pro dengan lisensi aktif.
            </p>
            <ul className="mt-4 space-y-2">
              {included.map((item) => (
                <li key={item} className="flex gap-2 text-body-sm text-foreground">
                  <span className="mt-2 w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
            <Link
              href="/admin/license"
              className="mt-6 inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-body font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              Lihat status lisensi
              <ArrowRight className="w-4 h-4" strokeWidth={ICON_STROKE} />
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
