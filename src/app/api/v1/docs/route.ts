import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireUser } from "@/lib/guard";
import { chaptersForRole } from "@/lib/docs/content";
import { ROLE_LABELS } from "@/lib/docs/roles";

/**
 * The guide, filtered to the caller's role on the server.
 *
 * Superadmin receives everything and may pass `?role=` to see exactly what a
 * given role sees. For anyone else the parameter is ignored.
 */
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const role = ctx.user.role;
  const preview = role === "SUPERADMIN" ? new URL(req.url).searchParams.get("role") : null;
  const validPreview = preview && ROLE_LABELS[preview] ? preview : null;

  return apiSuccess({
    role,
    canPreview: role === "SUPERADMIN",
    preview: validPreview,
    chapters: chaptersForRole(role, validPreview),
  });
});
