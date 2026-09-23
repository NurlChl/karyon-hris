import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { API_GROUPS, buildOpenApiSpec } from "./openapi";

test("every implemented v1 route/method has one OpenAPI operation", () => {
  const root = path.resolve(import.meta.dirname, "../app/api/v1");
  const declared = API_GROUPS.flatMap((g) => g.endpoints.map((e) => `${e.method} ${e.path}`));
  const actual: string[] = [];
  for (const file of fs.readdirSync(root, { recursive: true }).filter((f) => String(f).endsWith("route.ts"))) {
    const source = fs.readFileSync(path.join(root, String(file)), "utf8");
    const route = "/" + String(file).replaceAll("\\", "/").replace(/\/route.ts$/, "").replace(/\[([^\]]+)\]/g, "{$1}");
    for (const match of source.matchAll(/export\s+(?:const|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) actual.push(`${match[1]} ${route}`);
  }
  assert.deepEqual({ missing: actual.filter((s) => !declared.includes(s)), stale: declared.filter((s) => !actual.includes(s)), duplicates: declared.filter((s, i) => declared.indexOf(s) !== i) }, { missing: [], stale: [], duplicates: [] });
  const spec = buildOpenApiSpec();
  assert.equal(Object.values(spec.paths).reduce((n, p) => n + Object.keys(p).length, 0), actual.length);
  console.info(`Verified ${actual.length} business API operations`);
});
test("dynamic parameters and multipart are usable in OpenAPI consumers", () => {
  const spec = buildOpenApiSpec();
  for (const [url, methods] of Object.entries(spec.paths)) for (const operation of Object.values(methods)) {
    const op = operation as { parameters: Array<{ name: string; in: string; required: boolean }>; operationId: string };
    assert.ok(op.operationId);
    for (const [, name] of url.matchAll(/\{(\w+)\}/g)) assert.ok(op.parameters.some((p) => p.name === name && p.in === "path" && p.required));
    assert.ok(op.parameters.every((p) => !p.name.includes(",")));
  }
  const upload = spec.paths["/uploads"].post as { requestBody: { content: Record<string, unknown> } };
  assert.ok(upload.requestBody.content["multipart/form-data"]);
});
