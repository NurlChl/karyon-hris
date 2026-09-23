import assert from "node:assert/strict";
import test from "node:test";
import { decrypt, encrypt } from "./crypto";

test("authenticated encrypted fields reject tampering instead of returning ciphertext", () => {
  process.env.ENCRYPTION_KEY ||= "test-field-encryption-key-with-sufficient-entropy";
  const sealed = encrypt("3174012345678901");
  assert.equal(decrypt(sealed), "3174012345678901");

  const parts = sealed.split(":");
  const last = parts[3];
  parts[3] = `${last.slice(0, -2)}${last.slice(-2) === "00" ? "01" : "00"}`;
  assert.throws(() => decrypt(parts.join(":")), /tidak dapat dibuka/);
});

test("ordinary plaintext values remain backward compatible", () => {
  assert.equal(decrypt("plain-value"), "plain-value");
  assert.equal(decrypt("legacy:plain"), "legacy:plain");
  assert.throws(() => decrypt("v2:broken"), /tidak dapat dibuka/);
});
