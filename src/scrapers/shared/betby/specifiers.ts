/**
 * UOF specifier strings (`hcp=-1.5`, `from=0:00|to=15:00|total=0.5`) and the line formats
 * built from them. Shared by the Betby parser and the Betby normalizer, so both read a
 * specifier the same way.
 *
 * A line that goes into a market key must come from `readLine`, `readTotalLine` or
 * `readEuropeanHandicap`, never from a bare `Number(raw)`: `Number("")` is 0, `Number("abc")`
 * is NaN, and `classifyLine`/`formatLine`/`formatSignedLine` trust their input. A reader that
 * returns null means the market is skipped (a missing market beats a wrong line).
 */

/** `a=1|b=x:y` -> `{ a: "1", b: "x:y" }`. Each part splits on its first `=` only. */
export function parseSpecifiers(s: string): Record<string, string> {
  const specs: Record<string, string> = {};
  if (s === "") return specs;
  for (const part of s.split("|")) {
    const eq = part.indexOf("=");
    if (eq === -1) specs[part] = "";
    else specs[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return specs;
}

/**
 * A decimal line as UOF writes it: an optional sign, digits, an optional fraction. No blanks,
 * exponents, hex, `Infinity` or bare `.5`/`2.` spellings, all of which `Number()` would accept
 * or turn into 0.
 */
const DECIMAL_LINE_RE = /^[+-]?\d+(\.\d+)?$/;

/**
 * A handicap or total line read from a specifier value (`hcp=-1.0` -> -1). Returns null unless
 * the value is a plain decimal on the quarter grid (…, -0.25, 0, 0.25, …). The safe-integer
 * bound keeps `String()` of the line out of exponent notation.
 */
export function readLine(v: string | undefined): number | null {
  if (v === undefined || !DECIMAL_LINE_RE.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n * 4) ? n : null;
}

/** A total line (`total=2.5`): a `readLine` value above zero, else null. */
export function readTotalLine(v: string | undefined): number | null {
  const n = readLine(v);
  return n !== null && n > 0 ? n : null;
}

/** `a:b` with whole goal counts, as UOF writes a European handicap. */
const SCORE_HANDICAP_RE = /^(\d+):(\d+)$/;

/**
 * A European handicap `hcp=a:b` as the home side's goal start a-b (`1:0` -> +1, `0:1` -> -1).
 * Returns null when the value is not `a:b` with whole numbers, and when a == b: a level start
 * is plain 1X2, which the phase-1 table skips.
 */
export function readEuropeanHandicap(v: string | undefined): number | null {
  const m = v === undefined ? null : SCORE_HANDICAP_RE.exec(v);
  if (m === null) return null;
  const start = Number(m[1]) - Number(m[2]);
  return start !== 0 && Number.isSafeInteger(start) ? start : null;
}

/**
 * A handicap or total line by how it settles: whole lines can push, quarter lines split
 * the stake, half lines do neither. Expects a value from `readLine`/`readTotalLine`: anything
 * that is neither whole nor half, NaN and off-grid values included, comes back as "quarter".
 */
export function classifyLine(v: number): "half" | "integer" | "quarter" {
  if (Number.isInteger(v)) return "integer";
  if (Number.isInteger(v * 2)) return "half";
  return "quarter";
}

/**
 * A handicap line with its sign: `+1.5`, `-1`. Zero is `"0"` (decision D1, the majority
 * spelling among the bookmakers that pool ASIAN_HANDICAP). `String()` already drops a
 * trailing `.0`, so `hcp=-1.0` and `hcp=-1` both give `"-1"`. Expects a value from a reader
 * above (NaN would print as `"NaN"`).
 */
export function formatSignedLine(v: number): string {
  if (v === 0) return "0";
  return v > 0 ? `+${String(v)}` : String(v);
}

/** A total line without a sign: `2.5`, `3`. Expects a value from `readTotalLine`. */
export function formatLine(v: number): string {
  return String(v);
}
