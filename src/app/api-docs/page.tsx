"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Lock, Moon, Search, Sun } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { Alert, Badge, Input, cn, type BadgeTone } from "@/components/ui";
import type { ApiEndpoint, ApiGroup } from "@/lib/openapi";
import { ApiConsole } from "@/components/ApiConsole";

const API_BASE = "/api/v1";

/**
 * API reference rendered natively rather than by an embedded viewer.
 *
 * The Content-Security-Policy only permits scripts from this origin, so a
 * CDN-loaded Swagger/Scalar bundle would be blocked outright. Rendering the
 * same definition ourselves keeps the reference working and consistent with the
 * rest of the interface; the raw OpenAPI document is still available at
 * /api/v1/openapi for generating clients.
 */

const METHOD_TONE: Record<ApiEndpoint["method"], BadgeTone> = {
  GET: "info",
  POST: "success",
  PUT: "warning",
  PATCH: "warning",
  DELETE: "danger",
};

export default function ApiDocsPage() {
  const { theme, toggleTheme } = useTheme();
  const [query, setQuery] = useState("");
  // Loaded from the Superadmin-only endpoint rather than bundled into the page.
  const [API_GROUPS, setGroups] = useState<ApiGroup[]>([]);
  useEffect(() => {
    fetch("/api/v1/openapi?format=groups", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setGroups(d?.groups ?? []))
      .catch(() => {});
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return API_GROUPS;
    return API_GROUPS.map((g) => ({
      ...g,
      endpoints: g.endpoints.filter((e) =>
        `${e.method} ${e.path} ${e.summary} ${e.description} ${e.auth}`.toLowerCase().includes(q)
      ),
    })).filter((g) => g.endpoints.length > 0);
  }, [query, API_GROUPS]);

  const total = API_GROUPS.reduce((n, g) => n + g.endpoints.length, 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="h-16 border-b border-line bg-surface sticky top-0 z-40">
        <div className="max-w-6xl mx-auto h-full px-4 md:px-6 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-primary text-primary-foreground grid place-items-center font-semibold text-label shrink-0">
              HR
            </span>
            <span className="min-w-0">
              <span className="block text-body font-semibold truncate">Referensi API HRIS</span>
              <span className="hidden sm:block text-caption text-subtle">
                {total} endpoint · base URL {API_BASE}
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-1.5">
            <a
              href="/api/v1/openapi"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-label font-semibold text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">OpenAPI JSON</span>
            </a>
            <button
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Mode terang" : "Mode gelap"}
              className="p-2 rounded-lg text-muted hover:text-foreground hover:bg-surface-2 cursor-pointer"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <Link
              href="/docs"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-label font-semibold text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Panduan
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-6 py-8 space-y-8">
        <div>
          <h1 className="text-display-sm md:text-display text-heading">Referensi API</h1>
          <p className="mt-2 text-body text-muted leading-relaxed max-w-3xl">
            API bisnis berada di bawah <code className="font-mono text-label">{API_BASE}</code>.
            Autentikasi menggunakan cookie sesi httpOnly kecuali disebutkan lain. Berkas, ekspor,
            dan OpenAPI memiliki format respons khusus. Login/logout Auth.js berada di /api/auth/*.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="card p-4">
            <p className="eyebrow mb-2">
              Respons berhasil
            </p>
            <pre className="text-label leading-relaxed overflow-x-auto">
              <code className="font-mono">{`{
  "success": true,
  "data": { ... },
  "message": "Berhasil ...",
  "meta": { "page": 1, "limit": 25, "total": 120 }
}`}</code>
            </pre>
          </div>
          <div className="card p-4">
            <p className="eyebrow mb-2">
              Respons gagal
            </p>
            <pre className="text-label leading-relaxed overflow-x-auto">
              <code className="font-mono">{`{
  "success": false,
  "error": {
    "code": "GEOFENCE_REJECTED",
    "message": "Presensi ditolak: Anda berada ..."
  }
}`}</code>
            </pre>
          </div>
        </div>

        <Alert tone="info" title="Catatan penting">
          Seluruh waktu dan batas hari dihitung dalam WIB (Asia/Jakarta). Endpoint tulis yang
          sensitif dibatasi laju per identitas, dan izin diperiksa terhadap matriks
          <strong> modul × aksi × lingkup</strong> di basis data, bukan terhadap nama peran.
        </Alert>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari endpoint…"
            aria-label="Cari endpoint"
            className="pl-9"
          />
        </div>

        {groups.length === 0 ? (
          <Alert tone="warning" title="Tidak ditemukan">
            Tidak ada endpoint yang cocok dengan &ldquo;{query}&rdquo;.
          </Alert>
        ) : (
          groups.map((group) => (
            <section key={group.name} className="space-y-3">
              <div className="pb-2 border-b border-line">
                <h2 className="text-body font-semibold">{group.name}</h2>
                <p className="text-label text-muted mt-0.5 leading-relaxed max-w-3xl">
                  {group.description}
                </p>
              </div>

              <div className="space-y-2">
                {group.endpoints.map((ep) => (
                  <EndpointRow key={`${ep.method}-${ep.path}`} endpoint={ep} />
                ))}
              </div>
            </section>
          ))
        )}
      </main>
    </div>
  );
}

function EndpointRow({ endpoint: ep }: { endpoint: ApiEndpoint }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors cursor-pointer"
      >
        <Badge tone={METHOD_TONE[ep.method]} className="font-mono shrink-0 w-16 justify-center">
          {ep.method}
        </Badge>
        <code className="font-mono text-label font-semibold shrink-0">{ep.path}</code>
        <span className="text-label text-muted truncate flex-1" style={{ minWidth: "8rem" }}>{ep.summary}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-4 border-t border-line">
          <p className="text-body text-foreground/85 leading-relaxed max-w-3xl">{ep.description}</p>

          <p className="flex items-center gap-1.5 text-label">
            <Lock className="w-3.5 h-3.5 text-subtle shrink-0" />
            <span className="text-subtle">Otorisasi:</span>
            <code className="font-mono text-caption px-1.5 py-0.5 rounded bg-surface-2">{ep.auth}</code>
          </p>

          {ep.params && ep.params.length > 0 && (
            <Table
              title="Parameter"
              head={["Nama", "Lokasi", "Wajib", "Keterangan"]}
              rows={ep.params.map((p) => [
                p.name,
                p.in,
                p.required ? "Ya" : "Tidak",
                p.description,
              ])}
            />
          )}

          {ep.body && ep.body.length > 0 && (
            <Table
              title="Body (JSON)"
              head={["Field", "Tipe", "Wajib", "Keterangan"]}
              rows={ep.body.map((f) => [
                f.name,
                f.type,
                f.required ? "Ya" : "Tidak",
                f.description,
              ])}
            />
          )}

          {ep.errors && ep.errors.length > 0 && (
            <Table
              title="Kesalahan umum"
              head={["Kode", "Kapan terjadi"]}
              rows={ep.errors.map((e) => [e.code, e.when])}
            />
          )}
          <ApiConsole endpoint={ep} />
        </div>
      )}
    </div>
  );
}

function Table({
  title,
  head,
  rows,
}: {
  title: string;
  head: string[];
  rows: string[][];
}) {
  return (
    <div>
      <p className="eyebrow mb-1.5">{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-body border-collapse min-w-[520px]">
          <thead>
            <tr>
              {head.map((h) => (
                <th
                  key={h}
                  className="text-left text-caption font-semibold uppercase tracking-wide text-subtle px-3 py-2 border-b border-line"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className={cn(
                      "px-3 py-2 border-b border-line text-label align-top leading-relaxed",
                      j === 0 ? "font-mono font-semibold text-foreground whitespace-nowrap" : "text-muted"
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
