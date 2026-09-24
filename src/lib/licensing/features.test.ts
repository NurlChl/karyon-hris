import test from "node:test";
import assert from "node:assert/strict";
import { effectiveEntitlements, type EntitlementSnapshot } from "./features";
const base: EntitlementSnapshot = { plan: "pro", status: "active", features: ["face.advanced"], expiresAt: "2026-09-21T01:00:00.000Z", graceUntil: "2026-09-22T01:00:00.000Z", installationId: "test", source: "lease" };
test("cached entitlement becomes grace then fails closed after grace", () => {
  assert.equal(effectiveEntitlements(base, Date.parse("2026-09-21T00:00:00Z")).status, "active");
  assert.equal(effectiveEntitlements(base, Date.parse("2026-09-21T02:00:00Z")).status, "grace");
  const expired = effectiveEntitlements(base, Date.parse("2026-09-22T02:00:00Z"));
  assert.equal(expired.status, "expired");
  assert.deepEqual(expired.features, []);
});
