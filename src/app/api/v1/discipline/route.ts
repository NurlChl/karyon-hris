import {apiSuccess,wrapRouteHandler} from "@/lib/api";
import {requireUser,Forbidden} from "@/lib/guard";
// The navigation probes `view=access`; answering "not available" avoids a denied request on every Community page.
export const GET = wrapRouteHandler(async (req) => { await requireUser(req); if (new URL(req.url).searchParams.get("view") === "access") return apiSuccess({ available: false, write: false, approve: false }); throw Forbidden("Fitur ini tersedia pada distribusi HRIS Pro."); });
export const POST = wrapRouteHandler(async (req) => { await requireUser(req); throw Forbidden("Fitur ini tersedia pada distribusi HRIS Pro."); });
export const PATCH = wrapRouteHandler(async (req) => { await requireUser(req); throw Forbidden("Fitur ini tersedia pada distribusi HRIS Pro."); });
