/**
 * Superbet Parser Module
 *
 * Pure parsing logic for transforming Superbet API responses
 * into the unified ScrapedMarket format.
 *
 * This module has NO Playwright dependencies - it only works with
 * raw JSON data from the API.
 */

import type { MarketSelection, ScrapedMarket } from "../../../types/full-offer.js";
import type { MarketOverUnderOdds } from "../../../types/full-offer.js";
import {
  MARKET_IDS,
  MARKET_GROUPS,
  MARKET_TYPES,
  SELECTION_CODES,
  TEAM_SEPARATOR,
} from "./constants.js";
import type {
  SuperbetEvent,
  SuperbetOddsSelection,
  ParsedTeams,
} from "./types.js";

/**
 * Parse team names from the Superbet matchName format
 * Format: "HomeTeam · AwayTeam"
 */
export function parseTeamNames(matchName: string): ParsedTeams {
  const parts = matchName.split(TEAM_SEPARATOR);
  return {
    homeTeam: (parts[0] || "").trim(),
    awayTeam: (parts[1] || "").trim(),
  };
}

/**
 * Get human-readable market name based on market ID and selection data
 *
 * The Superbet API provides the authoritative display label in the
 * `marketName` field of every odds entry - prefer it whenever present.
 * The legacy id switch below had drifted from the real Superbet id space
 * (e.g. id 549 is "2.połowa - obie drużyny strzelą", NOT asian handicap;
 * id 553 is "1.połowa - handicap 1x2", NOT half-time result), so only the
 * few verified ids are kept as a fallback for responses without labels.
 */
function getMarketName(marketId: number, selection?: SuperbetOddsSelection): string {
  const apiName = selection?.marketName?.trim();
  if (apiName) {
    return apiName;
  }

  switch (marketId) {
    case MARKET_IDS.MATCH_RESULT_1X2:
      return "Wynik meczu";
    case MARKET_IDS.DOUBLE_CHANCE:
    case MARKET_IDS.DOUBLE_CHANCE_ALT:
      return "Podwojna szansa";
    case MARKET_IDS.BTTS:
    case MARKET_IDS.BTTS_ALT:
      return "Obie druzyny strzelą";
    case MARKET_IDS.TOTAL_GOALS:
      if (selection?.specialBetValue) {
        return `Liczba goli ${selection.specialBetValue}`;
      }
      return "Liczba goli";
    default:
      return `Rynek ${marketId}`;
  }
}

/**
 * Market ids whose selections legitimately arrive as bare outcome codes
 * ("1"/"0"/"2", "O"/"U") that should be renamed to display labels. For any
 * other market a short/numeric selection name ("0", "2", "3+") is a real
 * outcome (exact goal counts, ranges) and must be preserved as-is -
 * renaming those by code turned "0"/"1"/"2" into "Remis"/team names.
 */
const CODE_NAMED_MARKET_IDS = new Set<number>([
  MARKET_IDS.MATCH_RESULT_1X2,
  MARKET_IDS.DOUBLE_CHANCE,
  MARKET_IDS.DOUBLE_CHANCE_ALT,
  MARKET_IDS.BTTS,
  MARKET_IDS.BTTS_ALT,
  MARKET_IDS.TOTAL_GOALS,
  MARKET_IDS.TOTAL_GOALS_ALT,
  MARKET_IDS.TOTAL_GOALS_ALT2,
]);

/**
 * Fix malformed time-range labels coming from the Superbet API, e.g.
 * "45:00 - 59 minuty:59 minuty" -> "45:00 - 59:59 minuty".
 */
function cleanSelectionLabel(name: string): string {
  return name.replace(/(\d+)\s+minuty:(\d+)\s+minuty/u, "$1:$2 minuty");
}

/**
 * Get selection display name based on code and market type
 */
