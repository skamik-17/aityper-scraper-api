/**
 * Fortuna Parser Module
 *
 * Pure parsing logic for transforming Fortuna API responses
 * into the unified ScrapedMarket format.
 *
 * This module has NO Playwright dependencies - it only works with
 * raw JSON data from the API.
 */

import type { MarketSelection, ScrapedMarket } from "../../../types/full-offer.js";
import type { MarketOverUnderOdds } from "../../../types/full-offer.js";
import {
  MARKET_TYPE_IDS,
  MARKET_GROUPS,
  MARKET_TYPES,
  MARKET_TYPE_FALLBACK_LABELS,
  SELECTION_CODES,
} from "./constants.js";
import type {
  FortunaFixture,
  FortunaMarket,
  FortunaOutcome,
  ParsedTeams,
} from "./types.js";

/**
 * Parse team names from a Fortuna fixture
 * Uses participants array first, falls back to parsing name
 */
export function parseTeamNames(fixture: FortunaFixture): ParsedTeams {
  // Try participants first
  const homeParticipant = fixture.participants?.find((p) => p.type === "HOME");
  const awayParticipant = fixture.participants?.find((p) => p.type === "AWAY");

  if (homeParticipant?.name && awayParticipant?.name) {
    return {
      homeTeam: homeParticipant.name.trim(),
      awayTeam: awayParticipant.name.trim(),
    };
  }

  // Fallback to parsing name string
  if (fixture.name) {
    const match = fixture.name.match(/^(.+?)\s*[-–]\s*(.+)$/);
    if (match) {
      return {
        homeTeam: match[1].trim(),
        awayTeam: match[2].trim(),
      };
    }
  }

  return { homeTeam: "", awayTeam: "" };
}

/**
 * A blank or fallback-looking API market name we should not trust.
 * Only internal-code leaks are rejected ("Rynek ufo:mtyp:00-23", "ufo:mkt:...").
 * Legit Fortuna labels routinely contain a scope colon ("Mecz: liczba goli",
 * "1.połowa: wynik/liczba goli w 1.połowie") and MUST be kept — rejecting any
 * name with ":" previously replaced the whole offer's names with placeholders.
 */
function isUselessApiName(name: string): boolean {
  const n = name.trim();
  return n.length === 0 || /^rynek\s/i.test(n) || n.includes("ufo:");
}

/**
 * Get human-readable market name. Prefer the API-provided name; fall back to the
 * hard-coded switch for the core market types, then to "Rynek <id>".
 */
export function getMarketName(market: FortunaMarket): string {
  const apiName = (market.name || market.marketTypeName || "").trim();
  if (apiName && !isUselessApiName(apiName)) return apiName;

  // Check for line markets and include the line in the name
  const line = market.specifiers?.total || market.specifiers?.line;

  switch (market.marketTypeId) {
    case MARKET_TYPE_IDS.MATCH_RESULT:
      return "Wynik meczu";
    case MARKET_TYPE_IDS.DOUBLE_CHANCE:
      return "Podwojna szansa";
    case MARKET_TYPE_IDS.BTTS:
      return "Obie druzyny strzelą";
    case MARKET_TYPE_IDS.OVER_UNDER:
      return line ? `Liczba goli ${line}` : "Liczba goli";
    case MARKET_TYPE_IDS.HALF_TIME_RESULT:
      return "Wynik 1. polowy";
    case MARKET_TYPE_IDS.HALF_TIME_OVER_UNDER:
      return line ? `Liczba goli 1. polowa ${line}` : "Liczba goli 1. polowa";
    case MARKET_TYPE_IDS.HALF_TIME_BTTS:
      return "Obie strzelą 1. polowa";
    // NOTE: ids 00-0v ("ASIAN_HANDICAP"), 00-0w ("EUROPEAN_HANDICAP"),
    // 00-04 ("CORRECT_SCORE") and 00-1a ("ODD_EVEN_GOALS") turned out to carry
    // different markets on the live API (goal bands, HT-or-FT double chance,
    // home-team odd/even) — their labels now come from
    // MARKET_TYPE_FALLBACK_LABELS / the placeholder instead of wrong names here.
    case MARKET_TYPE_IDS.DRAW_NO_BET:
      return "Remis = zwrot";
    case MARKET_TYPE_IDS.ODD_EVEN_GOALS:
      return "Gospodarze Liczba goli P/N";
    default:
      // Known ids get a curated Polish label instead of the raw internal code
      return (
        MARKET_TYPE_FALLBACK_LABELS[market.marketTypeId] ??
        `Rynek ${market.marketTypeId}`
      );
  }
}

