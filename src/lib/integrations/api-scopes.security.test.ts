import assert from "node:assert/strict";
import test from "node:test";
import { API_KEY_PATTERN, API_KEY_SCOPES, bearerApiKey, isApiKeyScope, parseScope } from "./api-scopes";

test("API key scopes follow the RBAC matrix and never include settings", () => {
  assert.ok(isApiKeyScope("employees:read"));
  assert.ok(isApiKeyScope("leave:approve"));
  assert.ok(isApiKeyScope("employees.read"), "legacy directory scope stays valid for existing keys");
  assert.ok(API_KEY_SCOPES.every((scope) => !scope.startsWith("settings:")));
  assert.equal(isApiKeyScope("settings:write"), false);
  assert.deepEqual(parseScope("payroll:export"), { module: "payroll", action: "export" });
  assert.equal(parseScope("employees.read"), null);
  assert.equal(parseScope("payroll:read:extra"), null);
  assert.equal(parseScope("unknown:read"), null);
});

test("only a well-formed bearer hris_ key is treated as an API key", () => {
  const key = `hris_${"A".repeat(43)}`;
  const withHeader = (value: string) => new Request("https://hris.example/api/v1/employees", { headers: { authorization: value } });
  assert.equal(bearerApiKey(withHeader(`Bearer ${key}`)), key);
  assert.equal(bearerApiKey(withHeader(`bearer ${key}`)), key);
  assert.equal(bearerApiKey(withHeader("Bearer something-else")), null);
  assert.equal(bearerApiKey(withHeader(`Basic ${key}`)), null);
  assert.equal(bearerApiKey(new Request("https://hris.example/api/v1/employees")), null);
  assert.ok(API_KEY_PATTERN.test(key));
  assert.equal(API_KEY_PATTERN.test("hris_short"), false);
});

test("an API key narrows its creator's permissions only inside its own request", async () => {
  const { runWithRequestContext, bindApiKey, currentApiKey } = await import("./request-context");
  const { apiKeyAllows, checkPermission } = await import("../rbac");
  assert.equal(bindApiKey({ keyId: "k", userId: "u", scopes: [] }), false, "no request context: the key must be refused");
  await runWithRequestContext(async () => {
    assert.equal(apiKeyAllows("payroll", "read"), true, "session requests are not narrowed");
    assert.ok(bindApiKey({ keyId: "k1", userId: "creator", scopes: ["employees:read"] }));
    assert.equal(apiKeyAllows("employees", "read"), true);
    assert.equal(apiKeyAllows("payroll", "read"), false);
    // Denied before any database lookup for the key's creator.
    assert.deepEqual(await checkPermission("creator", "payroll", "read"), { allowed: false, scope: "self" });
  });
  await runWithRequestContext(async () => {
    assert.equal(currentApiKey(), undefined, "each request starts without a key");
    assert.ok(bindApiKey({ keyId: "k2", userId: "creator", scopes: ["employees.read"] }));
    assert.equal(apiKeyAllows("employees", "read"), true, "legacy directory scope maps to employees:read");
  });
});
