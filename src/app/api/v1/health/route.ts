import { connectToDatabase } from "@/lib/db";
export async function GET() {
  try {
    await connectToDatabase();
    return Response.json({ ok: true, service: "hris", at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, service: "hris" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
