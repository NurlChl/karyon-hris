import type { NextConfig } from "next";

/**
 * Baseline security headers.
 *
 * The CSP is intentionally conservative but still permits what the app needs:
 * OpenStreetMap tiles for the branch picker, blob:/data: URLs for the webcam
 * capture in the attendance flow, and Google Fonts. `'unsafe-inline'` on
 * script-src is required by Next.js' inline bootstrap; it is scoped away from
 * user content because stored files are served from a sandboxed route with
 * their own `default-src 'none'` policy.
 */
const isDevelopment = process.env.NODE_ENV === "development";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://unpkg.com",
  "connect-src 'self' https://nominatim.openstreetmap.org",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // Camera + geolocation stay enabled for this origin: both are required by
    // the attendance flow. Everything else is switched off.
    value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
  output: "standalone",
  poweredByHeader: false,

  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Never let an API response be cached by a shared proxy.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },

  async redirects() {
    return [
      // Files used to be served statically from public/uploads, which exposed
      // payslips and attendance selfies to anyone with the URL. Old links now
      // land on the authenticated route instead of a 404.
      {
        source: "/uploads/:path*",
        destination: "/api/v1/storage/secure?key=:path*",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
