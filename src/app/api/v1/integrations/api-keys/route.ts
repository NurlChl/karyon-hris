import { randomBytes } from "node:crypto";
import { z } from "zod";
import { apiSuccess, wrapRouteHandler } from "@/lib/api";
import { BadRequest, NotFound, parseBody, requirePermission } from "@/lib/guard";
import { sha256 } from "@/lib/crypto";
import { requireProFeature } from "@/lib/licensing/server";
import IntegrationApiKey from "@/models/IntegrationApiKey";

const id = z.string().regex(/^[a-fA-F0-9]{24}$/);
export const GET = wrapRouteHandler(async (req) => {
  await requirePermission(req, "settings", "read"); await requireProFeature("integration.api");
  const rows = await IntegrationApiKey.find({}).select("name keyHint scopes enabled lastUsedAt createdAt").sort({ createdAt: -1 }).lean(); return apiSuccess(rows);
});
const create = z.object({ name: z.string().trim().min(3).max(120), scopes: z.array(z.enum(["employees.read"])).min(1) }).strict();
export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "settings", "write"); await requireProFeature("integration.api"); const body = await parseBody(req, create);
  const apiKey = `hris_${randomBytes(32).toString("base64url")}`;
  const row = await IntegrationApiKey.create({ ...body, keyHash: sha256(apiKey), keyHint: apiKey.slice(-8), createdBy: ctx.user.id });
  return apiSuccess({ id: row._id, apiKey }, "API key hanya ditampilkan sekali.", undefined, 201);
});
const change = z.object({ id, enabled: z.boolean() }).strict();
export const PATCH = wrapRouteHandler(async (req) => {
  await requirePermission(req, "settings", "write"); await requireProFeature("integration.api"); const body = await parseBody(req, change);
  const row = await IntegrationApiKey.findByIdAndUpdate(body.id, { enabled: body.enabled }, { new: true }); if (!row) throw NotFound(); return apiSuccess({ id: row._id, enabled: row.enabled });
});
export const DELETE = wrapRouteHandler(async (req) => {
  await requirePermission(req, "settings", "delete"); await requireProFeature("integration.api"); const value = new URL(req.url).searchParams.get("id"); if (!id.safeParse(value).success) throw BadRequest("ID API key tidak valid.");
  const row = await IntegrationApiKey.findByIdAndDelete(value); if (!row) throw NotFound(); return apiSuccess(null, "API key dicabut.");
});
