import assert from "node:assert/strict";
import test from "node:test";
import { wrapRouteHandler } from "./api";

test("cross-site state-changing requests are rejected before the handler", async () => {
  let called = false;
  const handler = wrapRouteHandler(async () => {
    called = true;
    return new Response("ok");
  });
  const response = await handler(
    new Request("https://hris.example/api/v1/test", {
      method: "POST",
      headers: {
        host: "hris.example",
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
    }),
    { params: Promise.resolve({}) }
  );

  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test("same-origin and server-to-server mutations remain available", async () => {
  const handler = wrapRouteHandler(async () => new Response("ok", { status: 201 }));
  const sameOrigin = await handler(
    new Request("https://hris.example/api/v1/test", {
      method: "POST",
      headers: { host: "hris.example", origin: "https://hris.example" },
    }),
    { params: Promise.resolve({}) }
  );
  const serverToServer = await handler(
    new Request("https://hris.example/api/v1/test", {
      method: "POST",
      headers: { host: "hris.example" },
    }),
    { params: Promise.resolve({}) }
  );

  assert.equal(sameOrigin.status, 201);
  assert.equal(serverToServer.status, 201);
});
