/**
 * LVBet Parser Module
 *
 * Pure parsing logic for transforming LVBet API responses
 * into the unified ScrapedMarket format.
 *
 * This module has NO Playwright dependencies - it only works with
 * raw JSON data from the API.
 */

import type { MarketSelection, ScrapedMarket } from "../../../types/full-offer.js";
import type { MarketOverUnderOdds } from "../../../types/full-offer.js";
import {
  PRIMARY_1X2_NAMES,
  EXCLUDED_1X2_PATTERNS,
  DOUBLE_CHANCE_PATTERNS,
  BTTS_POSITIVE_PATTERNS,
  BTTS_NEGATIVE_PATTERNS,
  OVER_UNDER_EXACT_NAMES,
  MARKET_GROUPS,
  MARKET_TYPES,
  SELECTION_ORDERS,
  DC_SELECTION_ORDERS,
} from "./constants.js";
import type {
  LVBetMarket,
  LVBetSelection,
  ParsedTeams,
  Parsed1X2Odds,
  ParsedDoubleChanceOdds,
  ParsedBTTSOdds,
} from "./types.js";

/**
 * Normalize market name for pattern matching
 * Removes diacritics, converts to lowercase
 */
function normalizeMarketName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Check if a name matches any pattern in a list
 */
function matchesPattern(name: string, patterns: readonly string[]): boolean {
  const normalized = normalizeMarketName(name);
  return patterns.some((pattern) => normalized.includes(pattern));
}

/**
 * Check if a name exactly matches any pattern in a list
 */
function matchesExact(name: string, patterns: readonly string[]): boolean {
  const normalized = normalizeMarketName(name);
  return patterns.some((pattern) => normalized === pattern);
}

/**
 * Get market group name for UI organization
 */
function getMarketGroup(marketName: string): string {
  const normalized = normalizeMarketName(marketName);

  for (const [pattern, group] of Object.entries(MARKET_GROUPS)) {
    if (normalized.includes(pattern)) {
      return group;
    }
  }

  return "Inne";
}

/**
 * Get normalized market type identifier
 */
function getMarketType(marketName: string): string | undefined {
  const normalized = normalizeMarketName(marketName);

  for (const [pattern, type] of Object.entries(MARKET_TYPES)) {
    if (normalized.includes(pattern)) {
      return type;
    }
  }

  return undefined;
}

/**
 * Check if market is a primary 1X2 market
 */
export function isPrimary1X2Market(market: LVBetMarket): boolean {
  if (market.selections?.length !== 3) return false;
  if (market.is_primary === true) return true;

  const name = normalizeMarketName(market.name || "");
  return PRIMARY_1X2_NAMES.some((pattern) => name === pattern);
}

/**
 * Check if market is a valid fallback 1X2 market (not a special market)
 */
export function isValidFallback1X2Market(market: LVBetMarket): boolean {
  if (market.selections?.length !== 3) return false;

  const name = normalizeMarketName(market.name || "");
  if (!name.includes("wynik")) return false;

  // Exclude special markets
  return !EXCLUDED_1X2_PATTERNS.some((pattern) => name.includes(pattern));
}

/**
 * Check if market is a Double Chance market
 */
export function isDoubleChanceMarket(market: LVBetMarket): boolean {
  if (market.selections?.length !== 3) return false;
  return matchesPattern(market.name || "", DOUBLE_CHANCE_PATTERNS);
}

/**
 * Check if market is a BTTS market (not half-time variants)
 */
export function isBTTSMarket(market: LVBetMarket): boolean {
  if (market.selections?.length !== 2) return false;

  const name = normalizeMarketName(market.name || "");
  const hasPositive = BTTS_POSITIVE_PATTERNS.every((p) => name.includes(p));
  const hasNegative = BTTS_NEGATIVE_PATTERNS.some((p) => name.includes(p));

  return hasPositive && !hasNegative;
}

/**
 * Check if market is a full-match Over/Under market
 */
export function isOverUnderMarket(market: LVBetMarket): boolean {
  return matchesExact(market.name || "", OVER_UNDER_EXACT_NAMES);
}

/**
 * Parse 1X2 odds from selections
 */
