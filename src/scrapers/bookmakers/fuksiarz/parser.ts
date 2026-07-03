/**
 * Fuksiarz Parser Module
 *
 * Pure parsing logic for transforming Fuksiarz API responses
 * into the unified ScrapedMarket format.
 *
 * This module has NO Playwright dependencies - it only works with
 * raw JSON data from the API.
 */

import type { MarketSelection, ScrapedMarket } from "../../../types/full-offer.js";
import type { MarketOverUnderOdds } from "../../../types/full-offer.js";
import {
  GAME_TYPES,
  GAME_TYPE_NAMES,
  MARKET_GROUPS,
  MARKET_TYPES,
  TEAM_SEPARATOR,
} from "./constants.js";
import type {
  FuksiarzEvent,
  FuksiarzGame,
  FuksiarzOutcome,
  ParsedTeams,
  Parsed1X2Odds,
  ParsedDoubleChanceOdds,
  ParsedBTTSOdds,
  ParsedEventMarkets,
} from "./types.js";

/**
 * Minimum decimal odds accepted from the Fuksiarz API.
 * Suspended/inactive selections come back priced at exactly 1.00 (zero
 * possible profit) — such placeholders must not be stored as real odds.
 */
const MIN_VALID_ODDS = 1.01;

/**
 * Check that a selection carries a real, offerable price.
 */
function hasValidOdds(sel: MarketSelection): boolean {
  return sel.odds > MIN_VALID_ODDS;
}

/**
 * Parse team names from the Fuksiarz eventName format
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
function getMarketName(game: FuksiarzGame): string {
  // First check if we have a standard name for this game type
  const standardName = GAME_TYPE_NAMES[game.gameType];

  // For O/U markets, include the line if available from game name
  if (game.gameType === GAME_TYPES.OVER_UNDER || game.gameType === GAME_TYPES.HALF_TIME_OVER_UNDER) {
    // Try to extract line from outcome names
    const lineMatch = game.outcomes[0]?.outcomeName?.match(/(\d+[.,]?\d*)/);
    if (lineMatch) {
      const line = parseFloat(lineMatch[1].replace(",", ".")).toFixed(1);
      return `${standardName || "Liczba goli"} ${line}`;
    }
  }

  return standardName || game.gameName || `Rynek ${game.gameType}`;
}

/**
 * Get selection display name, normalizing Fuksiarz naming conventions
 */
function getSelectionName(
  outcome: FuksiarzOutcome,
  gameType: number,
  teams?: ParsedTeams
): string {
  const name = outcome.outcomeName?.trim() || "";

  // Handle 1X2 outcomes
  if (gameType === GAME_TYPES.MATCH_RESULT_1X2 || gameType === GAME_TYPES.HALF_TIME_RESULT) {
    if (name === "1" && teams?.homeTeam) return teams.homeTeam;
    if (name === "2" && teams?.awayTeam) return teams.awayTeam;
    if (name === "X" || name.toLowerCase() === "remis") return "Remis";
    return name;
  }

  // Handle Double Chance outcomes
  if (gameType === GAME_TYPES.DOUBLE_CHANCE) {
    const lowerName = name.toLowerCase();
    if (lowerName === "1/x" || lowerName === "1x") return "1X";
    if (lowerName === "x/2" || lowerName === "x2") return "X2";
    if (lowerName === "1/2" || lowerName === "12") return "12";
    return name.toUpperCase();
  }

  // Handle BTTS outcomes
  if (gameType === GAME_TYPES.BTTS || gameType === GAME_TYPES.HALF_TIME_BTTS) {
    const lowerName = name.toLowerCase();
    if (lowerName === "tak") return "Tak";
    if (lowerName === "nie") return "Nie";
    return name;
  }

  // Handle O/U outcomes - keep the full name with line
  if (gameType === GAME_TYPES.OVER_UNDER || gameType === GAME_TYPES.HALF_TIME_OVER_UNDER) {
    const lowerName = name.toLowerCase();
    if (lowerName.includes("powyżej") || lowerName.includes("powyzej")) {
      return "Powyzej";
    }
    if (lowerName.includes("poniżej") || lowerName.includes("ponizej")) {
      return "Ponizej";
    }
    return name;
  }

  return name;
}

/**
 * Parse 1X2 market odds from event data
 * Used for backward compatibility with scrapeLeague
 */
export function parse1X2Odds(event: FuksiarzEvent): Parsed1X2Odds {
  const result: Parsed1X2Odds = { home: 0, draw: 0, away: 0 };

  for (const game of event.eventGames || []) {
    const gameName = (game.gameName || "").toLowerCase();

    // Look for 1X2 game type
    if (game.gameType === GAME_TYPES.MATCH_RESULT_1X2 && gameName === "1x2") {
      const outcomes = game.outcomes || [];
      if (outcomes.length >= 3 && result.home === 0) {
        // Sort by position to ensure correct order
        const sorted = [...outcomes].sort((a, b) => a.outcomePosition - b.outcomePosition);
        result.home = sorted[0]?.outcomeOdds || 0;
        result.draw = sorted[1]?.outcomeOdds || 0;
        result.away = sorted[2]?.outcomeOdds || 0;
        break;
      }
    }
  }

  return result;
}

/**
 * Parse Double Chance market from event games
 */
