/**
 * eToto Parser Module
 *
 * Pure parsing logic for transforming eToto API responses
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
  EtotoEvent,
  EtotoGame,
  EtotoOutcome,
  ParsedTeams,
  Parsed1X2Odds,
  ParsedDoubleChance,
  ParsedBTTS,
} from "./types.js";

/**
 * Parse team names from the eToto eventName format
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
 * Get human-readable market name based on game type and argument
 */
function getMarketName(game: EtotoGame): string {
  const gameName = (game.gameName || "").toLowerCase();

  switch (game.gameType) {
    case GAME_TYPES.MATCH_RESULT_1X2:
      return "Wynik meczu";
    case GAME_TYPES.DOUBLE_CHANCE:
      return "Podwojna szansa";
    case GAME_TYPES.BTTS:
      return "Obie druzyny strzelą";
    case GAME_TYPES.TOTAL_GOALS:
      if (typeof game.argument === "number") {
        return `Suma goli ${game.argument.toFixed(1)}`;
      }
      return "Suma goli";
    case GAME_TYPES.EUROPEAN_HANDICAP:
      if (typeof game.argument === "number") {
        return `Handicap europejski ${game.argument > 0 ? "+" : ""}${game.argument}`;
      }
      return "Handicap europejski";
    case GAME_TYPES.HALF_TIME_RESULT:
      return "Wynik 1. polowy";
    case GAME_TYPES.HALF_TIME_TOTAL:
      if (typeof game.argument === "number") {
        return `Suma goli 1. polowa ${game.argument.toFixed(1)}`;
      }
      return "Suma goli 1. polowa";
    case GAME_TYPES.CORRECT_SCORE:
      return "Dokladny wynik";
    case GAME_TYPES.DRAW_NO_BET:
      return "Remis = zwrot";
    case GAME_TYPES.FIRST_TEAM_TO_SCORE:
      return "Pierwsza druzyna strzeli";
    case GAME_TYPES.LAST_TEAM_TO_SCORE:
      return "Ostatnia druzyna strzeli";
    case GAME_TYPES.HALF_FULL_TIME:
      return "Polowa/Koniec";
    case GAME_TYPES.ODD_EVEN_GOALS:
      return "Parzyste/Nieparzyste";
    case GAME_TYPES.TOTAL_HOME_GOALS:
      if (typeof game.argument === "number") {
        return `Gole gospodarzy ${game.argument.toFixed(1)}`;
      }
      return "Gole gospodarzy";
    case GAME_TYPES.TOTAL_AWAY_GOALS:
      if (typeof game.argument === "number") {
        return `Gole gosci ${game.argument.toFixed(1)}`;
      }
      return "Gole gosci";
    case GAME_TYPES.EXACT_GOALS:
      return "Dokladna liczba goli";
    case GAME_TYPES.WINNING_MARGIN:
      return "Roznica goli";
    case GAME_TYPES.HOME_WIN_TO_NIL:
      return "Wygrana gospodarzy do zera";
    case GAME_TYPES.AWAY_WIN_TO_NIL:
      return "Wygrana gosci do zera";
    default:
      // Use original game name if available
      return game.gameName || `Rynek ${game.gameType}`;
  }
}

/**
 * Parse 1X2 market odds from event data
 * Used for backward compatibility with scrapeLeague
 */
