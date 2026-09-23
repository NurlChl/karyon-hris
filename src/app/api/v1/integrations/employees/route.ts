import { apiSuccess, wrapRouteHandler } from "@/lib/api";
import { connectToDatabase } from "@/lib/db";
import { Forbidden, Unauthorized, enforceRateLimit, pagination } from "@/lib/guard";
import { sha256 } from "@/lib/crypto";
import { requireProFeature } from "@/lib/licensing/server";
import IntegrationApiKey from "@/models/IntegrationApiKey";
import Employee from "@/models/Employee";

export const GET = wrapRouteHandler(async (req) => {
  const raw = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!/^hris_[A-Za-z0-9_-]{40,}$/.test(raw)) throw Unauthorized("API key tidak valid.");
  await connectToDatabase();
  const key = await IntegrationApiKey.findOne({ keyHash: sha256(raw), enabled: true }).select("scopes");
  if (!key) throw Unauthorized("API key tidak valid.");
  if (!key.scopes.includes("employees.read")) throw Forbidden("API key tidak memiliki scope employees.read.");
  await requireProFeature("integration.api"); enforceRateLimit("integration-employees", String(key._id), { max: 120, windowMs: 60_000 });
  const { page, limit, skip } = pagination(req, 50, 200);
  const filter = { status: { $in: ["active", "onboarding"] } };
  const [items, total] = await Promise.all([Employee.find(filter).select("employeeId name status workEmail branchId divisionId positionId").sort({ name: 1 }).skip(skip).limit(limit).lean(), Employee.countDocuments(filter)]);
  await IntegrationApiKey.updateOne({ _id: key._id }, { lastUsedAt: new Date() });
  const response = apiSuccess(items, undefined, { page, limit, total }); response.headers.set("Cache-Control", "private, no-store"); return response;
});
