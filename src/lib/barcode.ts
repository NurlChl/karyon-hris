/**
 * Code 39 for asset labels: printing (SVG) and reading from a camera frame.
 *
 * One table drives both, written as the standard narrow/wide sequence of the
 * nine elements (bar, space, bar, …). The earlier hand-typed bit strings had
 * F encoded as J and an invalid P, so labels such as `AST-LAP-001` could not be
 * read by any scanner.
 */
export const CODE39: Record<string, string> = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw",
  "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn", "9": "nnwwnnwnn",
  A: "wnnnnwnnw", B: "nnwnnwnnw", C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn",
  F: "nnwnwwnnn", G: "nnnnnwwnw", H: "wnnnnwwnn", I: "nnwnnwwnn", J: "nnnnwwwnn",
  K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww", O: "wnnnwnnwn",
  P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn",
  U: "wwnnnnnnw", V: "nwwnnnnnw", W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn",
  Z: "nwwnwnnnn", "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "*": "nwnnwnwnn",
};
const DECODE = Object.fromEntries(Object.entries(CODE39).map(([char, pattern]) => [pattern, char]));

/** Bit string (1 = bar module) for one character, wide elements are two modules. */
function bits(char: string) {
  const pattern = CODE39[char] ?? CODE39[" "];
  return [...pattern].map((width, i) => (i % 2 === 0 ? "1" : "0").repeat(width === "w" ? 2 : 1)).join("");
}

export function generateCode39Svg(text: string): { svg: string; width: number; height: number } {
  const bitstring = [...`*${text.toUpperCase()}*`].map((char) => bits(char) + "0").join("");
  const barWidth = 2;
  const height = 45;
  const totalWidth = bitstring.length * barWidth;

  let rects = "";
  for (let i = 0; i < bitstring.length; i++) {
    if (bitstring[i] === "1") rects += `<rect x="${i * barWidth}" y="0" width="${barWidth}" height="${height}" fill="currentColor" />`;
  }
  const svg = `<svg viewBox="0 0 ${totalWidth} ${height}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="text-slate-800 dark:text-slate-200">${rects}</svg>`;
  return { svg, width: totalWidth, height };
}

/**
 * Decodes Code 39 from one row of luminance values (0–255). Returns the text
 * between the `*` guards, or null. Tolerates either reading direction.
 */
export function decodeCode39Row(row: ArrayLike<number>): string | null {
  let min = 255, max = 0;
  for (let i = 0; i < row.length; i++) {
    if (row[i] < min) min = row[i];
    if (row[i] > max) max = row[i];
  }
  if (max - min < 48) return null;
  const threshold = (min + max) / 2;

  const runs: number[] = [];
  let dark = row[0] < threshold, length = 0;
  for (let i = 0; i < row.length; i++) {
    const d = row[i] < threshold;
    if (d === dark) length++;
    else { runs.push(dark ? length : -length); dark = d; length = 1; }
  }
  runs.push(dark ? length : -length);

  return decodeRuns(runs) ?? decodeRuns([...runs].reverse());
}

/** Runs: positive = bar width, negative = space width. */
function decodeRuns(runs: number[]): string | null {
  for (let start = 0; start + 9 <= runs.length; start++) {
    if (runs[start] <= 0) continue;
    const text = readFrom(runs, start);
    if (text !== null) return text;
  }
  return null;
}

function readFrom(runs: number[], start: number): string | null {
  let out = "", i = start, narrow = 0;
  while (i + 9 <= runs.length) {
    const widths = runs.slice(i, i + 9).map(Math.abs);
    const char = classify(widths);
    if (!char) return null;
    const unit = Math.min(...widths);
    if (!out) {
      if (char !== "*") return null;
      narrow = unit;
    } else if (unit > narrow * 2.5 || unit < narrow / 2.5) {
      return null;
    }
    if (char === "*" && out) {
      const text = out.slice(1);
      return text.length ? text : null;
    }
    out += char;
    i += 10; // nine elements plus the inter-character gap
    if (out.length > 64) return null;
  }
  return null;
}

function classify(widths: number[]): string | null {
  const sorted = [...widths].sort((a, b) => b - a);
  // Exactly three wide elements, clearly wider than the narrow ones.
  if (sorted[2] < sorted[3] * 1.6) return null;
  const cut = (sorted[2] + sorted[3]) / 2;
  return DECODE[widths.map((w) => (w > cut ? "w" : "n")).join("")] ?? null;
}
