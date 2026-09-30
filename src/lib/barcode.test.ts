import test from "node:test";
import assert from "node:assert/strict";
import { CODE39, decodeCode39Row, generateCode39Svg } from "./barcode";

/** Rasterises the generated SVG into one scanline, like a camera row. */
function scanline(text: string, scale: number, reversed = false, noise = 0) {
  const { svg, width } = generateCode39Svg(text);
  const bars = new Set([...svg.matchAll(/x="(\d+)"/g)].map((m) => Number(m[1]) / 2));
  const modules = width / 2;
  const row: number[] = [];
  for (let i = 0; i < 40; i++) row.push(235);
  for (let m = 0; m < modules; m++) for (let s = 0; s < scale; s++) row.push(bars.has(m) ? 30 : 225);
  for (let i = 0; i < 40; i++) row.push(235);
  const out = reversed ? row.reverse() : row;
  let seed = 7;
  return out.map((v) => Math.max(0, Math.min(255, v + (((seed = (seed * 9301 + 49297) % 233280) / 233280) - 0.5) * noise)));
}

test("Code 39 table matches the standard: every pattern is unique with three wide elements", () => {
  const patterns = Object.values(CODE39);
  assert.equal(new Set(patterns).size, patterns.length);
  for (const p of patterns) assert.equal([...p].filter((c) => c === "w").length, 3);
});

test("camera decoder reads generated asset labels at any scale, direction and with noise", () => {
  for (const code of ["AST-LAP-001", "INV-PRJ-2026", "FP.09 Z"]) {
    for (const scale of [2, 3, 5]) {
      assert.equal(decodeCode39Row(scanline(code, scale)), code);
      assert.equal(decodeCode39Row(scanline(code, scale, true)), code);
      assert.equal(decodeCode39Row(scanline(code, scale, false, 60)), code);
    }
  }
  assert.equal(decodeCode39Row(new Array(400).fill(200)), null);
});
