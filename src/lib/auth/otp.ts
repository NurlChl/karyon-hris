import bcrypt from "bcryptjs";
import { isInitialPassword } from "@/lib/auth/initial-password";
import VerificationCode from "@/models/VerificationCode";
import { connectToDatabase } from "@/lib/db";
import { randomOtp, sha256, safeEqual } from "@/lib/crypto";
import { getSettings } from "@/lib/settings";
import { sendEmail } from "@/lib/notification/notificationService";
import { renderOtpEmail } from "./otp-email-template";
import { HttpError } from "@/lib/guard";

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

export type OtpPurpose = "reset_password" | "change_password";
type EmailDelivery=(payload:{to:string;subject:string;html:string})=>Promise<boolean>;

/**
 * Issues a one-time code and emails it.
 *
 * The code is generated with `crypto.randomInt` (the previous implementation
 * used `Math.random`, which is predictable) and only its SHA-256 is stored, so
 * a database read cannot reveal a live code.
 */
export async function issueOtp(email: string, purpose: OtpPurpose, companyName: string,deliver:EmailDelivery=sendEmail) {
  const code = randomOtp(6);

  const message = renderOtpEmail(code, companyName, purpose, OTP_TTL_MINUTES);
  const delivered=await deliver({
    to: email,
    ...message,
  });
  if(!delivered){
    throw new HttpError(503,"EMAIL_UNAVAILABLE","Layanan email belum tersedia atau menolak pengiriman. Periksa konfigurasi provider email lalu coba kembali.");
  }

  // Persist only after the provider accepts the message. A failed delivery
  // must never replace a still-valid code or make the API report success.
  await connectToDatabase();
  await VerificationCode.findOneAndUpdate(
    { email: email.toLowerCase(), purpose },
    {
      codeHash: sha256(code),
      expires: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
      attempts: 0,
    },
    { upsert: true, new: true }
  );
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
