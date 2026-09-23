import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireUser, BadRequest } from "@/lib/guard";

/**
 * Indonesian administrative regions, proxied.
 *
 * The employee form needs province / regency / district lists. Fetching them
 * straight from the browser meant every HR user's form activity reached a third
 * party, and it required punching that host into `connect-src`, which the app
 * otherwise keeps at `'self'`. Going through the server keeps the CSP closed,
 * keeps the upstream host out of the client bundle, and lets the answers be
 * cached — these lists change on the order of once a year.
 */

const UPSTREAM = "https://www.emsifa.com/api-wilayah-indonesia/api";

/** Upstream ids are numeric strings; anything else is refused before egress. */
const ID_PATTERN = /^[0-9.]{1,12}$/;

interface Region {
  id: string;
  name: string;
}

export const GET = wrapRouteHandler(async (req) => {
  // Region lists are not secret, but they are only needed by signed-in staff
  // filling the employee form. Requiring a session keeps this from becoming an
  // open proxy that anyone can drive traffic through.
  await requireUser(req);

  const sp = new URL(req.url).searchParams;
  const level = sp.get("level");
  const parent = sp.get("parent");

  let path: string;
  if (level === "provinces") {
    path = "/provinces.json";
  } else if (level === "regencies" || level === "districts") {
    if (!parent || !ID_PATTERN.test(parent)) {
      throw BadRequest("Kode wilayah induk tidak valid.");
    }
    path = `/${level}/${parent}.json`;
  } else {
    throw BadRequest("Parameter level harus provinces, regencies, atau districts.");
  }

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM + path, {
      // A day is generous: administrative regions change about once a year.
      // The cache lives on this fetch rather than on the route, because the
      // session check makes the route itself inherently dynamic.
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // A third-party outage must not read as a fault in this system.
    return apiSuccess<Region[]>([], "Daftar wilayah sedang tidak dapat dimuat.");
  }

  if (!upstream.ok) {
    return apiSuccess<Region[]>([], "Daftar wilayah sedang tidak dapat dimuat.");
  }

  const raw: unknown = await upstream.json();
  if (!Array.isArray(raw)) {
    return apiSuccess<Region[]>([], "Daftar wilayah sedang tidak dapat dimuat.");
  }

  // Only id and name are passed through, so an upstream change of shape cannot
  // push unexpected fields into the form.
  const regions: Region[] = raw
    .filter((r): r is { id: unknown; name: unknown } => typeof r === "object" && r !== null)
    .map((r) => ({ id: String(r.id), name: String(r.name) }))
    .filter((r) => r.id !== "undefined" && r.name !== "undefined");

  return apiSuccess(regions, "Berhasil memuat daftar wilayah");
});
