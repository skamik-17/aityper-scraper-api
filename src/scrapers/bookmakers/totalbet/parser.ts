/**
 * Totalbet Parser Module
 *
 * Pure parsing logic for transforming Totalbet API responses
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
  TotalbetEvent,
  TotalbetGame,
  TotalbetOutcome,
  ParsedTeams,
} from "./types.js";

/**
 * Parse team names from the Totalbet eventName format
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
 * Get human-readable market name based on game type and game data
 */
function getMarketName(game: TotalbetGame): string {
  const gameType = game.gameType;
  const gameName = game.gameName || "";

  switch (gameType) {
    case GAME_TYPES.MATCH_RESULT_1X2:
      return "Wynik meczu";
    case GAME_TYPES.DOUBLE_CHANCE:
      return "Podwojna szansa";
    case GAME_TYPES.BTTS:
      return "Obie druzyny strzelą";
    case GAME_TYPES.TOTAL_GOALS:
      if (typeof game.argument === "number") {
        return `Liczba goli ${game.argument.toFixed(1)}`;
      }
      return "Liczba goli";
    case GAME_TYPES.ASIAN_HANDICAP:
      if (typeof game.argument === "number") {
        return `Handicap azjatycki ${game.argument > 0 ? "+" : ""}${game.argument}`;
      }
      return "Handicap azjatycki";
    case GAME_TYPES.EUROPEAN_HANDICAP:
      if (typeof game.argument === "number") {
        return `Handicap europejski ${game.argument > 0 ? "+" : ""}${game.argument}`;
      }
      return "Handicap europejski";
    case GAME_TYPES.HALF_TIME_RESULT:
      return "Wynik 1. polowy";
    case GAME_TYPES.HALF_TIME_TOTAL:
      if (typeof game.argument === "number") {
        return `Liczba goli 1. polowa ${game.argument.toFixed(1)}`;
      }
      return "Liczba goli 1. polowa";
    case GAME_TYPES.CORRECT_SCORE:
      return "Dokladny wynik";
    case GAME_TYPES.ODD_EVEN_GOALS:
      return "Parzyste/Nieparzyste";
    case GAME_TYPES.DRAW_NO_BET:
      return "Remis = zwrot";
    default:
      // Use the game name from API if available
      return gameName || `Rynek ${gameType}`;
  }
}

/**
 * Normalize outcome name for consistent display
 */
function normalizeOutcomeName(
  outcome: TotalbetOutcome,
  gameType: number,
  teams?: ParsedTeams
): string {
  const name = (outcome.outcomeName || "").trim();
  const nameLower = name.toLowerCase();

  // 1X2 outcomes
  if (gameType === GAME_TYPES.MATCH_RESULT_1X2 || gameType === GAME_TYPES.HALF_TIME_RESULT) {
    if (name === "1" && teams?.homeTeam) return teams.homeTeam;
    if (name === "2" && teams?.awayTeam) return teams.awayTeam;
    if (name === "X" || nameLower === "remis") return "Remis";
  }

  // Double Chance - keep standard notation
  if (gameType === GAME_TYPES.DOUBLE_CHANCE) {
    return name.toUpperCase(); // "1X", "X2", "12"
  }

  // BTTS outcomes
  if (gameType === GAME_TYPES.BTTS) {
    if (nameLower === "tak") return "Tak";
    if (nameLower === "nie") return "Nie";
  }

  // Over/Under outcomes
  if (gameType === GAME_TYPES.TOTAL_GOALS || gameType === GAME_TYPES.HALF_TIME_TOTAL) {
    if (nameLower.includes("ponad") || nameLower.includes("powyżej")) return "Powyzej";
    if (nameLower.includes("poniżej")) return "Ponizej";
  }

  // Draw No Bet
  if (gameType === GAME_TYPES.DRAW_NO_BET) {
    if (name === "1" && teams?.homeTeam) return teams.homeTeam;
    if (name === "2" && teams?.awayTeam) return teams.awayTeam;
  }

  return name;
}

/**
 * Parse 1X2 market odds from event data
 * Used for backward compatibility with scrapeLeague
 */
