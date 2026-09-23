import bcrypt from "bcryptjs";
import { isInitialPassword } from "@/lib/auth/initial-password";
import VerificationCode from "@/models/VerificationCode";
import { connectToDatabase } from "@/lib/db";
import { randomOtp, sha256, safeEqual } from "@/lib/crypto";
import { getSettings } from "@/lib/settings";
import { sendEmail } from "@/lib/notification/notificationService";
import { escapeHtml } from "@/lib/notification/notify";
import { HttpError } from "@/lib/guard";

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

export type OtpPurpose = "reset_password" | "change_password";

/**
 * Issues a one-time code and emails it.
 *
 * The code is generated with `crypto.randomInt` (the previous implementation
 * used `Math.random`, which is predictable) and only its SHA-256 is stored, so
 * a database read cannot reveal a live code.
 */
export async function issueOtp(email: string, purpose: OtpPurpose, companyName: string) {
  await connectToDatabase();
  const code = randomOtp(6);

  await VerificationCode.findOneAndUpdate(
    { email: email.toLowerCase(), purpose },
    {
      codeHash: sha256(code),
      expires: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
      attempts: 0,
    },
    { upsert: true, new: true }
  );

  const heading =
    purpose === "reset_password" ? "Kode Verifikasi Reset Kata Sandi" : "Kode Verifikasi Ganti Kata Sandi";

  await sendEmail({
    to: email,
    subject: `[${companyName}] ${heading}`,
    html: `<!doctype html><html lang="id"><body style="margin:0;background:#f6f7f9;padding:24px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a">
      <table role="presentation" width="100%"><tr><td align="center">
        <table role="presentation" width="100%" style="max-width:480px;background:#fff;border:1px solid #e3e7ed;border-radius:12px">
          <tr><td style="padding:24px">
            <h1 style="margin:0 0 12px;font-size:17px">${escapeHtml(heading)}</h1>
            <p style="margin:0;font-size:14px;line-height:1.6;color:#55637a">
              Masukkan kode berikut untuk melanjutkan. Kode berlaku ${OTP_TTL_MINUTES} menit dan hanya dapat dipakai sekali.
            </p>
            <div style="margin:22px 0;padding:16px;background:#f1f3f6;border-radius:10px;text-align:center;font-size:28px;font-weight:700;letter-spacing:8px">${code}</div>
            <p style="margin:0;font-size:12px;line-height:1.6;color:#7b8798">
              Jika Anda tidak meminta ini, abaikan email ini dan kata sandi Anda tetap aman.
              Jangan pernah membagikan kode ini kepada siapa pun, termasuk staf ${escapeHtml(companyName)}.
            </p>
          </td></tr>
        </table>
      </td></tr></table></body></html>`,
  });
}

/**
 * Verifies a code and consumes it. Throws with an Indonesian message on any
 * failure; counts wrong guesses so a six-digit code cannot be brute-forced.
 */
export async function consumeOtp(email: string, purpose: OtpPurpose, code: string) {
  await connectToDatabase();
  const record = await VerificationCode.findOne({ email: email.toLowerCase(), purpose });

  if (!record || record.expires.getTime() < Date.now()) {
    throw new HttpError(400, "OTP_INVALID", "Kode verifikasi salah atau sudah kedaluwarsa. Minta kode baru.");
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await record.deleteOne();
    throw new HttpError(
      429,
      "OTP_LOCKED",
      "Terlalu banyak percobaan kode yang salah. Kode dibatalkan — silakan minta kode baru."
    );
  }

  if (!safeEqual(sha256(String(code)), record.codeHash)) {
    record.attempts += 1;
    await record.save();
    const left = MAX_ATTEMPTS - record.attempts;
    throw new HttpError(
      400,
      "OTP_INVALID",
      `Kode verifikasi salah. Sisa percobaan: ${left}.`
    );
  }

  await record.deleteOne();
}

/**
 * Enforces the password policy configured in the CMS and returns the hash.
 * Rejects the shared default password so nobody can "change" to it.
 */
export async function hashNewPassword(password: string): Promise<string> {
  const settings = await getSettings();
  const minLength = Number(settings.password_min_length);

  if (password.length < minLength) {
    throw new HttpError(400, "WEAK_PASSWORD", `Kata sandi minimal ${minLength} karakter.`);
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    throw new HttpError(
      400,
      "WEAK_PASSWORD",
      "Kata sandi harus memuat huruf kecil, huruf besar, dan angka."
    );
  }
  if (password === String(settings.default_employee_password) || (await isInitialPassword(password))) {
    throw new HttpError(
      400,
      "WEAK_PASSWORD",
      "Kata sandi tidak boleh sama dengan kata sandi awal bawaan sistem."
    );
  }

  return bcrypt.hash(password, 12);
}
