import { apiSuccess, wrapRouteHandler } from "@/lib/api";
import { requireUser, BadRequest } from "@/lib/guard";
import { getBirthdayDirectory } from "@/lib/hr/birthdays-server";

/** Internal employee celebration directory; deliberately excludes birth year and age. */
export const GET = wrapRouteHandler(async (req) => {
  await requireUser(req);
  const query = new URL(req.url).searchParams;
  const page = Number(query.get("page") ?? 1), limit = Number(query.get("limit") ?? 25);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw BadRequest("page minimal 1; limit 1–100 dan harus bilangan bulat.");
  const data = await getBirthdayDirectory(page, limit);
  const response = apiSuccess(data, undefined, { page, limit, total: data.total });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
