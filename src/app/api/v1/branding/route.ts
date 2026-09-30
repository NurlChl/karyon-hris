import { wrapRouteHandler } from "@/lib/api";
import { requireUser, Forbidden } from "@/lib/guard";

// Changing the application logo is a Pro feature; Community always shows the bundled logo.
const proOnly = wrapRouteHandler(async (req) => { await requireUser(req); throw Forbidden("Mengganti logo tersedia pada HRIS Pro dengan lisensi aktif. Aktifkan di menu Lisensi & Paket."); });
export const GET = proOnly;
export const PUT = proOnly;
export const DELETE = proOnly;
