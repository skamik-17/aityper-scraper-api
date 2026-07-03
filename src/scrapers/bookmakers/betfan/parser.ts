/**
 * Betfan Parser Module
 *
 * Pure parsing logic for transforming Betfan API responses
 * into the unified ScrapedMarket format.
 *
 * This module has NO Playwright dependencies - it only works with
 * raw JSON data from the API.
 */

import type { MarketSelection, ScrapedMarket } from "../../../types/full-offer.js";
import type { MarketOverUnderOdds } from "../../../types/full-offer.js";
import { GAME_TYPES, MARKET_GROUPS, MARKET_TYPES } from "./constants.js";

/**
 * Minimum odds value considered a real bookmaker price.
 * Betfan publishes sentinel values like 1.0000000001 for effectively-settled
 * outcomes; anything below the lowest real price (1.01) must be dropped
 * instead of being surfaced as a genuine quote.
 */
const MIN_VALID_ODDS = 1.01;
import type {
  BetfanEvent,
  BetfanGame,
  BetfanOutcome,
  ParsedTeams,
  Parsed1X2Odds,
  ParsedDoubleChanceOdds,
  ParsedBTTSOdds,
  OverUnderLineOdds,
} from "./types.js";

/**
 * Parse team names from event participants
 */
export function parseTeamNames(event: BetfanEvent): ParsedTeams {
  const homePart = event.participants?.find((p) => p.number === 1);
  const awayPart = event.participants?.find((p) => p.number === 2);

  return {
    homeTeam: homePart?.participantName || "",
    awayTeam: awayPart?.participantName || "",
  };
}

/**
 * Get human-readable market name based on game type and game data
 * Uses the API-provided gameName when available, falls back to hardcoded names
 */
function getMarketName(game: BetfanGame): string {
  const gameName = game.gameName || "";

  // Use game name directly if it's meaningful (more than just a number)
  if (gameName && gameName.length > 1 && !/^\d+$/.test(gameName)) {
    // Capitalize first letter
    return gameName.charAt(0).toUpperCase() + gameName.slice(1);
  }

  // Fallback to standard names based on game type
  switch (game.gameType) {
    case GAME_TYPES.MATCH_RESULT_1X2:
      return "Wynik meczu";
    case GAME_TYPES.DOUBLE_CHANCE:
      return "Podwojna szansa";
    case GAME_TYPES.DRAW_NO_BET:
      return "Remis = zwrot";
    case GAME_TYPES.OVER_UNDER:
      return "Liczba goli";
    case GAME_TYPES.BTTS:
      return "Obie druzyny strzelą";
    case GAME_TYPES.EXACT_GOALS:
      return "Dokladna liczba goli";
    case GAME_TYPES.ODD_EVEN:
      return "Parzyste/Nieparzyste";
    case GAME_TYPES.HANDICAP:
      return "Handicap";
    case GAME_TYPES.HALF_TIME_RESULT:
      return "1. polowa - wynik";
    case GAME_TYPES.HALF_TIME_OVER_UNDER:
      return "1. polowa - liczba goli";
    case GAME_TYPES.HALF_TIME_BTTS:
      return "1. polowa - obie strzelą";
    case GAME_TYPES.CORRECT_SCORE:
      return "Dokladny wynik";
    case GAME_TYPES.CORNERS_TOTAL:
      return "Rzuty rozne";
    case GAME_TYPES.CARDS_TOTAL:
      return "Liczba kartek";
    case GAME_TYPES.TEAM_GOALS:
      return "Gole druzyny";
    case GAME_TYPES.HALFTIME_FULLTIME:
      return "Polowa/Koniec";
    case GAME_TYPES.HOME_TEAM_OVER_UNDER:
      return "Gole gospodarzy";
    case GAME_TYPES.AWAY_TEAM_OVER_UNDER:
      return "Gole gosci";
    case GAME_TYPES.CLEAN_SHEET:
      return "Czyste konto";
    case GAME_TYPES.WIN_MARGIN:
      return "Margines zwyciestwa";
    default:
      // Use the API name or fallback to generic label
      return gameName || `Rynek ${game.gameType}`;
  }
}

/**
 * Get selection display name from outcome data
 */
function getSelectionName(outcome: BetfanOutcome, gameType: number): string {
  const name = outcome.outcomeName || "";

  // For most markets, use the outcome name directly if it's meaningful
  if (name && name.length > 0) {
    return name;
  }

  return `Opcja ${outcome.outcomePosition}`;
}

/**
 * Parse 1X2 market odds from event data
 * Used for backward compatibility with scrapeLeague
 */
export function parse1X2Odds(event: BetfanEvent): Parsed1X2Odds {
  const result: Parsed1X2Odds = { home: 0, draw: 0, away: 0 };

  for (const game of event.games || []) {
    const gameName = (game.gameName || "").toLowerCase();
    const outcomes = game.outcomes || [];

    // 1X2 - gameType 1, gameName "Mecz" or "1X2"
    if (
      game.gameType === GAME_TYPES.MATCH_RESULT_1X2 &&
      (gameName === "mecz" || gameName === "1x2") &&
      outcomes.length === 3 &&
      result.home === 0
    ) {
      const sorted = [...outcomes].sort(
        (a, b) => a.outcomePosition - b.outcomePosition
      );
      result.home = sorted[0]?.outcomeOdds || 0;
      result.draw = sorted[1]?.outcomeOdds || 0;
      result.away = sorted[2]?.outcomeOdds || 0;
      break;
    }
  }

  return result;
}

/**
 * Parse Double Chance market from event data
 */
