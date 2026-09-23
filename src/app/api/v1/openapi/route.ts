import { API_GROUPS, buildOpenApiSpec } from "@/lib/openapi";
import { requireUser } from "@/lib/guard";
import { wrapRouteHandler } from "@/lib/api";

/**
 * Serves the OpenAPI document — to Superadmin only.
 *
 * It describes every endpoint, administration ones included, which is a map of
 * the system nobody outside needs. Integrators receive the file from the
 * Superadmin rather than from a public URL.
 */
export const GET = wrapRouteHandler(async (req: Request) => {
  const ctx = await requireUser(req);
  if (ctx.user.role !== "SUPERADMIN") {
    return Response.json(
      { success: false, error: { code: "FORBIDDEN", message: "Referensi API hanya tersedia untuk Superadmin." } },
      { status: 403 }
    );
  }
  if (new URL(req.url).searchParams.get("format") === "groups") {
    return Response.json({ groups: API_GROUPS }, { headers: { "Cache-Control": "private, no-store" } });
  }
  return Response.json(buildOpenApiSpec(), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
});
