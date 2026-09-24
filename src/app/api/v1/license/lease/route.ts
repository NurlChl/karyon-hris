import { timingSafeEqual } from "node:crypto";
import { readActivation } from "@/lib/licensing/activation";

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/**
 * Internal: hands the signed lease to the optional lifecycle agent on the
 * Docker network (Bearer HRIS_AGENT_TOKEN). The agent verifies the signature
 * itself; nothing here grants features.
 */
export async function GET(req: Request) {
  const token = process.env.HRIS_AGENT_TOKEN ?? "";
  if (token.length < 32 || !same(req.headers.get("authorization") ?? "", `Bearer ${token}`)) {
    return Response.json({ success: false, error: { code: "UNAUTHORIZED", message: "Token agent tidak valid." } }, { status: 401 });
  }
  const activation = await readActivation();
  return Response.json({ lease: activation?.lease ?? null }, { headers: { "Cache-Control": "no-store" } });
}
