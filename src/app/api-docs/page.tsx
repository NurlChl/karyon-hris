import Link from "next/link";
import { ProFeatureNotice } from "@/components/ProFeatureNotice";

export default function ApiDocsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-5xl mx-auto px-4 md:px-6 py-10">
        <Link href="/admin" className="inline-block mb-6 text-label font-semibold text-muted hover:text-foreground">← Kembali ke dashboard</Link>
        <ProFeatureNotice
          title="Referensi API"
          description="Dokumentasi interaktif seluruh endpoint /api/v1 beserta OpenAPI 3.1."
          included={["Referensi dan konsol uji memakai API key dari dashboard", "Unduhan OpenAPI 3.1 untuk generator klien", "Akses API dengan scope modul × aksi"]}
        />
      </main>
    </div>
  );
}
