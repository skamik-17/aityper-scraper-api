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
import {
  MARKET_GROUPS,
  MARKET_TYPES,
} from "./constants.js";
import type {
  LVBetMarket,
  LVBetSelection,
  ParsedTeams,
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
      externalId: s.selection_id,
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
    // Carry the LVBet market-type (class) id. It is shared by sibling
    // products (one class can cover several market names), so any id-keyed
    // lookup downstream must also check the name.
    bookmakerMarketId: market.markets_class_id != null ? String(market.markets_class_id) : undefined,
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
  // Audit r14 (Arsenal vs Coventry City): these three were left end-to-end
  // anchored when the shots/celne siblings above got the "- powyżej N (musi
  // rozpocząć...)" tolerance in round 8 — the production raw name carries
  // that same infix/suffix here too ("Zawodnicy (faule popełnione) -
  // powyżej 4.5 (musi rozpocząć w wyjściowej \"11\")"), so every threshold
  // fell through unsplit and collided on one key; PLAYER_FOULS "1+" for
  // Brandon Thomas-Asante was showing the 4.5-line's price (15) instead of
  // the 0.5-line's (1.16, matching peers' ~1.32 median almost exactly).
  {
    pattern: /^zawodnicy \(faule popełnione\)(?: - powyzej [\d.,]+)?(?: \(musi rozpoczac[^)]*\))?$/,
    selectionLabel: (market) => (market.line ? `Powyzej ${market.line}` : "Powyzej"),
  },
  {
    pattern: /^zawodnicy \(faule zarobione\)(?: - powyzej [\d.,]+)?(?: \(musi rozpoczac[^)]*\))?$/,
    selectionLabel: (market) => (market.line ? `Powyzej ${market.line}` : "Powyzej"),
  },
  {
    pattern: /^odbiory-\s*tackles(?: - powyzej [\d.,]+)?(?: \(musi rozpoczac[^)]*\))?$/,
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
      bookmakerMarketId: market.markets_class_id != null ? String(market.markets_class_id) : undefined,
      groupName: getMarketGroup(market.name || ""),
      type: getMarketType(market.name || ""),
      paramValue: sel.name,
      selections: [{ name: selectionLabel, odds: sel.odds, externalId: sel.externalId }],
    });
  }

  return results.length > 0 ? results : null;
}

/**
 * LVBet market group that holds the per-player stat ladders: one market per
 * stat, every player's tiers bundled as "<Player> <N>+" selections.
 */
const PLAYER_STAT_LADDER_GROUP = "Zawodnicy - statystyki";

/**
 * Normalized names (normalizeMarketName output) of the "Zawodnicy -
 * statystyki" ladders that have a player-parameter catalog code. Must stay in
 * sync with LVBET_PLAYER_LADDER_PATTERNS in lvbet-normalizer.ts (a test ties
 * the two). A ladder missing here stays unsplit, and the normalizer then
 * drops it to OTHER instead of publishing "<Player> <N>+" as a player code.
 */
export const PLAYER_STAT_LADDER_NAMES: ReadonlySet<string> = new Set([
  "strzały",
  "strzały celne",
  "popełnione faule",
  "faule na zawodniku",
  "odbiory (tackle)",
  "asysty",
  "spalone zawodnika",
  "obrony bramkarza",
  "strzały celne głowa",
  "strzały celne spoza pola karnego",
]);

const PLAYER_LADDER_SELECTION_PATTERN = /^(.+\S)\s+(\d+)\+$/;

/**
 * Splits a "Zawodnicy - statystyki" ladder ("Strzały": "Viktor Gyokeres 3+",
 * "Viktor Gyokeres 4+", ...) into one ScrapedMarket per player, carrying the
 * player via `paramValue` and each tier N as a "Powyzej <N - 0.5>" selection,
 * so the normalizer reuses the bulk-split "Powyżej X" -> "N+" tier mapping.
 * Returns null (the market stays unsplit) unless the market is in the ladder
 * group, its name is a mapped ladder, and every valid selection has the
 * "<Player> <N>+" shape: any drift leaves the whole ladder unsplit rather
 * than guessing a player out of an unknown label.
 */
export function splitPlayerStatLadderMarket(
  market: LVBetMarket,
  seenPlayerParams: Set<string>
): ScrapedMarket[] | null {
  if (market.markets_group?.name !== PLAYER_STAT_LADDER_GROUP) return null;

  const normalizedName = normalizeMarketName(market.name || "");
  if (!PLAYER_STAT_LADDER_NAMES.has(normalizedName)) return null;

  const selections = convertSelections(market.selections ?? []);
  if (selections.length === 0) return null;

  const tiersByPlayer = new Map<string, Array<{ tier: number; selection: MarketSelection }>>();
  for (const selection of selections) {
    const match = selection.name.match(PLAYER_LADDER_SELECTION_PATTERN);
    if (!match) return null;
    const player = match[1];
    const tier = Number(match[2]);
    const tiers = tiersByPlayer.get(player) ?? [];
    // Two prices for one player's tier is not a known shape: picking either
    // would be a guess, so leave the whole ladder unsplit.
    if (tiers.some((t) => t.tier === tier)) return null;
    tiers.push({ tier, selection });
    tiersByPlayer.set(player, tiers);
  }

  const results: ScrapedMarket[] = [];
  for (const [player, tiers] of tiersByPlayer) {
    // A second market instance of the same ladder must not emit the same
    // player twice (the rows would collide on one downstream market key).
    const dedupeKey = `ladder::${normalizedName}::${player}`;
    if (seenPlayerParams.has(dedupeKey)) continue;
    seenPlayerParams.add(dedupeKey);

    results.push({
      name: market.name,
      bookmakerMarketId: market.markets_class_id != null ? String(market.markets_class_id) : undefined,
      groupName: getMarketGroup(market.name || ""),
      type: getMarketType(market.name || ""),
      paramValue: player,
      selections: tiers
        .sort((a, b) => a.tier - b.tier)
        .map(({ tier, selection }) => ({
          name: `Powyzej ${tier - 0.5}`,
          odds: selection.odds,
          externalId: selection.externalId,
        })),
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
    // Create unique key to avoid duplicates. Prefer the per-instance
    // market_id: LVBet publishes distinct products under the same name and
    // line (e.g. the exact and the range "Arsenal - Dokładna liczba goli"),
    // and deduping by name alone silently drops all but the first one.
    const key = market.market_id ?? `${market.name}_${market.line ?? ""}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const bulkSplit = splitBulkPlayerListMarket(market, teams, seenPlayerParams);
    if (bulkSplit) {
      result.push(...bulkSplit);
      continue;
    }

    const ladderSplit = splitPlayerStatLadderMarket(market, seenPlayerParams);
    if (ladderSplit) {
      result.push(...ladderSplit);
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
 * Validate that a match has minimum required data
 */
export function isValidMatch(match: {
  home?: string[];
  away?: string[];
}): boolean {
  return Boolean(match.home?.[0] && match.away?.[0]);
}