export function parse1X2Odds(selections: LVBetSelection[]): Parsed1X2Odds {
  const odds: Parsed1X2Odds = { home: 0, draw: 0, away: 0 };

  for (const s of selections) {
    if (s.order === SELECTION_ORDERS.HOME) {
      odds.home = s.rate?.decimal || 0;
    } else if (s.order === SELECTION_ORDERS.DRAW) {
      odds.draw = s.rate?.decimal || 0;
    } else if (s.order === SELECTION_ORDERS.AWAY) {
      odds.away = s.rate?.decimal || 0;
    }
  }

  return odds;
}

/**
 * Parse Double Chance odds from selections
 */
export function parseDoubleChanceOdds(selections: LVBetSelection[]): ParsedDoubleChanceOdds {
  const odds: ParsedDoubleChanceOdds = { homeOrDraw: 0, homeOrAway: 0, drawOrAway: 0 };

  for (const s of selections) {
    if (s.order === DC_SELECTION_ORDERS.HOME_OR_DRAW) {
      odds.homeOrDraw = s.rate?.decimal || 0;
    } else if (s.order === DC_SELECTION_ORDERS.HOME_OR_AWAY) {
      odds.homeOrAway = s.rate?.decimal || 0;
    } else if (s.order === DC_SELECTION_ORDERS.DRAW_OR_AWAY) {
      odds.drawOrAway = s.rate?.decimal || 0;
    }
  }

  return odds;
}

/**
 * Parse BTTS odds from selections
 */
export function parseBTTSOdds(selections: LVBetSelection[]): ParsedBTTSOdds {
  const odds: ParsedBTTSOdds = { yes: 0, no: 0 };

  for (const s of selections) {
    if (s.order === 0) {
      odds.yes = s.rate?.decimal || 0;
    } else if (s.order === 1) {
      odds.no = s.rate?.decimal || 0;
    }
  }

  return odds;
}

/**
 * Parse Over/Under odds from selections
 */
export function parseOverUnderOdds(
  selections: LVBetSelection[]
): { over: number; under: number } {
  let over = 0;
  let under = 0;

  for (const s of selections) {
    const name = (s.name || "").toLowerCase();
    if (name.includes("powyżej") || name.includes("powyzej")) {
      over = s.rate?.decimal || 0;
    } else if (name.includes("poniżej") || name.includes("ponizej")) {
      under = s.rate?.decimal || 0;
    }
  }

  return { over, under };
}

/**
 * Build a map of 1X2 odds by match_id from markets array
 * Prioritizes primary markets, falls back to "wynik" markets
 */
export function buildOddsMap(
  markets: LVBetMarket[]
): Map<string, Parsed1X2Odds> {
  const oddsMap = new Map<string, Parsed1X2Odds>();

  // First pass: find primary markets
  for (const market of markets) {
    const matchId = market.match_id;
    if (oddsMap.has(matchId)) continue;

    if (isPrimary1X2Market(market) && market.selections) {
      const odds = parse1X2Odds(market.selections);
      if (odds.home > 1 && odds.draw > 1 && odds.away > 1) {
        oddsMap.set(matchId, odds);
      }
    }
  }

  // Second pass: fallback for matches without primary market
  for (const market of markets) {
    const matchId = market.match_id;
    if (oddsMap.has(matchId)) continue;

    if (isValidFallback1X2Market(market) && market.selections) {
      const odds = parse1X2Odds(market.selections);
      if (odds.home > 1 && odds.draw > 1 && odds.away > 1) {
        oddsMap.set(matchId, odds);
      }
    }
  }

  return oddsMap;
}

/**
 * Convert LVBet selections to unified MarketSelection format
 */
function convertSelections(
  selections: LVBetSelection[],
  teams?: ParsedTeams
): MarketSelection[] {
  return selections
    .map((s) => ({
      name: s.name || `Selection ${s.order}`,
      odds: s.rate?.decimal || 0,
      externalId: String(s.id),
      status: s.status === "active" ? ("active" as const) : undefined,
    }))
    // Decimal odds <= 1.0 are suspended/placeholder cells (zero payout is
    // mathematically impossible for a real price) — never emit them.
    .filter((s) => s.odds > 1);
}

