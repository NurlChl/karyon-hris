import "server-only";
import { lookup } from "node:dns/promises";
import { createHmac, randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { decrypt } from "@/lib/crypto";
import { pinnedLookup } from "@/lib/integrations/network";
import IntegrationWebhook from "@/models/IntegrationWebhook";

export const WEBHOOK_EVENTS = ["discipline.case_created", "discipline.case_decided", "employee.updated", "attendance.recorded", "payroll.published"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
const privateV4 = (ip: string) => /^127\.|^10\.|^0\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^224\.|^2[4-5]\d\./.test(ip);
const privateV6 = (ip: string) => ip === "::1" || ip === "::" || /^f[cd]/i.test(ip) || /^fe[89ab]/i.test(ip) || /^::ffff:(127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(ip);
export async function resolveSafeWebhookUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Webhook wajib HTTPS dan tidak boleh memuat kredensial pada URL.");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address, family }) => family === 4 ? privateV4(address) : privateV6(address))) throw new Error("Webhook tidak boleh menuju jaringan privat, loopback, link-local, atau multicast.");
  return { url, address: addresses[0].address, family: addresses[0].family };
}
export async function assertSafeWebhookUrl(raw: string) { return (await resolveSafeWebhookUrl(raw)).url.toString(); }
async function postWebhook(rawUrl: string, headers: Record<string, string>, body: string) {
  const target = await resolveSafeWebhookUrl(rawUrl);
  return new Promise<{ ok: boolean; status: number }>((resolvePromise, reject) => {
    const request = httpsRequest(target.url, { method: "POST", headers: { ...headers, "content-length": Buffer.byteLength(body).toString() }, lookup: pinnedLookup(target.address, target.family) }, (response) => {
      response.resume(); response.on("end", () => resolvePromise({ ok: Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300), status: response.statusCode ?? 0 }));
    });
    request.setTimeout(8_000, () => request.destroy(new Error("Webhook timeout"))); request.on("error", reject); request.end(body);
  });
}
export async function deliverWebhook(row: { _id: unknown; urlEncrypted: string; secretEncrypted: string }, event: WebhookEvent, data: Record<string, unknown>) {
  const id = randomUUID(), timestamp = new Date().toISOString();
  const body = JSON.stringify({ id, event, timestamp, data });
  const signature = createHmac("sha256", decrypt(row.secretEncrypted)).update(`${timestamp}.${body}`).digest("hex");
  try {
    const response = await postWebhook(decrypt(row.urlEncrypted), { "content-type": "application/json", "user-agent": "HRIS-Webhook/1.0", "x-hris-event": event, "x-hris-delivery": id, "x-hris-timestamp": timestamp, "x-hris-signature": `sha256=${signature}` }, body);
    await IntegrationWebhook.updateOne({ _id: row._id }, { lastDeliveryAt: new Date(), lastStatus: response.status, lastError: response.ok ? "" : `HTTP ${response.status}` });
    return response.ok;
  } catch (error) {
    await IntegrationWebhook.updateOne({ _id: row._id }, { lastDeliveryAt: new Date(), lastStatus: 0, lastError: error instanceof Error ? error.message.slice(0, 300) : "Delivery failed" });
    return false;
  }
}
export async function dispatchWebhook(event: WebhookEvent, data: Record<string, unknown>) {
  const rows = await IntegrationWebhook.find({ enabled: true, events: event }).select("urlEncrypted secretEncrypted").lean<Array<{ _id: unknown; urlEncrypted: string; secretEncrypted: string }>>();
  await Promise.allSettled(rows.map((row) => deliverWebhook(row, event, data)));
}
