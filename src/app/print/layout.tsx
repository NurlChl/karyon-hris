import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dokumen",
  robots: { index: false, follow: false },
};

/**
 * Chrome-free wrapper for printable documents.
 *
 * PDF generation goes through the browser's own print pipeline rather than a
 * server-side renderer. Puppeteer would drag a full Chromium into the
 * deployment for a handful of documents a month, and @react-pdf/renderer means
 * maintaining a second layout language that cannot share the app's tokens.
 * Printing to PDF costs nothing, produces selectable text, honours the user's
 * paper size, and the same markup is what they see on screen beforehand.
 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="print-root">{children}</div>;
}
