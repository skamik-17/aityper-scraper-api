/**
 * forBET Parser Module
 *
 * Pure parsing logic for transforming forBET API responses
 * into the unified ScrapedMarket format.
 *
 * This module has NO Playwright dependencies - it only works with
 * raw JSON data from the API.
 */

import type { MarketSelection, ScrapedMarket } from "../../../types/full-offer.js";
import type { MarketOverUnderOdds } from "../../../types/full-offer.js";
import {
  GAME_TYPES,
  MARKET_GROUPS,
  MARKET_TYPES,
  TEAM_SEPARATOR,
} from "./constants.js";
import type {
  ForbetEvent,
  ForbetGame,
  ForbetOutcome,
  ParsedTeams,
  Parsed1X2,
  ParsedDoubleChance,
  ParsedBTTS,
  ParsedMarkets,
} from "./types.js";

/**
 * Parse team names from the forBET eventName format
 * Format: "HomeTeam - AwayTeam"
 */
export function parseTeamNames(eventName: string): ParsedTeams {
  const parts = eventName.split(TEAM_SEPARATOR);
  return {
    homeTeam: (parts[0] || "").trim(),
    awayTeam: (parts[1] || "").trim(),
  };
}

/**
 * Get human-readable market name based on game type and game name
 */
export function getMarketName(game: ForbetGame): string {
  const gameName = game.gameName || "";
  const gameType = game.gameType;

  // Use the original game name if it's descriptive
  if (gameName && gameName.length > 2) {
    // Capitalize first letter for consistency
    return gameName.charAt(0).toUpperCase() + gameName.slice(1);
  }

  // Fallback to type-based names
  switch (gameType) {
    case GAME_TYPES.MATCH_RESULT_1X2:
      return "Wynik meczu";
    case GAME_TYPES.DOUBLE_CHANCE:
      return "Podwojna szansa";
    case GAME_TYPES.BTTS:
      return "Obie druzyny strzelą";
    case GAME_TYPES.OVER_UNDER:
      return "Liczba goli";
    case GAME_TYPES.HALF_TIME_1X2:
      return "Wynik 1. polowy";
    case GAME_TYPES.CORRECT_SCORE:
      return "Dokladny wynik";
    case GAME_TYPES.DRAW_NO_BET:
      return "Remis = zwrot";
    case GAME_TYPES.HALF_TIME_FULL_TIME:
      return "Polowa/Koniec";
    default:
      return `Rynek ${gameType}`;
  }
}

/**
 * Get selection display name
 */
function getSelectionName(outcome: ForbetOutcome, gameType: number, teams?: ParsedTeams): string {
  const originalName = outcome.outcomeName || "";

  // For team-based outcomes, try to return meaningful names
  if (gameType === GAME_TYPES.MATCH_RESULT_1X2 || gameType === GAME_TYPES.HALF_TIME_1X2) {
    if (originalName === "1" && teams?.homeTeam) return teams.homeTeam;
    if (originalName === "X") return "Remis";
    if (originalName === "2" && teams?.awayTeam) return teams.awayTeam;
  }

  // Return original name for most outcomes
  return originalName;
}

/**
 * Parse 1X2 market odds from event data
 * Used for backward compatibility with scrapeLeague
 */
export function parse1X2Odds(event: ForbetEvent): Parsed1X2 {
  const result: Parsed1X2 = { home: 0, draw: 0, away: 0 };

  for (const game of event.eventGames || []) {
    const gameName = (game.gameName || "").toLowerCase();

    // 1X2 - gameType 1
    if (game.gameType === GAME_TYPES.MATCH_RESULT_1X2 && gameName === "1x2" && game.outcomes.length === 3 && result.home === 0) {
      const sorted = [...game.outcomes].sort((a, b) => a.outcomePosition - b.outcomePosition);
      result.home = sorted[0]?.outcomeOdds || 0;
      result.draw = sorted[1]?.outcomeOdds || 0;
      result.away = sorted[2]?.outcomeOdds || 0;
      break;
    }
  }

  return result;
}

/**
 * Parse Double Chance market from event games
 */