/**
 * Parse a single market into ScrapedMarket format
 */
export function parseMarket(
  market: LVBetMarket,
  teams?: ParsedTeams
): ScrapedMarket | null {
  if (!market.selections || market.selections.length === 0) {
    return null;
  }

  const validSelections = market.selections.filter(
    (s) => s.rate?.decimal && s.rate.decimal > 1
  );

  if (validSelections.length === 0) {
    return null;
  }

  // Build market name (include line for O/U markets)
  let marketName = market.name || "Unknown";
  if (market.line) {
    marketName = `${marketName} ${market.line}`;
  }

  return {
    name: marketName,
    // Carry the stable LVBet market id so the normalization audit can match
    // by id instead of relying on brittle name-regex matching.
    bookmakerMarketId: market.id != null ? String(market.id) : undefined,
    groupName: getMarketGroup(market.name || ""),
    type: getMarketType(market.name || ""),
    selections: convertSelections(validSelections, teams),
  };
}

/**
 * LVBet raw-market name fragments that bundle an entire player roster into
 * ONE market object (each selection is a player's name/odds pair, not a bet
 * outcome) instead of the usual one-market-per-player shape. Left unsplit,
 * the normalizer has no per-player parameter to key on and either merges
 * every player into a shared "base" bucket or, worse, treats the player's
 * name itself as the selection code — silently hiding these prices from
 * cross-bookmaker best-odds comparison. `selectionLabel` synthesizes the
 * market's real bet outcome (its own threshold/result) so the normalizer can
 * map it to the correct catalog selection code once the player identity
 * moves to `paramValue` (mirrors betcris' parser-level bulk-player split).
 */
const BULK_PLAYER_LIST_MARKET_PATTERNS: Array<{
  pattern: RegExp;
  selectionLabel: (market: LVBetMarket, normalizedName: string) => string | null;
}> = [
  // "Zawodnicy (strzały celne)" / "Total Shots On Target" / "Strzały celne
  // (musi rozpocząć)" — threshold lives in market.line ("0.5".."4.5"). The
  // production raw name always carries a "- powyżej X (musi rozpocząć w
  // wyjściowej "11")" infix/suffix (audit-match, Arsenal vs Coventry City,
  // round 8 P1); the OLD end-to-end anchor never matched that shape, so the
  // roster fell through to the generic per-market parser with raw player
  // names as selections instead of being split. Anchored end-to-end but now
  // tolerant of the optional "- powyżej N" infix and "(musi rozpocząć...)"
  // suffix, plus an unanchored catch-all for any other ordering.
  {
    pattern:
      /^zawodnicy \(strzały celne\)(?: - powyzej [\d.,]+)?(?: \(musi rozpoczac[^)]*\))?$|total shots on target|strzały celne\b.*\(musi rozpoczac/,
    selectionLabel: (market) => (market.line ? `Powyzej ${market.line}` : null),
  },
  // "Zawodnicy (strzały)" / "Total Shots (must start)" / "Strzały (musi
  // rozpocząć)" — same production shape and same fix as the celne entry
  // above (round 8 P1). The catalog's PLAYER_SHOTS now carries a full
  // "1+".."9+" tier ladder (round 8 P5), so unlike before, every threshold
  // must flow through as its own "Powyzej <line>" label instead of a
  // constant marker — normalizeLvbetPlayerThreshold (lvbet-normalizer.ts)
  // maps each one to its tier. This also folds in the 7.5 threshold, which
  // used to be carved out to the separate PLAYER_SHOTS_OVER code (round 8
  // P4: not a distinct product, just another rung of the same ladder).
  {
    pattern:
      /^zawodnicy \(strzały\)(?: - powyzej [\d.,]+)?(?: \(musi rozpoczac[^)]*\))?$|total shots \(must start\)|strzały\b.*\(musi rozpoczac/,
    selectionLabel: (market) => (market.line ? `Powyzej ${market.line}` : "Powyzej"),
  },
  // "Zawodnicy (faule popełnione)" / "Zawodnicy (faule zarobione)" / "Odbiory
  // - Tackles" — same bundled-roster shape for the other player stat lines.
  // Anchored end-to-end for the same reason as the shots patterns above:
  // "zawodnicy (faule popełnione) - powyżej 3.5" has its own dedicated
  // PLAYER_FOULS_OVER catalog code.
  {
    pattern: /^zawodnicy \(faule popełnione\)$/,
    selectionLabel: (market) => (market.line ? `Powyzej ${market.line}` : "Powyzej"),
  },
  {
    pattern: /^zawodnicy \(faule zarobione\)$/,
    selectionLabel: (market) => (market.line ? `Powyzej ${market.line}` : "Powyzej"),
  },
  {
    pattern: /^odbiory-\s*tackles$/,
    selectionLabel: (market) => (market.line ? `Powyzej ${market.line}` : "Powyzej"),
  },
  // "Zawodnik strzeli N lub więcej goli" (N >= 3) — the threshold is embedded
  // in the market name itself, not market.line. Anchored to the START of the
  // name and excludes N=2/1: "Zawodnik strzeli 2 lub więcej goli" has its own
  // dedicated YES/NO catalog code (PLAYER_2_OR_MORE_GOALS), and "Dowolny
  // zawodnik strzeli 3 lub więcej goli" (HAT_TRICK) is a different YES/NO
  // market entirely.
  // N=3 and N=4 each route to their own one-price YES/NO catalog code
  // (PLAYER_3_OR_MORE_GOALS / PLAYER_4_OR_MORE_GOALS — audit-match, Arsenal
  // vs Coventry City, round 8): the label used to synthesize a tiered "N+"
  // marker, but neither target code's selection vocabulary is a tiered
  // ladder (both are plain YES/NO), so that marker had no catalog
  // counterpart and was silently dropped. A fixed "Tak" marker matches the
  // shape every other bulk-split single-price market already uses here.
  {
    pattern: /^zawodnik strzeli ([3-9]|\d{2,}) lub wiecej goli$/,
    selectionLabel: () => "Tak",
  },
  // "Zawodnik strzeli gola i mecz zakończy się remisem" — every row prices
  // the fixed "scores AND match ends in a draw" outcome for that player.
  {
    pattern: /zawodnik strzeli gola i mecz zakonczy sie remisem/,
    selectionLabel: () => "Remis",
  },
];

