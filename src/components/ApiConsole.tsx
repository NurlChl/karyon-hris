"use client";
import { useEffect, useState } from "react";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui";
import type { ApiEndpoint } from "@/lib/openapi";

/** Same-origin, opt-in API client. Does not save credentials, requests or responses. */
export function ApiConsole({ endpoint: ep }: { endpoint: ApiEndpoint }) {
  const [pathValues, setPathValues] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("{}"), [headers, setHeaders] = useState("{}");
  const [body, setBody] = useState(JSON.stringify(ep.example ?? {}, null, 2));
  const [file, setFile] = useState<File | null>(null), [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState(""), [busy, setBusy] = useState(false), [download, setDownload] = useState("");
  const multipart = ep.path.endsWith("/uploads");
  const changesData = ep.method !== "GET" || ep.path === "/cron/daily" || ep.path === "/settings/categories";
  useEffect(() => () => { if (download) URL.revokeObjectURL(download); }, [download]);
  function object(text: string): Record<string, unknown> {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Masukkan objek JSON.");
    return value;
  }
  async function run() {
    setBusy(true); setResult(""); setDownload("");
    try {
      if (changesData && !confirmed) throw new Error("Konfirmasi dampak perubahan terlebih dahulu.");
      const route = ep.path.replace(/\{(\w+)\}/g, (_, key) => {
        const value = pathValues[key]?.trim();
        if (!value || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`Isi parameter path ${key} (huruf/angka/_/-).`);
        return encodeURIComponent(value);
      });
      const url = new URL(`/api/v1${route}`, window.location.origin);
      for (const [key, value] of Object.entries(object(query))) if (value !== null && value !== "") url.searchParams.set(key, String(value));
      const requestHeaders = new Headers();
      for (const [key, value] of Object.entries(object(headers))) {
        if (!["x-api-key", "x-cron-secret", "x-turnstile-token"].includes(key.toLowerCase())) throw new Error("Header yang boleh diisi: x-api-key, x-cron-secret, x-turnstile-token. Cookie sesi dikirim browser.");
        requestHeaders.set(key, String(value));
      }
      let requestBody: BodyInit | undefined;
      if (ep.method !== "GET") {
        if (multipart) {
          if (!file) throw new Error("Pilih file unggahan.");
          const data = new FormData(); data.set("file", file);
          for (const [key, value] of Object.entries(object(body))) data.set(key, String(value));
          requestBody = data;
        } else if (body.trim() && body.trim() !== "{}") { JSON.parse(body); requestBody = body; requestHeaders.set("Content-Type", "application/json"); }
        else if (ep.body?.length) { requestBody = "{}"; requestHeaders.set("Content-Type", "application/json"); }
      }
      const response = await fetch(url, { method: ep.method, headers: requestHeaders, body: requestBody, credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60000) });
      const contentType = response.headers.get("Content-Type") ?? "";
      if (contentType.includes("json") || contentType.startsWith("text/")) {
        const text = await response.text();
        let display = text;
        try { display = JSON.stringify(JSON.parse(text), null, 2); } catch { /* Text/CSV response. */ }
        setResult(`HTTP ${response.status} · ${contentType}\n${display.slice(0, 100000)}`);
      } else {
        setDownload(URL.createObjectURL(await response.blob()));
        setResult(`HTTP ${response.status} · ${contentType || "binary"}. Unduh respons untuk melihat berkas.`);
      }
    } catch (error) { setResult(error instanceof Error ? error.message : "Permintaan gagal."); }
    finally { setBusy(false); setConfirmed(false); }
  }
  return <details className="border border-line rounded-lg p-3"><summary className="cursor-pointer font-semibold text-primary">Coba API (permintaan nyata)</summary><div className="space-y-3 mt-3">
    <Alert tone="warning">Memakai akun yang sedang login dan database aplikasi ini, bukan sandbox. Gunakan data demo. Jangan memasukkan token pihak lain. Hasil hanya berada di memori halaman.</Alert>
    <fieldset disabled={busy} className="space-y-3">
      {Array.from(ep.path.matchAll(/\{(\w+)\}/g)).map(([ , key]) => <Field key={key} label={`Path: ${key}`}><Input value={pathValues[key] ?? ""} onChange={(e) => setPathValues({ ...pathValues, [key]: e.target.value })} /></Field>)}
      <Field label="Query parameters (objek JSON)"><Textarea value={query} onChange={(e) => setQuery(e.target.value)} placeholder={'{"page":1,"limit":25}'} /></Field>
      <Field label="Header tambahan (JSON; opsional)"><Textarea value={headers} onChange={(e) => setHeaders(e.target.value)} spellCheck={false} /></Field>
      {ep.method !== "GET" && <Field label={multipart ? "Field multipart selain file (objek JSON)" : "Request body JSON"}><Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} /></Field>}
      {multipart && <Field label="File"><Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>}
      {changesData && <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />Saya memahami permintaan ini dapat mengubah/menghapus data atau mengirim notifikasi.</label>}
      <Button type="button" disabled={changesData && !confirmed} loading={busy} onClick={() => void run()}>Kirim {ep.method} {ep.path}</Button>
    </fieldset>
    {result && <pre role="status" className="max-h-96 overflow-auto text-caption whitespace-pre-wrap">{result}</pre>}
    {download && <a href={download} download="api-response" className="text-primary underline">Unduh respons</a>}
  </div></details>;
}