export function parseDoubleChance(event: ForbetEvent): ParsedDoubleChance | null {
  const result: ParsedDoubleChance = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
  let found = false;

  for (const game of event.eventGames || []) {
    const gameName = (game.gameName || "").toLowerCase();

    // Double Chance - gameType 4, gameName includes "szansa"
    if (game.gameType === GAME_TYPES.DOUBLE_CHANCE && gameName.includes("szansa") && game.outcomes.length === 3) {
      for (const o of game.outcomes) {
        const name = (o.outcomeName || "").toLowerCase();
        if (name === "1x" || name === "1/x") {
          result.homeOrDraw = o.outcomeOdds;
          found = true;
        } else if (name === "x2" || name === "x/2") {
          result.drawOrAway = o.outcomeOdds;
          found = true;
        } else if (name === "12" || name === "1/2") {
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
 * Parse BTTS market from event games
 */
export function parseBTTS(event: ForbetEvent): ParsedBTTS | null {
  const result: ParsedBTTS = { yes: 0, no: 0 };
  let found = false;

  for (const game of event.eventGames || []) {
    const gameName = (game.gameName || "").toLowerCase();

    // BTTS - gameType 98, gameName includes "obie" and "strzelą"
    if (game.gameType === GAME_TYPES.BTTS && gameName.includes("obie") && gameName.includes("strzelą")) {
      for (const o of game.outcomes) {
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
 * Parse Over/Under markets from event games
 * Returns a record keyed by line (e.g., "2.5")
 */
export function parseOverUnder(event: ForbetEvent): Record<string, MarketOverUnderOdds> | null {
  const result: Record<string, MarketOverUnderOdds> = {};

  for (const game of event.eventGames || []) {
    const gameName = (game.gameName || "").toLowerCase();

    // Over/Under - gameType 8, format: "Poniżej/powyżej X.X goli"
    if (game.gameType === GAME_TYPES.OVER_UNDER && gameName.includes("goli") && game.outcomes.length === 2) {
      const lineMatch = gameName.match(/(\d+[.,]?\d*)/);
      if (lineMatch) {
        const lineVal = parseFloat(lineMatch[1].replace(",", "."));
        // Only include half-point lines (e.g., 2.5, 3.5)
        if (lineVal % 1 === 0.5) {
          const line = lineVal.toFixed(1);
          if (!result[line]) {
            result[line] = { over: 0, under: 0 };
          }
          for (const o of game.outcomes) {
            const name = (o.outcomeName || "").toLowerCase();
            if (name.includes("powyżej") || name.includes("powyzej")) {
              result[line].over = o.outcomeOdds;
            } else if (name.includes("poniżej") || name.includes("ponizej")) {
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
 * Parse all standard markets from event (for backward compatibility)
 */
export function parseEventMarkets(event: ForbetEvent): ParsedMarkets {
  return {
    m1X2: parse1X2Odds(event),
    mDC: parseDoubleChance(event) || { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 },
    mBTTS: parseBTTS(event) || { yes: 0, no: 0 },
    mOU: parseOverUnder(event) || {},
  };
}

/**
 * Parse ALL markets from event into unified ScrapedMarket format
 * This is the main function for full offer scraping
 */
export function parseAllMarkets(
  event: ForbetEvent,
  teams?: ParsedTeams
): ScrapedMarket[] {
  const markets: ScrapedMarket[] = [];
  const games = event.eventGames || [];

  if (games.length === 0) {
    return markets;
  }

  // Get teams from event if not provided
  const parsedTeams = teams || parseTeamNames(event.eventName);

  // Process each game (market) in the event
  for (const game of games) {
    const outcomes = game.outcomes || [];
    if (outcomes.length === 0) continue;

    const gameType = game.gameType;
    const marketName = getMarketName(game);
    const groupName = MARKET_GROUPS[gameType] || "Inne";
    const marketType = MARKET_TYPES[gameType];

    // Convert outcomes to MarketSelection format
    const selections: MarketSelection[] = outcomes
      .sort((a, b) => a.outcomePosition - b.outcomePosition)
      .map((outcome) => ({
        name: getSelectionName(outcome, gameType, parsedTeams),
        odds: outcome.outcomeOdds || 0,
        externalId: outcome.outcomeId ? String(outcome.outcomeId) : undefined,
      }))
      // forBET pads low-probability player-prop selections (e.g. distant
      // goal/card thresholds) with a flat 101 ceiling instead of a real
      // computed price — the same 101 recurs identically across different
      // players and different thresholds, which a genuine market price
      // would not. Drop it so it doesn't poison best-odds comparisons.
      .filter((sel) => sel.odds > 0 && sel.odds !== 101);

    // Only add markets with valid selections
    if (selections.length > 0) {
      markets.push({
        name: marketName,
        // Carry the stable forBET game type id so the normalization audit
        // can match by id instead of brittle name regex
        bookmakerMarketId: String(gameType),
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
export function isValidEvent(event: ForbetEvent): boolean {
  if (!event.eventName) return false;
  if (!event.eventId) return false;

  const teams = parseTeamNames(event.eventName);
  if (!teams.homeTeam || !teams.awayTeam) return false;

  return true;
}

/**
 * Check if event has valid 1X2 odds
 */
export function hasValid1X2Odds(event: ForbetEvent): boolean {
  const odds1x2 = parse1X2Odds(event);
  return odds1x2.home > 1 && odds1x2.draw > 1 && odds1x2.away > 1;
}
