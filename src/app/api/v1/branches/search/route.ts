import { GeocodingCache, GeocodingLock } from "@/lib/postgres-auxiliary";
import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireCompanyPermission, BadRequest, HttpError, enforceRateLimit } from "@/lib/guard";
import { sha256 } from "@/lib/crypto";
import Branch from "@/models/Branch";

interface Place { label: string; lat: number; lng: number }
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireCompanyPermission(req, "settings", "write");
  enforceRateLimit("branch-search", ctx.user.id, { max: 15, windowMs: 60_000 });
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 3 || q.length > 160) throw BadRequest("Pencarian harus 3–160 karakter.");
  const coordinate = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(q);
  if (coordinate) {
    const lat = Number(coordinate[1]), lng = Number(coordinate[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw BadRequest("Koordinat di luar rentang.");
    return apiSuccess({ places: [{ label: `Koordinat ${lat}, ${lng}`, lat, lng }], source: "coordinates" });
  }
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const branches = await Branch.find({ $or: [{ name: { $regex: escaped, $options: "i" } }, { address: { $regex: escaped, $options: "i" } }] }).select("name address lat lng").limit(5).lean();
  const local: Place[] = branches.map((b) => ({ label: `${b.name} — ${b.address}`, lat: b.lat, lng: b.lng }));
  const configured = process.env.GEOCODING_SEARCH_URL;
  if (!configured) return apiSuccess({ places: local, source: "local", message: "Pencarian cabang tersimpan/koordinat tersedia. Untuk alamat baru, administrator perlu mengonfigurasi penyedia geocoding." });
  const endpoint = new URL(configured);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("Endpoint geocoding harus HTTPS tanpa kredensial URL.");
  if (endpoint.hostname === "nominatim.openstreetmap.org" && process.env.GEOCODING_PUBLIC_NOMINATIM_ACK !== "true") throw new HttpError(503, "GEOCODING_SETUP", "Pemakaian Nominatim publik belum disetujui administrator.");
  const agent = process.env.GEOCODING_USER_AGENT;
  if (!agent) throw new HttpError(503, "GEOCODING_SETUP", "Identitas aplikasi/kontak penyedia geocoding belum disetel.");
  const cache = GeocodingCache;
  const key = sha256(`${configured}:${q.toLowerCase()}`);
  const cached = await cache.findOne({ _id: key, expiresAt: { $gt: new Date() } });
  if (cached) return apiSuccess({ places: [...local, ...cached.places], source: "geocoder" });
  // A database lease enforces an application-wide maximum, including multiple workers.
  const locks = GeocodingLock;
  try {
    await locks.findOneAndUpdate({ _id: "provider", availableAt: { $lte: new Date() } }, { $set: { availableAt: new Date(Date.now() + 1500) } }, { upsert: true });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new HttpError(429, "GEOCODING_BUSY", "Pencarian lain sedang diproses. Tunggu dua detik lalu coba kembali.");
    throw err;
  }
  endpoint.searchParams.set("q", q); endpoint.searchParams.set("format", "jsonv2"); endpoint.searchParams.set("limit", "5");
  const upstream = await fetch(endpoint, { headers: { "User-Agent": agent, Accept: "application/json" }, signal: AbortSignal.timeout(8000), redirect: "error", cache: "no-store" });
  if (!upstream.ok) throw new HttpError(502, "GEOCODING_FAILED", "Penyedia peta belum merespons. Coba lagi atau masukkan koordinat.");
  const data = z.array(z.object({ display_name: z.string().max(1000), lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180) })).max(10).parse(await upstream.json());
  const places = data.map((item) => ({ label: item.display_name, lat: item.lat, lng: item.lon }));
  await cache.updateOne({ _id: key }, { $set: { places, expiresAt: new Date(Date.now() + 86400_000) } }, { upsert: true });
  return apiSuccess({ places: [...local, ...places], source: "geocoder" });
});
