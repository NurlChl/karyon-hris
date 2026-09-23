import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { parseBody, enforceRateLimit, BadRequest, enforceIpRateLimit } from "@/lib/guard";
import { RATE_RULES, clientIp } from "@/lib/rate-limit";
import { connectToDatabase } from "@/lib/db";
import { consumeOtp, hashNewPassword } from "@/lib/auth/otp";
import { logActivity } from "@/lib/audit/logger";
import { notifyUsers } from "@/lib/notification/notify";
import User from "@/models/User";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Format email tidak valid"),
  code: z.string().trim().regex(/^\d{6}$/, "Kode verifikasi terdiri dari 6 angka"),
  newPassword: z.string().min(1, "Kata sandi baru wajib diisi"),
});

export const POST = wrapRouteHandler(async (req) => {
  const ip = clientIp(req);
  enforceIpRateLimit("reset-ip", req, RATE_RULES.auth);

  const body = await parseBody(req, schema);
  enforceRateLimit("reset-email", body.email, RATE_RULES.auth);

  // Verify the code before touching the account, and hash before the lookup so
  // a weak password is rejected without revealing whether the email exists.
  await consumeOtp(body.email, "reset_password", body.code);
  const passwordHash = await hashNewPassword(body.newPassword);

  await connectToDatabase();
  const user = await User.findOne({ email: body.email });
  if (!user) throw BadRequest("Kode verifikasi salah atau sudah kedaluwarsa.");

  user.passwordHash = passwordHash;
  // A successful reset also clears any lockout — the legitimate owner has just
  // proven control of the mailbox.
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.mustChangePassword = false;
  await user.save();

  void logActivity({
    userId: user._id.toString(),
    action: "RESET_PASSWORD",
    module: "auth",
    ip,
    userAgent: req.headers.get("user-agent") ?? "",
  });

  // Tell the account holder their password changed — the standard way a
  // takeover gets noticed.
  void notifyUsers(
    [{ userId: user._id.toString(), email: user.email, phone: user.phone }],
    {
      kind: "system",
      title: "Kata sandi Anda berhasil diubah",
      body: "Kata sandi akun HRIS Anda baru saja direset. Jika ini bukan Anda, segera hubungi HRD.",
      href: "/portal/profile",
    }
  );

  return apiSuccess(null, "Kata sandi berhasil diperbarui. Silakan login dengan kata sandi baru Anda.");
});
