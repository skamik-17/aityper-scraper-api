/**
 * Per-bookmaker fallback to the old Playwright implementation of a scraper
 * that has moved to a browserless transport: SCRAPER_TRANSPORT_<BM>=browser.
 */
import type { PolishBookmaker } from "./index.js";

export type TransportOverride = "browser";

export function getTransportOverride(
  bookmaker: PolishBookmaker,
  env: NodeJS.ProcessEnv = process.env,
): TransportOverride | undefined {
  const name = `SCRAPER_TRANSPORT_${bookmaker.toUpperCase()}`;
  const value = env[name];
  if (value === undefined || value.trim() === "") return undefined;
  if (value.trim().toLowerCase() === "browser") return "browser";
  console.warn(`[transport] Ignoring ${name}="${value}": only "browser" is recognised`);
  return undefined;
}
