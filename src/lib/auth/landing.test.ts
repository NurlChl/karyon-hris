import test from "node:test";
import assert from "node:assert/strict";
import { landingFor, safeCallback } from "./landing";

test("signed-in users return to the page they asked for, never outside their role", () => {
  assert.equal(landingFor("HRD"), "/admin");
  assert.equal(landingFor("STAFF"), "/portal/attendance");
  assert.equal(safeCallback("/admin/payroll?month=2026-09", "HRD"), "/admin/payroll?month=2026-09");
  assert.equal(safeCallback("/portal/leave", "STAFF"), "/portal/leave");
  assert.equal(safeCallback("/print/payslip/abc", "STAFF"), "/print/payslip/abc");
  assert.equal(safeCallback("/admin", "STAFF"), null);
  assert.equal(safeCallback("/api-docs", "SPV"), "/api-docs");
  for (const bad of ["//evil.example/portal", "https://evil.example/portal", "/\evil.example", "/auth/login", "/portal/../admin", "/portal\n", null, ""])
    assert.equal(safeCallback(bad, "STAFF"), null, String(bad));
});
