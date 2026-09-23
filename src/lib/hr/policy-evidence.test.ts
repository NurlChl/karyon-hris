import test from "node:test";
import assert from "node:assert/strict";
import { attendanceDeductions, classifyLateness } from "./policy-evidence";
import { canTransitionDiscipline, disciplineEmployeeFilter } from "./discipline";
test("discipline scopes restrict direct reports, missing identity and self-action", () => {
  const ctx = { user: { employeeId: "manager", branchId: "branch", divisionId: "division" }, permission: { allowed: true, scope: "reports" as const } };
  assert.deepEqual(disciplineEmployeeFilter(ctx), { supervisorId: "manager" });
  assert.deepEqual(disciplineEmployeeFilter({ ...ctx, user: { ...ctx.user, employeeId: null } }), { _id: { $in: [] } });
  assert.deepEqual(disciplineEmployeeFilter(ctx, true), { $and: [{ supervisorId: "manager" }, { _id: { $ne: "manager" } }] });
  assert.deepEqual(disciplineEmployeeFilter({ ...ctx, permission: { allowed: false, scope: "all" } }), { _id: { $in: [] } });
  assert.deepEqual(disciplineEmployeeFilter({ ...ctx, permission: { allowed: true, scope: "branch" } }), { branchId: "branch" });
});

const facts = { lateMinutes: 20, absentDays: 2, exemptLate: false, exemptAbsent: false };
const policy = { latePerMinute: 1000, latePenaltyCap: 15000, absentPerDay: 50000 };

test("hourly late rates prorate and daily rates charge once per affected date", () => {
  assert.equal(attendanceDeductions({ ...facts, lateMinutes: 90 }, { ...policy, lateUnit: "hour", latePerMinute: 10000, latePenaltyCap: 0 }).late, 15000);
  assert.equal(attendanceDeductions({ ...facts, lateDays: 2 }, { ...policy, lateUnit: "day", latePerMinute: 10000, latePenaltyCap: 0 }).late, 20000);
  assert.throws(() => attendanceDeductions(facts, { ...policy, lateUnit: "day" }));
});
test("alpha threshold is strictly greater, can be disabled, and never double charges", () => {
  const logs = [{ date: "2026-08-01", lateMinutes: 240 }, { date: "2026-08-02", lateMinutes: 241 }, { date: "2026-08-02", lateMinutes: 241 }];
  const configured = { ...policy, alphaEnabled: true, alphaAfterHours: 4 };
  const converted = classifyLateness(logs, configured, []);
  assert.equal(converted.lateMinutes, 240);
  assert.equal(converted.lateDays, 1);
  assert.equal(converted.absentDays, 1);
  assert.deepEqual(converted.convertedDates, ["2026-08-02"]);
  const disabled = classifyLateness(logs, { ...configured, alphaEnabled: false }, []);
  assert.equal(disabled.absentDays, 0); assert.equal(disabled.lateDays, 2); assert.equal(disabled.lateMinutes, 481);
  assert.equal(classifyLateness(logs, configured, ["2026-08-02"]).absentDays, 1);
});
test("discipline lifecycle cannot skip human issuance or reopen closed decisions", () => {
  assert.equal(canTransitionDiscipline("open", "issued"), true);
  assert.equal(canTransitionDiscipline("issued", "closed"), true);
  assert.equal(canTransitionDiscipline("open", "closed"), false);
  assert.equal(canTransitionDiscipline("closed", "issued"), false);
  assert.equal(canTransitionDiscipline("issued", "issued"), false);
});
test("shared engine applies the period cap and daily absence rate", () => {
  assert.deepEqual(attendanceDeductions(facts, policy), { late: 15000, absent: 100000, total: 115000 });
});
test("zero cap means unlimited, zero rates mean no deduction", () => {
  assert.equal(attendanceDeductions(facts, { ...policy, latePenaltyCap: 0 }).late, 20000);
  assert.equal(attendanceDeductions(facts, { latePerMinute: 0, latePenaltyCap: 0, absentPerDay: 0 }).total, 0);
});
test("employee exemptions override both alternatives", () => {
  assert.equal(attendanceDeductions({ ...facts, exemptLate: true, exemptAbsent: true }, policy).total, 0);
});
test("simulation is deterministic and does not mutate its snapshot", () => {
  const before = structuredClone({ facts, policy });
  const first = attendanceDeductions(facts, policy);
  attendanceDeductions(facts, { ...policy, latePerMinute: 200 });
  assert.deepEqual(attendanceDeductions(facts, policy), first);
  assert.deepEqual({ facts, policy }, before);
});
test("invalid negative or nonfinite monetary inputs fail closed", () => {
  for (const invalid of [-1, NaN, Infinity]) assert.throws(() => attendanceDeductions(facts, { ...policy, absentPerDay: invalid }));
});
test("shared engine preserves the existing payroll formula across boundary cases", () => {
  for (const minutes of [0, 1, 15, 120]) for (const cap of [0, 1, 15000]) for (const exempt of [true, false]) {
    const inputs = { ...facts, lateMinutes: minutes, exemptLate: exempt };
    const rates = { ...policy, latePenaltyCap: cap };
    let legacyLate = exempt ? 0 : minutes * rates.latePerMinute;
    if (cap > 0) legacyLate = Math.min(legacyLate, cap);
    assert.equal(attendanceDeductions(inputs, rates).late, legacyLate);
  }
});
