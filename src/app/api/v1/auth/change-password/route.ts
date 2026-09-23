import { z } from "zod";
import bcrypt from "bcryptjs";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireUser, parseBody, enforceRateLimit, BadRequest, NotFound } from "@/lib/guard";
import { RATE_RULES } from "@/lib/rate-limit";
import { consumeOtp, hashNewPassword } from "@/lib/auth/otp";
import { logActivity } from "@/lib/audit/logger";
import User from "@/models/User";

const schema = z.object({
  /** Proves the person at the keyboard is the account owner, not a hijacked session. */
  currentPassword: z.string().min(1, "Kata sandi saat ini wajib diisi"),
  code: z.string().trim().regex(/^\d{6}$/, "Kode verifikasi terdiri dari 6 angka"),
  newPassword: z.string().min(1, "Kata sandi baru wajib diisi"),
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  enforceRateLimit("change-pw", ctx.user.id, RATE_RULES.auth);

  const body = await parseBody(req, schema);

  const user = await User.findById(ctx.user.id);
  if (!user?.passwordHash) throw NotFound("Data pengguna tidak ditemukan.");

  // Requiring the current password as well as the emailed code means a stolen
  // session alone is not enough to lock the real owner out.
  const currentOk = await bcrypt.compare(body.currentPassword, user.passwordHash);
  if (!currentOk) throw BadRequest("Kata sandi saat ini salah.");

  if (body.newPassword === body.currentPassword) {
    throw BadRequest("Kata sandi baru harus berbeda dari kata sandi saat ini.");
  }

  await consumeOtp(user.email, "change_password", body.code);
  user.passwordHash = await hashNewPassword(body.newPassword);
  user.mustChangePassword = false;
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  void logActivity({
    userId: user._id.toString(),
    action: "CHANGE_PASSWORD",
    module: "auth",
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { mustChangePassword: false },
    "Kata sandi berhasil diubah. Gunakan kata sandi baru pada login berikutnya."
  );
});
