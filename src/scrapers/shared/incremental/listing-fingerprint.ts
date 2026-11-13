/**
 * A short, order-independent digest of the prices a bookmaker's listing shows
 * for one event. A changed fingerprint makes the event's detail due (plan 10).
 */
import { createHash } from "node:crypto";

export function listingFingerprint(parts: ReadonlyArray<readonly [key: string, value: number | string]>): string | null {
  if (parts.length === 0) return null;
  const seen = new Set<string>();
  for (const [key] of parts) {
    if (seen.has(key)) throw new Error(`duplicate fingerprint key ${key}`);
    seen.add(key);
  }
  // Keys are unique, so a plain code-unit comparison gives a total order
  const sorted = [...parts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha1").update(JSON.stringify(sorted)).digest("hex").slice(0, 16);
}

/**
 * listingFingerprint for scraper listings: a malformed listing (a duplicate key) must not
 * fail the pass, so it yields null (the kickoff tiers still apply) and one warning.
 */
export function listingFingerprintOrNull(
  parts: ReadonlyArray<readonly [key: string, value: number | string]>,
  context: string,
): string | null {
  try {
    return listingFingerprint(parts);
  } catch (error) {
    console.warn(`${context}: no listing fingerprint (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}