export function parseDoubleChance(event: BetfanEvent): ParsedDoubleChanceOdds | null {
  const result: ParsedDoubleChanceOdds = {
    homeOrDraw: 0,
    drawOrAway: 0,
    homeOrAway: 0,
  };
  let found = false;

  for (const game of event.games || []) {
    const gameName = (game.gameName || "").toLowerCase();
    const outcomes = game.outcomes || [];

    if (
      game.gameType === GAME_TYPES.DOUBLE_CHANCE &&
      gameName.includes("szansa") &&
      outcomes.length === 3
    ) {
      for (const o of outcomes) {
        const name = (o.outcomeName || "").toLowerCase().replace(/\//g, "");
        if (name === "1x" || name === "x1") {
          result.homeOrDraw = o.outcomeOdds;
          found = true;
        } else if (name === "x2" || name === "2x") {
          result.drawOrAway = o.outcomeOdds;
          found = true;
        } else if (name === "12" || name === "21") {
          result.homeOrAway = o.outcomeOdds;
          found = true;
        }
      }
      break;
    }
  }

  return found ? result : null;
}

/**
 * Parse BTTS market from event data
 */
export function parseBTTS(event: BetfanEvent): ParsedBTTSOdds | null {
  const result: ParsedBTTSOdds = { yes: 0, no: 0 };
  let found = false;

  for (const game of event.games || []) {
    const gameName = (game.gameName || "").toLowerCase();

    if (
      game.gameType === GAME_TYPES.BTTS &&
      gameName.includes("obie") &&
      gameName.includes("strzelą")
    ) {
      for (const o of game.outcomes || []) {
        const name = (o.outcomeName || "").toLowerCase();
        if (name === "tak") {
          result.yes = o.outcomeOdds;
          found = true;
        } else if (name === "nie") {
          result.no = o.outcomeOdds;
          found = true;
        }
      }
      break;
    }
  }

  return found ? result : null;
}

/**
 * Parse Over/Under markets from event data
 * Returns a record keyed by line (e.g., "2.5")
 */
export function parseOverUnder(
  event: BetfanEvent
): Record<string, OverUnderLineOdds> | null {
  const result: Record<string, OverUnderLineOdds> = {};

  for (const game of event.games || []) {
    const gameName = (game.gameName || "").toLowerCase();
    const outcomes = game.outcomes || [];

    // Over/Under - gameType 8 (handles both "Liczba goli" and "Ponizej/powyzej X.X goli")
    if (game.gameType === GAME_TYPES.OVER_UNDER && outcomes.length === 2) {
      // Try to get line from game name first (e.g., "Ponizej/powyzej 2.5 goli")
      const gameLineMatch = gameName.match(/(\d+[.,]?\d*)\s*gol/);

      for (const o of outcomes) {
        const outcomeName = (o.outcomeName || "").toLowerCase();
        // Get line from outcome name (e.g., "Powyzej 2.5") or from game name
        const outcomeLineMatch = outcomeName.match(/(\d+[.,]?\d*)/);
        const lineMatch = outcomeLineMatch || gameLineMatch;

        if (lineMatch) {
          const lineVal = parseFloat(lineMatch[1].replace(",", "."));
          if (lineVal % 1 === 0.5) {
            const line = lineVal.toFixed(1);
            if (!result[line]) result[line] = { over: 0, under: 0 };
            if (outcomeName.includes("powyżej") || outcomeName.includes("powyzej")) {
              result[line].over = o.outcomeOdds;
            } else if (outcomeName.includes("poniżej") || outcomeName.includes("ponizej")) {
              result[line].under = o.outcomeOdds;
            }
          }
        }
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse ALL markets from event data into unified ScrapedMarket format
 * This is the main function for full offer scraping
 */
export function parseAllMarkets(event: BetfanEvent): ScrapedMarket[] {
  const markets: ScrapedMarket[] = [];
  const games = event.games || [];

  if (games.length === 0) {
    return markets;
  }

  for (const game of games) {
    const outcomes = game.outcomes || [];
    if (outcomes.length === 0) continue;

    // Get market metadata
    const marketName = getMarketName(game);
    const groupName = MARKET_GROUPS[game.gameType] || "Inne";
    const marketType = MARKET_TYPES[game.gameType];

    // Convert outcomes to MarketSelection format
    const selections: MarketSelection[] = outcomes
      .sort((a, b) => a.outcomePosition - b.outcomePosition)
      .map((outcome) => ({
        name: getSelectionName(outcome, game.gameType),
        odds: outcome.outcomeOdds || 0,
        externalId: String(outcome.outcomeId),
      }))
      // Drop placeholder/sentinel prices (e.g. 1.0000000001) - not real quotes
      .filter((sel) => sel.odds >= MIN_VALID_ODDS);

    // Only add markets with valid selections
    if (selections.length > 0) {
      markets.push({
        name: marketName,
        // Carry the stable Betfan market-type id so the normalization audit
        // can match by id instead of brittle name regex.
        bookmakerMarketId: String(game.gameType),
        groupName,
        type: marketType,
        selections,
      });
    }
  }

  return markets;
}

/**
 * Validate that an event has the minimum required data
 */
export function isValidEvent(event: BetfanEvent): boolean {
  if (!event.eventId) return false;

  const teams = parseTeamNames(event);
  if (!teams.homeTeam || !teams.awayTeam) return false;

  return true;
}

/**
 * Check if event has valid 1X2 odds
 */
export function hasValid1X2Odds(event: BetfanEvent): boolean {
  const odds1x2 = parse1X2Odds(event);
  return odds1x2.home > 1 && odds1x2.draw > 1 && odds1x2.away > 1;
}
