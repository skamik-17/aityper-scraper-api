/**
 * Normalizer for the Betby brands (betters, lebull). The scraper hands over Sportradar UOF
 * markets as they are: `bookmakerMarketId` is the UOF market id, `paramValue` the raw
 * specifier string (`total=2.5`, `hcp=1:0`) and each selection's `externalId` its UOF
 * outcome id. `BETBY_MARKET_RULES` maps those ids; labels are kept for display only.
 *
 * Markets without a rule, with a line the rule rejects, or with no mapped outcome return
 * null, which the facade stores as a hidden OTHER row.
 */
import { getMarketMetadata } from "../../../data/market-catalog.js";
import { parseSpecifiers } from "../../../scrapers/shared/betby/specifiers.js";
import type { BetbyBookmaker } from "../../../scrapers/shared/betby/types.js";
import { buildMarketKey } from "../helpers/index.js";
import type {
  BookmakerMarketNormalizer,
  NormalizedMarketOutput,
  NormalizedSelection,
  RawBookmakerMarket,
} from "../types.js";
import { BETBY_MARKET_RULES } from "./betby-market-rules.js";

export function createBetbyNormalizer(bookmaker: BetbyBookmaker): BookmakerMarketNormalizer {
  return {
    bookmaker,

    // Sides come from UOF outcome ids, so the context's team names are not needed.
    normalizeMarket(raw: RawBookmakerMarket): NormalizedMarketOutput | null {
      if (raw.bookmakerMarketId === undefined) return null;
      // The facade turns an all-digit id into a number; the table is keyed by string.
      const marketId = String(raw.bookmakerMarketId);
      if (!Object.hasOwn(BETBY_MARKET_RULES, marketId)) return null;
      const rule = BETBY_MARKET_RULES[marketId];

      const resolved = rule.resolve(parseSpecifiers(raw.paramValue ?? ""));
      if (resolved === null) return null;

      // An empty vocabulary (correct score) accepts every code the rule produces.
      const vocabulary = getMarketMetadata(resolved.code)?.selections ?? [];
      const selections: NormalizedMarketOutput["selections"] = [];
      for (const s of raw.selections) {
        const code = rule.outcome(s.externalId, s.name);
        if (code === null || (vocabulary.length > 0 && !vocabulary.includes(code))) continue;
        selections.push({ code: code as NormalizedSelection, label: s.name, odds: s.odds });
      }
      if (selections.length === 0) return null;

      return {
        marketCode: resolved.code,
        paramValue: resolved.paramValue,
        marketKey: buildMarketKey(resolved.code, resolved.paramValue),
        selections,
        debug: { rawName: raw.name, rawId: raw.bookmakerMarketId, matchedBy: "id" },
      };
    },
  };
}