function getSelectionName(
  code: string,
  originalName: string | undefined,
  marketId: number,
  teams?: ParsedTeams
): string {
  // Use the original name whenever provided; fall through to code-based
  // renaming only for legacy core markets whose names are outcome codes.
  if (originalName && originalName.length > 0) {
    const isCodeLike = originalName.length <= 1 || /^[0-9]+$/.test(originalName);
    if (!isCodeLike || !CODE_NAMED_MARKET_IDS.has(marketId)) {
      return cleanSelectionLabel(originalName);
    }
  }

  // Map codes to display names
  switch (code) {
    // 1X2
    case SELECTION_CODES.HOME:
      if (marketId === MARKET_IDS.BTTS || marketId === MARKET_IDS.BTTS_ALT) {
        return "Tak";
      }
      return teams?.homeTeam || "1";
    case SELECTION_CODES.DRAW:
      return "Remis";
    case SELECTION_CODES.AWAY:
      if (marketId === MARKET_IDS.BTTS || marketId === MARKET_IDS.BTTS_ALT) {
        return "Nie";
      }
      return teams?.awayTeam || "2";

    // Double Chance
    case SELECTION_CODES.HOME_OR_DRAW:
    case SELECTION_CODES.HOME_OR_DRAW_ALT:
      return "1X";
    case SELECTION_CODES.DRAW_OR_AWAY:
    case SELECTION_CODES.DRAW_OR_AWAY_ALT:
      return "X2";
    case SELECTION_CODES.HOME_OR_AWAY:
      return "12";

    // Over/Under
    case SELECTION_CODES.OVER:
      return "Powyzej";
    case SELECTION_CODES.UNDER:
      return "Ponizej";

    // BTTS
    case SELECTION_CODES.BTTS_YES:
      return "Tak";
    case SELECTION_CODES.BTTS_NO:
      return "Nie";

    default:
      return originalName || code;
  }
}

/**
 * Parse 1X2 market odds from event data
 * Used for backward compatibility with scrapeLeague
 */
export function parse1X2Odds(event: SuperbetEvent): {
  home: number;
  draw: number;
  away: number;
} {
  const result = { home: 0, draw: 0, away: 0 };
  const odds = event.odds || [];

  const mainOdds = odds.filter((o) => o.marketId === MARKET_IDS.MATCH_RESULT_1X2);

  for (const selection of mainOdds) {
    if (selection.code === SELECTION_CODES.HOME) {
      result.home = selection.price || 0;
    } else if (selection.code === SELECTION_CODES.DRAW) {
      result.draw = selection.price || 0;
    } else if (selection.code === SELECTION_CODES.AWAY) {
      result.away = selection.price || 0;
    }
  }

  return result;
}

/**
 * Parse Double Chance market from event odds
 */
export function parseDoubleChance(odds: SuperbetOddsSelection[]): {
  homeOrDraw: number;
  drawOrAway: number;
  homeOrAway: number;
} | null {
  const result = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
  let found = false;

  const dcOdds = odds.filter(
    (o) =>
      o.marketId === MARKET_IDS.DOUBLE_CHANCE ||
      o.marketId === MARKET_IDS.DOUBLE_CHANCE_ALT
  );

  for (const selection of dcOdds) {
    const code = selection.code;
    if (code === "10" || code === "1X") {
      result.homeOrDraw = selection.price || 0;
      found = true;
    } else if (code === "02" || code === "X2") {
      result.drawOrAway = selection.price || 0;
      found = true;
    } else if (code === "12") {
      result.homeOrAway = selection.price || 0;
      found = true;
    }
  }

  return found ? result : null;
}

/**
 * Parse BTTS market from event odds
 */
export function parseBTTS(odds: SuperbetOddsSelection[]): {
  yes: number;
  no: number;
} | null {
  const result = { yes: 0, no: 0 };
  let found = false;

  const bttsOdds = odds.filter(
    (o) => o.marketId === MARKET_IDS.BTTS || o.marketId === MARKET_IDS.BTTS_ALT
  );

  for (const selection of bttsOdds) {
    const code = selection.code;
    const name = selection.name?.toLowerCase() || "";

    if (code === "1" || code === "GG" || name.includes("tak")) {
      result.yes = selection.price || 0;
      found = true;
    } else if (code === "2" || code === "NG" || name.includes("nie")) {
      result.no = selection.price || 0;
      found = true;
    }
  }

  return found ? result : null;
}