export function parseDoubleChance(event: FuksiarzEvent): ParsedDoubleChanceOdds | null {
  const result: ParsedDoubleChanceOdds = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
  let found = false;

  for (const game of event.eventGames || []) {
    const gameName = (game.gameName || "").toLowerCase();

    if (game.gameType === GAME_TYPES.DOUBLE_CHANCE && gameName.includes("szansa")) {
      for (const outcome of game.outcomes || []) {
        const name = (outcome.outcomeName || "").toLowerCase();
        if (name === "1/x") {
          result.homeOrDraw = outcome.outcomeOdds;
          found = true;
        } else if (name === "x/2") {
          result.drawOrAway = outcome.outcomeOdds;
          found = true;
        } else if (name === "1/2") {
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
export function parseBTTS(event: FuksiarzEvent): ParsedBTTSOdds | null {
  const result: ParsedBTTSOdds = { yes: 0, no: 0 };
  let found = false;

  for (const game of event.eventGames || []) {
    const gameName = (game.gameName || "").toLowerCase();

    if (game.gameType === GAME_TYPES.BTTS && gameName.includes("obie") && gameName.includes("strzel")) {
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
export function parseOverUnder(event: FuksiarzEvent): Record<string, MarketOverUnderOdds> | null {
  const result: Record<string, MarketOverUnderOdds> = {};

  for (const game of event.eventGames || []) {
    const gameName = (game.gameName || "").toLowerCase();

    if (game.gameType === GAME_TYPES.OVER_UNDER && gameName === "liczba goli") {
      for (const outcome of game.outcomes || []) {
        const name = (outcome.outcomeName || "").toLowerCase();
        const lineMatch = name.match(/(\d+[.,]?\d*)/);

        if (lineMatch) {
          const lineVal = parseFloat(lineMatch[1].replace(",", "."));
          // Only include half-integer lines (e.g., 2.5, 3.5)
          if (lineVal % 1 === 0.5) {
            const line = lineVal.toFixed(1);
            if (!result[line]) {
              result[line] = { over: 0, under: 0 };
            }
            if (name.includes("powyżej") || name.includes("powyzej")) {
              result[line].over = outcome.outcomeOdds;
            } else if (name.includes("poniżej") || name.includes("ponizej")) {
              result[line].under = outcome.outcomeOdds;
            }
          }
        }
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse all legacy markets for backward compatibility
 */
export function parseEventMarkets(event: FuksiarzEvent): ParsedEventMarkets {
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
  event: FuksiarzEvent,
  teams?: ParsedTeams
): ScrapedMarket[] {
  const markets: ScrapedMarket[] = [];
  const games = event.eventGames || [];

  if (games.length === 0) {
    return markets;
  }

  // Get teams from event if not provided
  const parsedTeams = teams || parseTeamNames(event.eventName);

  // Process each game/market
  for (const game of games) {
    const outcomes = game.outcomes || [];
    if (outcomes.length === 0) continue;

    // For O/U markets, group by line
    if (game.gameType === GAME_TYPES.OVER_UNDER || game.gameType === GAME_TYPES.HALF_TIME_OVER_UNDER) {
      // Group outcomes by line value
      const lineGroups = new Map<string, FuksiarzOutcome[]>();

      for (const outcome of outcomes) {
        const lineMatch = outcome.outcomeName?.match(/(\d+[.,]?\d*)/);
        if (lineMatch) {
          const line = parseFloat(lineMatch[1].replace(",", ".")).toFixed(1);
          if (!lineGroups.has(line)) {
            lineGroups.set(line, []);
          }
          lineGroups.get(line)!.push(outcome);
        }
      }

      // Create a market for each line
      for (const [line, lineOutcomes] of lineGroups) {
        const selections: MarketSelection[] = lineOutcomes
          .map((outcome) => ({
            name: getSelectionName(outcome, game.gameType, parsedTeams),
            odds: outcome.outcomeOdds || 0,
            externalId: String(outcome.outcomeId),
          }))
          .filter(hasValidOdds);

        if (selections.length > 0) {
          const baseName = game.gameType === GAME_TYPES.HALF_TIME_OVER_UNDER
            ? "Liczba goli 1. polowa"
            : "Liczba goli";

          markets.push({
            name: `${baseName} ${line}`,
            // Carry the stable Fuksiarz game type id so the audit can match
            // by id instead of brittle name regex
            bookmakerMarketId: String(game.gameType),
            groupName: MARKET_GROUPS[game.gameType] || "Inne",
            type: MARKET_TYPES[game.gameType],
            selections,
          });
        }
      }
    } else {
      // Standard market - all outcomes belong to one market
      const selections: MarketSelection[] = outcomes
        .sort((a, b) => a.outcomePosition - b.outcomePosition)
        .map((outcome) => ({
          name: getSelectionName(outcome, game.gameType, parsedTeams),
          odds: outcome.outcomeOdds || 0,
          externalId: String(outcome.outcomeId),
        }))
        .filter(hasValidOdds);

      if (selections.length > 0) {
        markets.push({
          name: getMarketName(game),
          // Carry the stable Fuksiarz game type id so the audit can match
          // by id instead of brittle name regex
          bookmakerMarketId: String(game.gameType),
          groupName: MARKET_GROUPS[game.gameType] || "Inne",
          type: MARKET_TYPES[game.gameType],
          selections,
        });
      }
    }
  }

  return markets;
}

/**
 * Validate that an event has the minimum required data
 */
export function isValidEvent(event: FuksiarzEvent): boolean {
  if (!event.eventName) return false;
  if (!event.eventId) return false;

  const teams = parseTeamNames(event.eventName);
  if (!teams.homeTeam || !teams.awayTeam) return false;

  return true;
}

/**
 * Check if event has valid 1X2 odds
 */
export function hasValid1X2Odds(event: FuksiarzEvent): boolean {
  const odds1x2 = parse1X2Odds(event);
  return odds1x2.home > 1 && odds1x2.draw > 1 && odds1x2.away > 1;
}
