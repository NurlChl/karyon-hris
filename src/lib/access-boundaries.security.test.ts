import test from "node:test";
import assert from "node:assert/strict";
import { canReadStoredPayslip } from "./payroll-file-access";
import { canReadComplaintQueue, complaintAttachmentHref } from "./complaint-access";

test("stored payroll enforces publication for owner and all-scope read for others", async () => {
  const self = { id: "user-a", employeeId: "employee-a" };
  const noPayroll = async () => ({ allowed: false, scope: "self" as const });
  const divisionPayroll = async () => ({ allowed: true, scope: "division" as const });
  const allPayroll = async () => ({ allowed: true, scope: "all" as const });
  assert.equal(await canReadStoredPayslip(self, { employeeId: "employee-a", status: "draft" }, allPayroll), false);
  assert.equal(await canReadStoredPayslip(self, { employeeId: "employee-a", status: "published" }, noPayroll), true);
  assert.equal(await canReadStoredPayslip(self, { employeeId: "employee-b", status: "published" }, noPayroll), false);
  assert.equal(await canReadStoredPayslip(self, { employeeId: "employee-b", status: "published" }, divisionPayroll), false);
  assert.equal(await canReadStoredPayslip(self, { employeeId: "employee-b", status: "published" }, allPayroll), true);
});

test("anonymous complaint file links do not expose reporter storage directories", () => {
  const oldKey = "complaints/reporter-private-id/receipt.pdf";
  const href = complaintAttachmentHref("ticket-opaque-id", true, oldKey);
  assert.equal(href, "/api/v1/complaints/attachment?id=ticket-opaque-id");
  assert.equal(href?.includes("reporter-private-id"), false);
  assert.equal(complaintAttachmentHref("ticket-opaque-id", false, oldKey), null);
  assert.equal(canReadComplaintQueue("SPV", "hrd"), false);
  assert.equal(canReadComplaintQueue("SPV", "spv"), true);
});