/**
 * Splits a raw LVBet market whose name matches a known bundled-player-roster
 * pattern into one synthetic ScrapedMarket per player, carrying the player's
 * raw name via `paramValue` and the market's real outcome (threshold/result)
 * as the single selection. Returns null when the market's name does not
 * match a known bundled pattern, when no odds survive filtering, or when the
 * resolved selection label is unavailable (e.g. a market missing the `line`
 * its label needs).
 */
function splitBulkPlayerListMarket(
  market: LVBetMarket,
  teams: ParsedTeams | undefined,
  seenPlayerParams: Set<string>
): ScrapedMarket[] | null {
  if (!market.selections || market.selections.length === 0) return null;

  const normalizedName = normalizeMarketName(market.name || "");
  const config = BULK_PLAYER_LIST_MARKET_PATTERNS.find(({ pattern }) => pattern.test(normalizedName));
  if (!config) return null;

  const selectionLabel = config.selectionLabel(market, normalizedName);
  if (!selectionLabel) return null;

  const validSelections = market.selections.filter((s) => s.rate?.decimal && s.rate.decimal > 1);
  if (validSelections.length === 0) return null;

  const marketName = market.line ? `${market.name} ${market.line}` : market.name || "Unknown";
  const results: ScrapedMarket[] = [];

  for (const sel of convertSelections(validSelections, teams)) {
    // Different thresholds of the SAME bundled market share one dedupe key
    // whenever selectionLabel does not vary by line (e.g. plain "Powyzej"
    // for PLAYER_SHOTS, which has no per-threshold catalog tiers) — this
    // keeps only the first-seen line per player instead of emitting several
    // rows that would collide on the same downstream market key.
    const dedupeKey = `${normalizedName}::${sel.name}::${selectionLabel}`;
    if (seenPlayerParams.has(dedupeKey)) continue;
    seenPlayerParams.add(dedupeKey);

    results.push({
      name: marketName,
      bookmakerMarketId: market.id != null ? String(market.id) : undefined,
      groupName: getMarketGroup(market.name || ""),
      type: getMarketType(market.name || ""),
      paramValue: sel.name,
      selections: [{ name: selectionLabel, odds: sel.odds, externalId: sel.externalId }],
    });
  }

  return results.length > 0 ? results : null;
}