export function parse1X2Odds(event: EtotoEvent): Parsed1X2Odds {
  const result: Parsed1X2Odds = { home: 0, draw: 0, away: 0 };

  for (const game of event.eventGames || []) {
    const gameName = (game.gameName || "").toLowerCase();

    // 1X2 - gameType 1
    if (
      game.gameType === GAME_TYPES.MATCH_RESULT_1X2 &&
      gameName === "1x2" &&
      game.outcomes.length === 3 &&
      result.home === 0
    ) {
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
export function parseDoubleChance(event: EtotoEvent): ParsedDoubleChance | null {
  const result: ParsedDoubleChance = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
  let found = false;

  for (const game of event.eventGames || []) {
    const gameName = (game.gameName || "").toLowerCase();

    if (game.gameType === GAME_TYPES.DOUBLE_CHANCE && gameName.includes("szansa")) {
      for (const o of game.outcomes) {
        const name = (o.outcomeName || "").toUpperCase();
        if (name === "1X") {
          result.homeOrDraw = o.outcomeOdds;
          found = true;
        } else if (name === "X2") {
          result.drawOrAway = o.outcomeOdds;
          found = true;
        } else if (name === "12") {
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
export function parseBTTS(event: EtotoEvent): ParsedBTTS | null {
  const result: ParsedBTTS = { yes: 0, no: 0 };
  let found = false;

  for (const game of event.eventGames || []) {
    const gameName = (game.gameName || "").toLowerCase();

    if (
      game.gameType === GAME_TYPES.BTTS &&
      gameName.includes("obie") &&
      gameName.includes("strzel")
    ) {
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
export function parseOverUnder(
  event: EtotoEvent
): Record<string, MarketOverUnderOdds> | null {
  const result: Record<string, MarketOverUnderOdds> = {};

  for (const game of event.eventGames || []) {
    const gameName = (game.gameName || "").toLowerCase();

    if (
      game.gameType === GAME_TYPES.TOTAL_GOALS &&
      gameName.includes("suma") &&
      gameName.includes("gol") &&
      game.outcomes.length === 2
    ) {
      const lineVal = game.argument;
      if (typeof lineVal === "number" && lineVal % 1 === 0.5) {
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

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Convert eToto outcomes to MarketSelection format
 */
function convertOutcomesToSelections(
  outcomes: EtotoOutcome[],
  gameType: number,
  teams?: ParsedTeams
): MarketSelection[] {
  return outcomes
    .map((outcome) => {
      let name = outcome.outcomeName || "";

      // Clean up name based on market type
      if (gameType === GAME_TYPES.MATCH_RESULT_1X2) {
        // Map 1, X, 2 to home team, draw, away team
        if (name === "1" && teams?.homeTeam) {
          name = teams.homeTeam;
        } else if (name === "2" && teams?.awayTeam) {
          name = teams.awayTeam;
        } else if (name.toUpperCase() === "X") {
          name = "Remis";
        }
      }

      return {
        name,
        odds: outcome.outcomeOdds || 0,
        externalId: String(outcome.outcomeId),
      };
    })
    .filter((sel) => sel.odds > 0);
}

/**
 * Parse ALL markets from event games into unified ScrapedMarket format
 * This is the main function for full offer scraping
 */
export function parseAllMarkets(
  event: EtotoEvent,
  teams?: ParsedTeams
): ScrapedMarket[] {
  const markets: ScrapedMarket[] = [];
  const eventGames = event.eventGames || [];

  if (eventGames.length === 0) {
    return markets;
  }

  // Get teams from event if not provided
  const parsedTeams = teams || parseTeamNames(event.eventName);

  // Process each game (market) from the event
  for (const game of eventGames) {
    if (!game.outcomes || game.outcomes.length === 0) {
      continue;
    }

    const marketName = getMarketName(game);
    const groupName = MARKET_GROUPS[game.gameType] || "Inne";
    const marketType = MARKET_TYPES[game.gameType];

    // Convert outcomes to selections
    const selections = convertOutcomesToSelections(
      game.outcomes,
      game.gameType,
      parsedTeams
    );

    // Only add markets with valid selections
    if (selections.length > 0) {
      // Create unique market key for line markets
      let uniqueName = marketName;
      if (typeof game.argument === "number" && !marketName.includes(String(game.argument))) {
        uniqueName = `${marketName} ${game.argument}`;
      }

      markets.push({
        name: uniqueName,
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
export function isValidEvent(event: EtotoEvent): boolean {
  if (!event.eventName) return false;
  if (!event.eventId) return false;

  const teams = parseTeamNames(event.eventName);
  if (!teams.homeTeam || !teams.awayTeam) return false;

  return true;
}

/**
 * Check if event has valid 1X2 odds
 */
export function hasValid1X2Odds(event: EtotoEvent): boolean {
  const odds1x2 = parse1X2Odds(event);
  return odds1x2.home > 1 && odds1x2.draw > 1 && odds1x2.away > 1;
}
