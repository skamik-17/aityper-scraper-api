/**
 * UOF specifier strings (`hcp=-1.5`, `from=0:00|to=15:00|total=0.5`) and the line formats
 * built from them. Shared by the Betby parser and the Betby normalizer, so both read a
 * specifier the same way.
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
 * A handicap or total line by how it settles: whole lines can push, quarter lines split
 * the stake, half lines do neither. Expects a finite value on the quarter grid (UOF lines
 * are): anything that is neither whole nor half, NaN included, comes back as "quarter",
 * so a caller that cannot trust its input must check `Number.isFinite` first.
 */
export function classifyLine(v: number): "half" | "integer" | "quarter" {
  if (Number.isInteger(v)) return "integer";
  if (Number.isInteger(v * 2)) return "half";
  return "quarter";
}

/**
 * A handicap line with its sign: `+1.5`, `-1`. Zero is `"0"` (decision D1, the majority
 * spelling among the bookmakers that pool ASIAN_HANDICAP). `String()` already drops a
 * trailing `.0`, so `hcp=-1.0` and `hcp=-1` both give `"-1"`.
 */
export function formatSignedLine(v: number): string {
  if (v === 0) return "0";
  return v > 0 ? `+${String(v)}` : String(v);
}

/** A total line without a sign: `2.5`, `3`. */
export function formatLine(v: number): string {
  return String(v);
}
