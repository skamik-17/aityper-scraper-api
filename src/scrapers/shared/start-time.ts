/**
 * Normalizes a bookmaker kickoff value to an ISO 8601 UTC string.
 * A number > 0 below 1e12 is epoch seconds, otherwise epoch milliseconds;
 * a string goes through Date.parse. Anything unusable yields undefined.
 */
export function toIsoStartTime(value: number | string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;

  let ms: number;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return undefined;
    ms = value < 1e12 ? value * 1000 : value;
  } else {
    ms = Date.parse(value);
    if (!Number.isFinite(ms)) return undefined;
  }
  return new Date(ms).toISOString();
}
