import { requireUser, Forbidden } from "@/lib/guard";
import { wrapRouteHandler } from "@/lib/api";

/** The API reference ships with HRIS Pro together with API key access. */
export const GET = wrapRouteHandler(async (req: Request) => {
  await requireUser(req);
  throw Forbidden("Referensi API tersedia pada HRIS Pro dengan lisensi aktif.");
});