/**
 * Parse ALL markets from LVBet markets array into unified ScrapedMarket format
 * This is the main function for full offer scraping
 */
export function parseAllMarkets(
  markets: LVBetMarket[],
  teams?: ParsedTeams
): ScrapedMarket[] {
  const result: ScrapedMarket[] = [];
  const seenKeys = new Set<string>();
  const seenPlayerParams = new Set<string>();

  for (const market of markets) {
    // Create unique key to avoid duplicates. Prefer the stable market id:
    // LVBet can expose several market instances under the same name (e.g.
    // player lists split across instances) and deduping by name alone would
    // silently drop all but the first instance.
    const key =
      market.id != null ? `id:${market.id}` : `${market.name}_${market.line || ""}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const bulkSplit = splitBulkPlayerListMarket(market, teams, seenPlayerParams);
    if (bulkSplit) {
      result.push(...bulkSplit);
      continue;
    }

    const parsedMarket = parseMarket(market, teams);
    if (parsedMarket) {
      result.push(parsedMarket);
    }
  }

  return result;
}

/**
 * Parse extended markets for scrapeMatchDetails compatibility
 * Returns 1X2, Double Chance, BTTS, and Over/Under from markets array
 */
export function parseExtendedMarkets(markets: LVBetMarket[]): {
  market1X2: Parsed1X2Odds;
  marketDoubleChance?: ParsedDoubleChanceOdds;
  marketBTTS?: ParsedBTTSOdds;
  marketOverUnder?: Record<string, MarketOverUnderOdds>;
} {
  const result: {
    market1X2: Parsed1X2Odds;
    marketDoubleChance?: ParsedDoubleChanceOdds;
    marketBTTS?: ParsedBTTSOdds;
    marketOverUnder?: Record<string, MarketOverUnderOdds>;
  } = {
    market1X2: { home: 0, draw: 0, away: 0 },
  };

  const overUnderLines: Record<string, MarketOverUnderOdds> = {};

  // Find primary 1X2 first
  for (const market of markets) {
    if (result.market1X2.home > 0) break;

    if (isPrimary1X2Market(market) && market.selections) {
      result.market1X2 = parse1X2Odds(market.selections);
    }
  }

  // Parse other markets
  for (const market of markets) {
    if (!market.selections) continue;

    // Double Chance
    if (!result.marketDoubleChance && isDoubleChanceMarket(market)) {
      const odds = parseDoubleChanceOdds(market.selections);
      if (odds.homeOrDraw > 0) {
        result.marketDoubleChance = odds;
      }
    }

    // BTTS
    if (!result.marketBTTS && isBTTSMarket(market)) {
      const odds = parseBTTSOdds(market.selections);
      if (odds.yes > 0) {
        result.marketBTTS = odds;
      }
    }

    // Over/Under
    if (isOverUnderMarket(market) && market.line) {
      const line = parseFloat(market.line);
      if (line > 0 && market.line.includes(".5")) {
        const lineStr = line.toFixed(1);
        const odds = parseOverUnderOdds(market.selections);
        if (odds.over > 0 && odds.under > 0) {
          overUnderLines[lineStr] = odds;
        }
      }
    }
  }

  if (Object.keys(overUnderLines).length > 0) {
    result.marketOverUnder = overUnderLines;
  }

  return result;
}

/**
 * Validate that a match has minimum required data
 */
export function isValidMatch(match: {
  home?: string[];
  away?: string[];
}): boolean {
  return Boolean(match.home?.[0] && match.away?.[0]);
}

/**
 * Check if 1X2 odds are valid
 */
export function hasValid1X2Odds(odds: Parsed1X2Odds): boolean {
  return odds.home > 1 && odds.draw > 1 && odds.away > 1;
}