/**
 * Parse Over/Under markets from event odds
 * Returns a record keyed by line (e.g., "2.5")
 */
export function parseOverUnder(
  odds: SuperbetOddsSelection[]
): Record<string, MarketOverUnderOdds> | null {
  const result: Record<string, MarketOverUnderOdds> = {};

  const ouOdds = odds.filter(
    (o) =>
      o.marketId === MARKET_IDS.TOTAL_GOALS ||
      o.marketId === MARKET_IDS.TOTAL_GOALS_ALT ||
      o.marketId === MARKET_IDS.TOTAL_GOALS_ALT2
  );

  for (const selection of ouOdds) {
    const line = selection.specialBetValue;
    if (!line || !line.includes(".")) continue;

    const lineStr = parseFloat(line).toFixed(1);
    if (!result[lineStr]) {
      result[lineStr] = { over: 0, under: 0 };
    }

    const name = selection.name?.toLowerCase() || "";
    if (selection.code === "O" || name.includes("powyżej") || name.includes("powyzej")) {
      result[lineStr].over = selection.price || 0;
    } else if (selection.code === "U" || name.includes("poniżej") || name.includes("ponizej")) {
      result[lineStr].under = selection.price || 0;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Odds at or below this value are placeholder/sentinel prices (Superbet
 * publishes lines it does not really offer as e.g. UNDER 1.00 / OVER 100),
 * never a real bookmaker quote.
 */
const SENTINEL_ODDS_MAX = 1.005;

/**
 * "Każda z drużyn powyżej X ..." markets: the catalog defines only the OVER
 * (yes) side; the "nie" leg has no canonical selection and would normalize
 * to a duplicate OVER (its name also starts with "Powyżej ...").
 * 200697 = fouls, 200709 = shots on target, 200721 = offsides.
 */
const EACH_TEAM_OVER_MARKET_IDS = new Set<number>([200697, 200709, 200721]);

/**
 * Superbet returns some market names with an uninterpolated "X" placeholder
 * ("Liczba goli - do X minuty"). Substitute the real minute when it can be
 * recovered unambiguously from the selection names.
 */
function interpolatePlaceholderMinute(
  marketName: string,
  selections: SuperbetOddsSelection[]
): string {
  if (!/\bdo X minuty\b/iu.test(marketName)) return marketName;
  const minutes = new Set<string>();
  for (const sel of selections) {
    const match = sel.name?.match(/do\s+(\d+)\.?\s*minut/iu);
    if (match) minutes.add(match[1]);
  }
  if (minutes.size === 1) {
    const minute = Array.from(minutes)[0];
    return marketName.replace(/\bdo X minuty\b/iu, `do ${minute}. minuty`);
  }
  return marketName;
}

/**
 * Parse ALL markets from event odds into unified ScrapedMarket format
 * This is the main function for full offer scraping
 */
export function parseAllMarkets(
  event: SuperbetEvent,
  teams?: ParsedTeams
): ScrapedMarket[] {
  const markets: ScrapedMarket[] = [];
  const odds = event.odds || [];

  if (odds.length === 0) {
    return markets;
  }

  // Get teams from event if not provided
  const parsedTeams = teams || parseTeamNames(event.matchName);

  // Group selections by market ID and line (for O/U markets)
  const marketGroups = new Map<string, SuperbetOddsSelection[]>();

  for (const selection of odds) {
    // Create unique key for market grouping
    // For line markets (O/U, handicap), include the line in the key
    let key = String(selection.marketId);
    if (selection.specialBetValue) {
      key += `_${selection.specialBetValue}`;
    }

    if (!marketGroups.has(key)) {
      marketGroups.set(key, []);
    }
    marketGroups.get(key)!.push(selection);
  }

  // Convert each group to ScrapedMarket
  for (const [key, selections] of marketGroups) {
    if (selections.length === 0) continue;

    const firstSelection = selections[0];
    const marketId = firstSelection.marketId;
    const line = firstSelection.specialBetValue;

    // Get market metadata
    const marketName = interpolatePlaceholderMinute(
      getMarketName(marketId, firstSelection),
      selections
    );
    const groupName = MARKET_GROUPS[marketId] || "Inne";
    const marketType = MARKET_TYPES[marketId];

    // Convert selections to MarketSelection format
    const parsedSelections: MarketSelection[] = selections
      .filter(
        (sel) =>
          // The "nie" leg of "każda z drużyn powyżej X" markets has no
          // canonical selection - see EACH_TEAM_OVER_MARKET_IDS.
          !(EACH_TEAM_OVER_MARKET_IDS.has(marketId) && /-\s*nie\s*$/iu.test(sel.name ?? ""))
      )
      .map((sel) => ({
        name: getSelectionName(sel.code, sel.name, marketId, parsedTeams),
        odds: sel.price || 0,
        externalId: String(sel.id),
        status: sel.status === "active" ? "active" as const : undefined,
      }))
      .filter((sel) => sel.odds > 0);

    // Reject sentinel prices. When a two-way line loses a leg to the filter
    // (e.g. UNDER 1.00 / OVER 100) the whole line is a placeholder Superbet
    // does not actually offer - drop it entirely. The same applies to 3-way
    // lined markets (e.g. "1.połowa - handicap 1X2" at extreme lines where
    // HOME sits at 1.00): publishing only the surviving legs misrepresents
    // the line, so drop the whole line when any leg was a sentinel.
    const priceableSelections = parsedSelections.filter((sel) => sel.odds > SENTINEL_ODDS_MAX);
    const lostSentinelLeg = priceableSelections.length < parsedSelections.length;
    const marketSelections =
      (parsedSelections.length === 2 && priceableSelections.length === 1) ||
      (Boolean(line) && parsedSelections.length === 3 && lostSentinelLeg)
        ? []
        : priceableSelections;

    // Only add markets with valid selections
    if (marketSelections.length > 0) {
      markets.push({
        name: marketName,
        // Carry the stable Superbet market-type id so the audit can match
        // markets by id instead of brittle name regex.
        bookmakerMarketId: String(marketId),
        groupName,
        type: marketType,
        selections: marketSelections,
      });
    }
  }

  return markets;
}

/**
 * Validate that an event has the minimum required data
 */
export function isValidEvent(event: SuperbetEvent): boolean {
  if (!event.matchName) return false;
  if (!event.eventId) return false;

  const teams = parseTeamNames(event.matchName);
  if (!teams.homeTeam || !teams.awayTeam) return false;

  return true;
}

/**
 * Check whether an event from the by-date listing is a genuine upcoming
 * match that still has a full prematch offer.
 *
 * The by-date endpoint also returns already-played matches (status FINISHED /
 * matchStatusLabel "END"), which carry marketCount 0-1 (only residual settled
 * markets). Iterating those first makes the full-offer scrape report a near-empty
 * market count even though every real upcoming match carries ~350 markets.
 * This filter excludes settled / offer-less / kicked-off events so the first
 * processed match reflects the true offer.
 */
export function isUpcomingOfferedEvent(
  event: SuperbetEvent,
  now: number = Date.now()
): boolean {
  if (!isValidEvent(event)) return false;

  // No offer left (settled or closed match)
  if (typeof event.marketCount === "number" && event.marketCount === 0) {
    return false;
  }

  // Finished / ended match (metadata is null for not-yet-started events)
  const status = event.metadata?.status;
  const statusLabel = event.metadata?.matchStatusLabel;
  if (status === "FINISHED" || statusLabel === "END") {
    return false;
  }

  // Kickoff already in the past
  if (typeof event.unixDateMillis === "number" && event.unixDateMillis < now) {
    return false;
  }

  return true;
}

/**
 * Check if event has valid 1X2 odds
 */
export function hasValid1X2Odds(event: SuperbetEvent): boolean {
  const odds1x2 = parse1X2Odds(event);
  return odds1x2.home > 0 && odds1x2.draw > 0 && odds1x2.away > 0;
}
