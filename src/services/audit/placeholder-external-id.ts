/**
 * Placeholder selection ids in the audit harness.
 *
 * Several parsers build `externalId` as `String(payloadId)`. When a bookmaker
 * payload stops sending that id, every selection gets the literal "undefined"
 * (LVBet v5 and Superbet did on 2026-11-06). Such a value identifies nothing.
 * The prep archive now keeps `externalId`, so the harness drops placeholders
 * before it normalizes or archives: a harvest would otherwise freeze them into
 * a golden fixture raw, and an id-keyed normalizer would treat them as ids. A
 * dropped selection looks exactly as it did before archives kept ids. The
 * caller reports the count, so the parser bug stays visible.
 */
import type { RawAuditMarket } from "./scraper-audit-core.js";

/** What `String()` makes of a missing (`undefined`/`null`), NaN or object id. */
const STRINGIFIED_MISSING_IDS = new Set(["undefined", "null", "NaN", "[object Object]"]);

/** True when `id` is blank or what `String()` makes of a missing or non-scalar id. */
export function isPlaceholderExternalId(id: string): boolean {
  const trimmed = id.trim();
  return trimmed === "" || STRINGIFIED_MISSING_IDS.has(trimmed);
}

/**
 * Copies of `markets` whose selections carry no placeholder `externalId`, and
 * the number dropped. Markets without one are returned as the same objects;
 * names, odds, real ids and every market field are kept as scraped.
 */
export function dropPlaceholderExternalIds(markets: RawAuditMarket[]): {
  markets: RawAuditMarket[];
  dropped: number;
} {
  let dropped = 0;
  const isPlaceholder = (id: string | undefined): boolean =>
    id !== undefined && isPlaceholderExternalId(id);
  const out = markets.map((m) => {
    if (!m.selections.some((s) => isPlaceholder(s.externalId))) return m;
    return {
      ...m,
      selections: m.selections.map((s) => {
        if (!isPlaceholder(s.externalId)) return s;
        dropped++;
        return { name: s.name, odds: s.odds };
      }),
    };
  });
  return { markets: out, dropped };
}