/**
 * Get selection display name based on outcome code and market type
 */
function getSelectionName(
  outcome: FortunaOutcome,
  marketTypeId: string,
  teams?: ParsedTeams
): string {
  const code = outcome.name;
  const longName = outcome.longName;

  // Use longName if it's meaningful
  if (longName && longName.length > 1 && !longName.match(/^[0-9]+$/)) {
    return longName;
  }

  // Map codes to display names
  switch (code) {
    // 1X2
    case SELECTION_CODES.HOME:
      if (
        marketTypeId === MARKET_TYPE_IDS.BTTS ||
        marketTypeId === MARKET_TYPE_IDS.HALF_TIME_BTTS
      ) {
        return "Tak";
      }
      return teams?.homeTeam || "1";
    case SELECTION_CODES.DRAW:
      return "Remis";
    case SELECTION_CODES.AWAY:
      if (
        marketTypeId === MARKET_TYPE_IDS.BTTS ||
        marketTypeId === MARKET_TYPE_IDS.HALF_TIME_BTTS
      ) {
        return "Nie";
      }
      return teams?.awayTeam || "2";

    // Double Chance
    case SELECTION_CODES.HOME_OR_DRAW:
      return "1X";
    case SELECTION_CODES.DRAW_OR_AWAY:
      return "X2";
    case SELECTION_CODES.HOME_OR_AWAY:
      return "12";

    default:
      // For Over/Under, use the code which contains +/- prefix
      if (code.startsWith("+") || code.startsWith("+ ")) {
        return "Powyzej";
      }
      if (code.startsWith("-") || code.startsWith("- ")) {
        return "Ponizej";
      }
      return longName || code;
  }
}

/**
 * Parse 1X2 market odds from market data
 * Used for backward compatibility with scrapeLeague
 */
export function parse1X2Odds(markets: FortunaMarket[]): {
  home: number;
  draw: number;
  away: number;
} {
  const result = { home: 0, draw: 0, away: 0 };

  const market1X2 = markets.find(
    (m) => m.marketTypeId === MARKET_TYPE_IDS.MATCH_RESULT
  );

  if (!market1X2?.outcomes) {
    return result;
  }

  for (const outcome of market1X2.outcomes) {
    if (outcome.name === SELECTION_CODES.HOME) {
      result.home = outcome.odds || 0;
    } else if (outcome.name === SELECTION_CODES.DRAW) {
      result.draw = outcome.odds || 0;
    } else if (outcome.name === SELECTION_CODES.AWAY) {
      result.away = outcome.odds || 0;
    }
  }

  return result;
}

/**
 * Parse Double Chance market from markets data
 */
export function parseDoubleChance(markets: FortunaMarket[]): {
  homeOrDraw: number;
  drawOrAway: number;
  homeOrAway: number;
} | null {
  const result = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
  let found = false;

  const dcMarket = markets.find(
    (m) => m.marketTypeId === MARKET_TYPE_IDS.DOUBLE_CHANCE
  );

  if (!dcMarket?.outcomes) {
    return null;
  }

  for (const outcome of dcMarket.outcomes) {
    const code = outcome.name;
    if (code === "10" || outcome.longName?.includes("1X")) {
      result.homeOrDraw = outcome.odds || 0;
      found = true;
    } else if (code === "02" || outcome.longName?.includes("X2")) {
      result.drawOrAway = outcome.odds || 0;
      found = true;
    } else if (code === "12") {
      result.homeOrAway = outcome.odds || 0;
      found = true;
    }
  }

  return found ? result : null;
}

/**
 * Parse BTTS market from markets data
 */
export function parseBTTS(markets: FortunaMarket[]): {
  yes: number;
  no: number;
} | null {
  const result = { yes: 0, no: 0 };
  let found = false;

  const bttsMarket = markets.find(
    (m) => m.marketTypeId === MARKET_TYPE_IDS.BTTS
  );

  if (!bttsMarket?.outcomes) {
    return null;
  }

  for (const outcome of bttsMarket.outcomes) {
    const code = outcome.name?.toLowerCase() || "";
    const longName = outcome.longName?.toLowerCase() || "";

    if (code === "tak" || longName === "tak") {
      result.yes = outcome.odds || 0;
      found = true;
    } else if (code === "nie" || longName === "nie") {
      result.no = outcome.odds || 0;
      found = true;
    }
  }

  return found ? result : null;
}

