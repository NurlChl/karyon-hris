import assert from "node:assert/strict";
import test from "node:test";
import { DENIED_SCOPE, scopeFilterForFields, employeeRecordScopeFilter } from "./scope";
import Employee from "@/models/Employee";

const user = {
  employeeId: "111111111111111111111111",
  branchId: "222222222222222222222222",
  divisionId: "333333333333333333333333",
};

test("branch and division scopes fail closed when their field is unavailable", () => {
  assert.deepEqual(
    scopeFilterForFields({ user, permission: { allowed: true, scope: "branch" } }),
    { employeeId: DENIED_SCOPE }
  );
  assert.deepEqual(
    scopeFilterForFields({ user, permission: { allowed: true, scope: "division" } }),
    { employeeId: DENIED_SCOPE }
  );
});

test("organisation scopes use only the caller's own organisation", () => {
  assert.deepEqual(
    scopeFilterForFields(
      { user, permission: { allowed: true, scope: "branch" } },
      { employee: "_id", branch: "branchId", division: "divisionId" }
    ),
    { branchId: user.branchId }
  );
  assert.deepEqual(
    scopeFilterForFields(
      { user, permission: { allowed: true, scope: "division" } },
      { employee: "_id", branch: "branchId", division: "divisionId" }
    ),
    { divisionId: user.divisionId }
  );
});

test("missing identity metadata never widens a scoped query", () => {
  const missing = { employeeId: null, branchId: null, divisionId: null };
  for (const scope of ["self", "branch", "division"] as const) {
    assert.deepEqual(
      scopeFilterForFields(
        { user: missing, permission: { allowed: true, scope } },
        { employee: "_id", branch: "branchId", division: "divisionId" }
      ),
      { _id: DENIED_SCOPE }
    );
  }
});

test("only an explicit all scope produces an unrestricted fragment", () => {
  assert.deepEqual(
    scopeFilterForFields({ user, permission: { allowed: false, scope: "all" } }),
    { employeeId: { $in: [] } }
  );
  assert.deepEqual(
    scopeFilterForFields({ user, permission: { allowed: true, scope: "all" } }),
    {}
  );
});

test("related records resolve assigned employee membership, not tap locations", async (t) => {
  const ids = ["444444444444444444444444"];
  const distinct = t.mock.method(Employee, "distinct", async (field: string, filter: unknown) => {
    assert.equal(field, "_id");
    assert.deepEqual(filter, { divisionId: user.divisionId });
    return ids;
  });
  assert.deepEqual(await employeeRecordScopeFilter({ user, permission: { allowed: true, scope: "division" } }), { employeeId: { $in: ids } });
  assert.equal(distinct.mock.callCount(), 1);
});

test("denied or missing-unit related scopes do not query employee membership", async (t) => {
  const distinct = t.mock.method(Employee, "distinct", () => { throw new Error("must not query"); });
  for (const permission of [{ allowed: false, scope: "all" }, { allowed: true, scope: "branch" }] as const) {
    assert.deepEqual(await employeeRecordScopeFilter({ user: { ...user, branchId: null }, permission }), { employeeId: { $in: [] } });
  }
  assert.equal(distinct.mock.callCount(), 0);
});
