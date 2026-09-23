import test from "node:test";
import assert from "node:assert/strict";
import { birthdayRange, birthdayOccurrences } from "./birthdays";
const config = { mode: "custom_days", months: 2, before: 0, after: 30 };
test("birthday calendar windows cover current month, clamped months and year rollover", () => {
  assert.deepEqual(birthdayRange("2026-09-20", { ...config, mode: "current_month" }), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(birthdayRange("2026-12-31", { ...config, mode: "upcoming_months" }), { from: "2026-12-31", to: "2027-02-28" });
  assert.deepEqual(birthdayRange("2026-12-20", config), { from: "2026-12-20", to: "2027-01-19" });
  assert.deepEqual(birthdayRange("2026-01-05", { ...config, before: 15, after: 15 }), { from: "2025-12-21", to: "2026-01-20" });
});
test("birthday bounds are inclusive, offsets signed and invalid dates excluded", () => {
  const rows = birthdayOccurrences([{ _id: "1", name: "Before", month: 12, day: 21 }, { _id: "2", name: "Today", month: 1, day: 5 }, { _id: "3", name: "After", month: 1, day: 20 }, { _id: "4", name: "Outside", month: 1, day: 21 }, { _id: "5", name: "Invalid", month: 2, day: 30 }], "2026-01-05", { from: "2025-12-21", to: "2026-01-20" });
  assert.deepEqual(rows.map((r) => r.daysAway), [-15, 0, 15]);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => !("birthDate" in r) && !("age" in r)));
});
test("leap birthday is observed February 28 in ordinary years and February 29 in leap years", () => {
  const people = [{ _id: "1", name: "Leap", month: 2, day: 29 }];
  assert.equal(birthdayOccurrences(people, "2026-02-28", { from: "2026-02-01", to: "2026-02-28" })[0].occurrence, "2026-02-28");
  assert.equal(birthdayOccurrences(people, "2028-02-28", { from: "2028-02-01", to: "2028-02-29" })[0].daysAway, 1);
});
test("age is derived only when an allowed birth year is present", () => {
  const rows = birthdayOccurrences([
    { _id: "1", name: "Visible", month: 9, day: 21, birthYear: 1990 },
    { _id: "2", name: "Private", month: 9, day: 21 },
  ], "2026-09-21", { from: "2026-09-21", to: "2026-09-21" });
  const visible = rows.find((row) => row._id === "1");
  const privateRow = rows.find((row) => row._id === "2");
  assert.equal(visible?.birthYear, 1990);
  assert.equal(visible?.ageAtOccurrence, 36);
  assert.ok(privateRow && !("birthYear" in privateRow));
  assert.ok(privateRow && !("ageAtOccurrence" in privateRow));
});
