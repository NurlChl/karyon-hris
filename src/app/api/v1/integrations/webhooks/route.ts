import { randomBytes } from "node:crypto";
import { z } from "zod";
import { apiSuccess, wrapRouteHandler } from "@/lib/api";
import { BadRequest, NotFound, parseBody, requirePermission } from "@/lib/guard";
import { encrypt, decrypt } from "@/lib/crypto";
import { requireProFeature } from "@/lib/licensing/server";
import { assertSafeWebhookUrl, deliverWebhook, WEBHOOK_EVENTS } from "@/lib/integrations/webhooks";
import IntegrationWebhook from "@/models/IntegrationWebhook";

const id = z.string().regex(/^[a-fA-F0-9]{24}$/);
const create = z.object({ name: z.string().trim().min(3).max(120), url: z.string().url().max(2000), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1), enabled: z.boolean().default(true) }).strict();
export const GET = wrapRouteHandler(async (req) => {
  await requirePermission(req, "settings", "read"); await requireProFeature("integration.webhook");
  const rows = await IntegrationWebhook.find({}).sort({ createdAt: -1 }).lean();
  return apiSuccess(rows.map((row) => ({ id: row._id, name: row.name, url: decrypt(row.urlEncrypted), events: row.events, enabled: row.enabled, lastDeliveryAt: row.lastDeliveryAt, lastStatus: row.lastStatus, lastError: row.lastError })));
});
export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requirePermission(req, "settings", "write"); await requireProFeature("integration.webhook"); const body = await parseBody(req, create);
  const url = await assertSafeWebhookUrl(body.url); const secret = randomBytes(32).toString("base64url");
  const row = await IntegrationWebhook.create({ name: body.name, urlEncrypted: encrypt(url), secretEncrypted: encrypt(secret), events: body.events, enabled: body.enabled, createdBy: ctx.user.id });
  return apiSuccess({ id: row._id, signingSecret: secret }, "Webhook dibuat. Signing secret hanya ditampilkan sekali.", undefined, 201);
});
const action = z.object({ id, action: z.enum(["test", "enable", "disable"]) }).strict();
export const PATCH = wrapRouteHandler(async (req) => {
  await requirePermission(req, "settings", "write"); await requireProFeature("integration.webhook"); const body = await parseBody(req, action);
  const row = await IntegrationWebhook.findById(body.id); if (!row) throw NotFound();
  if (body.action === "test") return apiSuccess({ delivered: await deliverWebhook(row, row.events[0], { test: true }) }, "Pengiriman uji selesai.");
  row.enabled = body.action === "enable"; await row.save(); return apiSuccess({ id: row._id, enabled: row.enabled });
});
export const DELETE = wrapRouteHandler(async (req) => {
  await requirePermission(req, "settings", "delete"); await requireProFeature("integration.webhook"); const value = new URL(req.url).searchParams.get("id"); if (!id.safeParse(value).success) throw BadRequest("ID webhook tidak valid.");
  const row = await IntegrationWebhook.findByIdAndDelete(value); if (!row) throw NotFound(); return apiSuccess(null, "Webhook dihapus.");
});
