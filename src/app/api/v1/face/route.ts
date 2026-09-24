import {wrapRouteHandler} from "@/lib/api";
import {requireUser,Forbidden} from "@/lib/guard";
export const GET = wrapRouteHandler(async (req) => { await requireUser(req); throw Forbidden("Fitur ini tersedia pada distribusi HRIS Pro."); });
export const POST = wrapRouteHandler(async (req) => { await requireUser(req); throw Forbidden("Fitur ini tersedia pada distribusi HRIS Pro."); });
export const DELETE = wrapRouteHandler(async (req) => { await requireUser(req); throw Forbidden("Fitur ini tersedia pada distribusi HRIS Pro."); });
