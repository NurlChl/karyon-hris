import { apiSuccess, wrapRouteHandler } from "@/lib/api";
import { requireUser } from "@/lib/guard";
import { getEntitlements } from "@/lib/licensing/server";
import { PRO_FEATURE_LABELS } from "@/lib/licensing/features";

export const GET = wrapRouteHandler(async (req) => {
  await requireUser(req);
  const license = await getEntitlements();
  const response = apiSuccess({ ...license, featureLabels: PRO_FEATURE_LABELS });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
