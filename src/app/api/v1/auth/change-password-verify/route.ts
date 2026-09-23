import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireUser, enforceRateLimit, BadRequest } from "@/lib/guard";
import { RATE_RULES } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { issueOtp } from "@/lib/auth/otp";
import User from "@/models/User";

/** Sends the OTP that authorises a signed-in user's own password change. */
export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  enforceRateLimit("change-pw-otp", ctx.user.id, RATE_RULES.otp);

  const user = await User.findById(ctx.user.id).select("email").lean<{ email: string } | null>();
  if (!user?.email) throw BadRequest("Akun Anda belum memiliki alamat email untuk menerima kode.");

  const settings = await getSettings();
  await issueOtp(user.email, "change_password", String(settings.company_name));

  return apiSuccess(
    { email: maskEmail(user.email) },
    `Kode verifikasi telah dikirim ke ${maskEmail(user.email)}. Kode berlaku 10 menit.`
  );
});

/** `budi@contoh.com` -> `bu**@contoh.com` — confirms the address without printing it. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "email Anda";
  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(2, local.length - 2))}@${domain}`;
}
