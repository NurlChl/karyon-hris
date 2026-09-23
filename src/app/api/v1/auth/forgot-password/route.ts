import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { parseBody, enforceRateLimit, enforceIpRateLimit } from "@/lib/guard";
import { RATE_RULES, clientIp } from "@/lib/rate-limit";
import { connectToDatabase } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { issueOtp } from "@/lib/auth/otp";
import { logActivity } from "@/lib/audit/logger";
import User from "@/models/User";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Format email tidak valid"),
});

/**
 * Starts a password reset.
 *
 * Two rate limits apply: one per IP so a single source cannot enumerate the
 * user table, and one per address so an attacker cannot use the system to
 * mail-bomb an employee. The response is identical either way — whether the
 * address exists is never disclosed.
 */
export const POST = wrapRouteHandler(async (req) => {
  const ip = clientIp(req);
  enforceIpRateLimit("forgot-ip", req, RATE_RULES.auth);

  const body = await parseBody(req, schema);
  enforceRateLimit("forgot-email", body.email, RATE_RULES.otp);

  const genericMessage =
    "Jika email tersebut terdaftar, kami telah mengirimkan kode verifikasi. Periksa kotak masuk dan folder spam Anda.";

  await connectToDatabase();
  const user = await User.findOne({ email: body.email, isActive: { $ne: false } })
    .select("_id email")
    .lean<{ _id: unknown; email: string } | null>();

  if (!user) {
    return apiSuccess(null, genericMessage);
  }

  const settings = await getSettings();
  try {
    await issueOtp(user.email, "reset_password", String(settings.company_name));
  } catch (err) {
    // A mail outage must not tell the caller whether the address exists.
    console.error("[FORGOT-PASSWORD] gagal mengirim OTP:", (err as Error).message);
  }

  void logActivity({
    userId: String(user._id),
    action: "REQUEST_PASSWORD_RESET",
    module: "auth",
    ip,
    userAgent: req.headers.get("user-agent") ?? "",
  });

  return apiSuccess(null, genericMessage);
});