/**
 * Parse Over/Under markets from markets data
 * Returns a record keyed by line (e.g., "2.5")
 */
export function parseOverUnder(
  markets: FortunaMarket[]
): Record<string, MarketOverUnderOdds> | null {
  const result: Record<string, MarketOverUnderOdds> = {};

  const ouMarkets = markets.filter(
    (m) => m.marketTypeId === MARKET_TYPE_IDS.OVER_UNDER
  );

  for (const market of ouMarkets) {
    // Extract line from specifiers or market name
    let line = market.specifiers?.total || market.specifiers?.line;
    if (!line) {
      const lineMatch = market.name?.match(/(\d+[.,]5)/);
      if (lineMatch) line = lineMatch[1].replace(",", ".");
    }

    if (!line || !market.outcomes) continue;

    const lineStr = line.replace(",", ".");

    for (const outcome of market.outcomes) {
      const name = outcome.name || "";
      const longName = outcome.longName?.toLowerCase() || "";

      if (!result[lineStr]) {
        result[lineStr] = { over: 0, under: 0 };
      }

      if (
        name.startsWith("+") ||
        name.startsWith("+ ") ||
        longName.includes("powyżej") ||
        longName.includes("powyzej")
      ) {
        result[lineStr].over = outcome.odds || 0;
      } else if (
        name.startsWith("-") ||
        name.startsWith("- ") ||
        longName.includes("poniżej") ||
        longName.includes("ponizej")
      ) {
        result[lineStr].under = outcome.odds || 0;
      }
    }
  }

  // Filter out incomplete lines
  for (const line of Object.keys(result)) {
    if (result[line].over === 0 || result[line].under === 0) {
      delete result[line];
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse ALL markets from Fortuna API response into unified ScrapedMarket format
 * This is the main function for full offer scraping
 */
export function parseAllMarkets(
  markets: FortunaMarket[],
  teams?: ParsedTeams
): ScrapedMarket[] {
  const result: ScrapedMarket[] = [];

  if (!markets || markets.length === 0) {
    return result;
  }

  for (const market of markets) {
    if (!market.outcomes || market.outcomes.length === 0) {
      continue;
    }

    const marketTypeId = market.marketTypeId;

    // Get market metadata
    const marketName = getMarketName(market);
    const groupName = MARKET_GROUPS[marketTypeId] || "Inne";
    const marketType = MARKET_TYPES[marketTypeId];

    // Convert outcomes to MarketSelection format
    const rawSelections: MarketSelection[] = market.outcomes.map((outcome) => ({
      name: getSelectionName(outcome, marketTypeId, teams),
      odds: outcome.odds || 0,
      externalId: market.id,
      status: "active" as const,
    }));

    // Odds of exactly 1.00 are usually a sentinel for a suspended/closed
    // outcome — filter them out. Exception: a genuinely binary (2-outcome)
    // market where the other leg is priced above 1.00 is actively quoted,
    // not suspended; a near-1.00 price on a rare event's "No" leg (e.g.
    // "Rzut karny w obu połowach: Nie @1.0" alongside a real "Tak @30") is a
    // real, extreme-probability quote and must be kept, not dropped.
    const isLiveBinaryMarket =
      rawSelections.length === 2 && rawSelections.some((sel) => sel.odds > 1);
    const selections = isLiveBinaryMarket
      ? rawSelections
      : rawSelections.filter((sel) => sel.odds > 1);

    // Only add markets with valid selections
    if (selections.length > 0) {
      result.push({
        name: marketName,
        bookmakerMarketId: marketTypeId,
        groupName,
        type: marketType,
        selections,
      });
    }
  }

  return result;
}

/**
 * Validate that a fixture has the minimum required data
 */
export function isValidFixture(fixture: FortunaFixture): boolean {
  if (!fixture.id) return false;

  const teams = parseTeamNames(fixture);
  if (!teams.homeTeam || !teams.awayTeam) return false;

  return true;
}

/**
 * Check if fixture has valid 1X2 odds
 */
export function hasValid1X2Odds(markets: FortunaMarket[]): boolean {
  const odds1x2 = parse1X2Odds(markets);
  return odds1x2.home > 0 && odds1x2.draw > 0 && odds1x2.away > 0;
}