export function parse1X2Odds(event: TotalbetEvent): {
  home: number;
  draw: number;
  away: number;
} {
  const result = { home: 0, draw: 0, away: 0 };
  const games = event.eventGames || [];

  for (const game of games) {
    const gameName = (game.gameName || "").toLowerCase();

    // Match 1X2 market by gameType and name
    if (
      game.gameType === GAME_TYPES.MATCH_RESULT_1X2 &&
      (gameName === "wynik meczu" || gameName === "1x2") &&
      game.outcomes?.length === 3 &&
      result.home === 0
    ) {
      // Sort by position to ensure correct order
      const sorted = [...game.outcomes].sort(
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
 * Parse Double Chance market from event games
 */
export function parseDoubleChance(event: TotalbetEvent): {
  homeOrDraw: number;
  drawOrAway: number;
  homeOrAway: number;
} | null {
  const result = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
  const games = event.eventGames || [];
  let found = false;

  for (const game of games) {
    const gameName = (game.gameName || "").toLowerCase();

    if (game.gameType === GAME_TYPES.DOUBLE_CHANCE && gameName.includes("szansa")) {
      for (const outcome of game.outcomes || []) {
        const name = (outcome.outcomeName || "").toUpperCase();
        if (name === "1X") {
          result.homeOrDraw = outcome.outcomeOdds;
          found = true;
        } else if (name === "X2") {
          result.drawOrAway = outcome.outcomeOdds;
          found = true;
        } else if (name === "12") {
          result.homeOrAway = outcome.outcomeOdds;
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
export function parseBTTS(event: TotalbetEvent): {
  yes: number;
  no: number;
} | null {
  const result = { yes: 0, no: 0 };
  const games = event.eventGames || [];
  let found = false;

  for (const game of games) {
    const gameName = (game.gameName || "").toLowerCase();

    if (
      game.gameType === GAME_TYPES.BTTS &&
      (gameName.includes("obie") || gameName.includes("strzel"))
    ) {
      for (const outcome of game.outcomes || []) {
        const name = (outcome.outcomeName || "").toLowerCase();
        if (name === "tak") {
          result.yes = outcome.outcomeOdds;
          found = true;
        } else if (name === "nie") {
          result.no = outcome.outcomeOdds;
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
export function parseOverUnder(
  event: TotalbetEvent
): Record<string, MarketOverUnderOdds> | null {
  const result: Record<string, MarketOverUnderOdds> = {};
  const games = event.eventGames || [];

  for (const game of games) {
    const gameName = (game.gameName || "").toLowerCase();

    if (
      game.gameType === GAME_TYPES.TOTAL_GOALS &&
      (gameName.includes("total") || gameName.includes("suma")) &&
      game.outcomes?.length === 2
    ) {
      const lineVal = game.argument;
      // Only process half-point lines (e.g., 0.5, 1.5, 2.5)
      if (typeof lineVal === "number" && lineVal % 1 === 0.5) {
        const line = lineVal.toFixed(1);
        if (!result[line]) {
          result[line] = { over: 0, under: 0 };
        }

        for (const outcome of game.outcomes) {
          const name = (outcome.outcomeName || "").toLowerCase();
          if (name.includes("ponad") || name.includes("powyżej")) {
            result[line].over = outcome.outcomeOdds;
          } else if (name.includes("poniżej")) {
            result[line].under = outcome.outcomeOdds;
          }
        }
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse ALL markets from event into unified ScrapedMarket format
 * This is the main function for full offer scraping
 */
export function parseAllMarkets(
  event: TotalbetEvent,
  teams?: ParsedTeams
): ScrapedMarket[] {
  const markets: ScrapedMarket[] = [];
  const games = event.eventGames || [];

  if (games.length === 0) {
    return markets;
  }

  // Get teams from event if not provided
  const parsedTeams = teams || parseTeamNames(event.eventName);

  for (const game of games) {
    const outcomes = game.outcomes || [];
    if (outcomes.length === 0) continue;

    const gameType = game.gameType;

    // Get market metadata
    const marketName = getMarketName(game);
    const groupName = MARKET_GROUPS[gameType] || "Inne";
    const marketType = MARKET_TYPES[gameType];

    // Convert outcomes to MarketSelection format
    const marketSelections: MarketSelection[] = outcomes
      .map((outcome) => ({
        name: normalizeOutcomeName(outcome, gameType, parsedTeams),
        odds: outcome.outcomeOdds || 0,
        externalId: String(outcome.outcomeId),
        status: outcome.outcomeStatus === "active" ? ("active" as const) : undefined,
      }))
      .filter((sel) => sel.odds > 0);

    // Only add markets with valid selections
    if (marketSelections.length > 0) {
      markets.push({
        name: marketName,
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
export function isValidEvent(event: TotalbetEvent): boolean {
  if (!event.eventName) return false;
  if (!event.eventId) return false;

  const teams = parseTeamNames(event.eventName);
  if (!teams.homeTeam || !teams.awayTeam) return false;

  return true;
}

/**
 * Check if event has valid 1X2 odds
 */
export function hasValid1X2Odds(event: TotalbetEvent): boolean {
  const odds1x2 = parse1X2Odds(event);
  return odds1x2.home > 1 && odds1x2.draw > 1 && odds1x2.away > 1;
}
