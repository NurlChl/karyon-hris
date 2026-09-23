import assert from "node:assert/strict";
import test from "node:test";
import { pinnedLookup } from "./network";

test("pinned webhook lookup always returns the address already validated", async () => {
  const lookup = pinnedLookup("203.0.113.10", 4);
  const result = await new Promise<{ address: string; family: number }>((resolve, reject) => lookup("attacker.example", {}, (error, address, family) => error ? reject(error) : resolve({ address, family })));
  assert.deepEqual(result, { address: "203.0.113.10", family: 4 });
});
