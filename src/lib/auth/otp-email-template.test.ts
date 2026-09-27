import test from "node:test";
import assert from "node:assert/strict";
import { renderOtpEmail } from "./otp-email-template";

test("HRIS OTP email is copy-friendly and escapes company identity", () => {
  const mail=renderOtpEmail("854210", "PT <Contoh>", "reset_password", 10);
  assert.match(mail.html, /854210/);
  assert.match(mail.html, /PT &lt;Contoh&gt;/);
  assert.doesNotMatch(mail.html, /<Contoh>/);
  assert.match(mail.html, /10 menit/);
});
