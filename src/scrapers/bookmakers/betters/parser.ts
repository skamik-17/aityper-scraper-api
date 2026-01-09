/**
 * Betters Parser Module
 *
 * Pure parsing logic for transforming Betters API responses
 * into the unified ScrapedMarket format.
 *
 * This module has NO Playwright dependencies - it only works with
 * raw JSON data from the intercepted API responses.
 */

import type { MarketSelection, ScrapedMarket } from "../../../types/full-offer.js";
import type { MarketOverUnderOdds } from "../../../types/full-offer.js";
import {
  STAKE_TYPES,
  STAKE_CODES_1X2,
  MARKET_GROUPS,
  MARKET_TYPES,
} from "./constants.js";
import type {
  BettersEvent,
  BettersStakeType,
  BettersStake,
  Parsed1X2Odds,
  ParsedDoubleChanceOdds,
  ParsedBTTSOdds,
  ParsedEventMarkets,
  ParsedTeams,
} from "./types.js";

/**
 * Parse team names from a Betters event
 */
export function parseTeamNames(event: BettersEvent): ParsedTeams {
  return {
    homeTeam: (event.teamA || "").trim(),
    awayTeam: (event.teamB || "").trim(),
  };
}

/**
 * Parse 1X2 market odds from event data
 */
export function parse1X2Odds(event: BettersEvent): Parsed1X2Odds {
  const result: Parsed1X2Odds = { home: 0, draw: 0, away: 0 };

  for (const stakeType of event.stakeTypes || []) {
    if (stakeType.stakeTypeId !== STAKE_TYPES.MATCH_RESULT) continue;

    const stakes = stakeType.stakes || [];
    if (stakes.length < 3) continue;

    for (const s of stakes) {
      if (s.stakeCode === STAKE_CODES_1X2.HOME) result.home = s.betFactor;
      else if (s.stakeCode === STAKE_CODES_1X2.DRAW) result.draw = s.betFactor;
      else if (s.stakeCode === STAKE_CODES_1X2.AWAY) result.away = s.betFactor;
    }

    // Only take the first 1X2 market (main market)
    if (result.home > 0) break;
  }

  return result;
}

/**
 * Parse Double Chance market from event data
 */
export function parseDoubleChance(event: BettersEvent): ParsedDoubleChanceOdds | null {
  const result: ParsedDoubleChanceOdds = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
  let found = false;

  for (const stakeType of event.stakeTypes || []) {
    if (stakeType.stakeTypeId !== STAKE_TYPES.DOUBLE_CHANCE) continue;

    for (const s of stakeType.stakes || []) {
      const name = (s.stakeName || "").toUpperCase();
      if (name === "1X") {
        result.homeOrDraw = s.betFactor;
        found = true;
      } else if (name === "X2") {
        result.drawOrAway = s.betFactor;
        found = true;
      } else if (name === "12") {
        result.homeOrAway = s.betFactor;
        found = true;
      }
    }
  }

  return found ? result : null;
}

/**
 * Parse BTTS market from event data
 */
export function parseBTTS(event: BettersEvent): ParsedBTTSOdds | null {
  const result: ParsedBTTSOdds = { yes: 0, no: 0 };
  let found = false;

  for (const stakeType of event.stakeTypes || []) {
    if (stakeType.stakeTypeId !== STAKE_TYPES.BTTS) continue;

    for (const s of stakeType.stakes || []) {
      const name = (s.stakeName || "").toLowerCase();
      if (name === "tak") {
        result.yes = s.betFactor;
        found = true;
      } else if (name === "nie") {
        result.no = s.betFactor;
        found = true;
      }
    }
  }

  return found ? result : null;
}

/**
 * Parse Over/Under markets from event data
 * Returns a record keyed by line (e.g., "2.5")
 */
export function parseOverUnder(event: BettersEvent): Record<string, MarketOverUnderOdds> | null {
  const result: Record<string, MarketOverUnderOdds> = {};

  for (const stakeType of event.stakeTypes || []) {
    if (stakeType.stakeTypeId !== STAKE_TYPES.OVER_UNDER) continue;

    for (const s of stakeType.stakes || []) {
      const lineVal = s.stakeArgument;
      // Only include .5 lines (e.g., 0.5, 1.5, 2.5, 3.5)
      if (typeof lineVal !== "number" || lineVal % 1 !== 0.5) continue;

      const line = lineVal.toFixed(1);
      const name = (s.stakeName || "").toLowerCase();

      if (!result[line]) {
        result[line] = { over: 0, under: 0 };
      }

      if (name.includes("powyżej") || name.includes("powyzej")) {
        result[line].over = s.betFactor;
      } else if (name.includes("poniżej") || name.includes("ponizej")) {
        result[line].under = s.betFactor;
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse all standard markets from event data
 * Returns the legacy market structure for backward compatibility
 */
export function parseEventMarkets(event: BettersEvent): ParsedEventMarkets {
  return {
    m1X2: parse1X2Odds(event),
    mDC: parseDoubleChance(event) || { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 },
    mBTTS: parseBTTS(event) || { yes: 0, no: 0 },
    mOU: parseOverUnder(event) || {},
  };
}

/**
 * Get human-readable market name based on stake type
 */
function getMarketName(stakeType: BettersStakeType, line?: number): string {
  const stakeTypeId = stakeType.stakeTypeId;

  switch (stakeTypeId) {
    case STAKE_TYPES.MATCH_RESULT:
      return "Wynik meczu";
    case STAKE_TYPES.DOUBLE_CHANCE:
      return "Podwojna szansa";
    case STAKE_TYPES.BTTS:
      return "Obie druzyny strzelą";
    case STAKE_TYPES.OVER_UNDER:
      if (line !== undefined) {
        return `Liczba goli ${line.toFixed(1)}`;
      }
      return "Liczba goli";
    case STAKE_TYPES.HANDICAP:
      if (line !== undefined) {
        return `Handicap ${line > 0 ? "+" : ""}${line}`;
      }
      return "Handicap";
    case STAKE_TYPES.HALF_TIME_RESULT:
      return "Wynik 1. polowy";
    case STAKE_TYPES.HALF_TIME_OVER_UNDER:
      if (line !== undefined) {
        return `Liczba goli 1. polowa ${line.toFixed(1)}`;
      }
      return "Liczba goli 1. polowa";
    case STAKE_TYPES.CORRECT_SCORE:
      return "Dokladny wynik";
    case STAKE_TYPES.DRAW_NO_BET:
      return "Remis = zwrot";
    default:
      return stakeType.stakeTypeName || `Rynek ${stakeTypeId}`;
  }
}

/**
 * Get selection display name
 */
function getSelectionName(
  stakeCode: number,
  stakeName: string,
  stakeTypeId: number,
  homeTeam?: string,
  awayTeam?: string
): string {
  // For 1X2 markets, use team names or standard labels
  if (stakeTypeId === STAKE_TYPES.MATCH_RESULT || stakeTypeId === STAKE_TYPES.HALF_TIME_RESULT) {
    if (stakeCode === STAKE_CODES_1X2.HOME) {
      return homeTeam || "1";
    } else if (stakeCode === STAKE_CODES_1X2.DRAW) {
      return "Remis";
    } else if (stakeCode === STAKE_CODES_1X2.AWAY) {
      return awayTeam || "2";
    }
  }

  // For other markets, clean up the stake name
  if (stakeName) {
    return stakeName;
  }

  return String(stakeCode);
}

/**
 * Parse ALL markets from event into unified ScrapedMarket format
 * This is the main function for full offer scraping
 */
export function parseAllMarkets(event: BettersEvent, teams?: ParsedTeams): ScrapedMarket[] {
  const markets: ScrapedMarket[] = [];
  const stakeTypes = event.stakeTypes || [];

  if (stakeTypes.length === 0) {
    return markets;
  }

  // Get teams from event if not provided
  const parsedTeams = teams || parseTeamNames(event);
  const homeTeam = parsedTeams.homeTeam;
  const awayTeam = parsedTeams.awayTeam;

  // Group selections by stake type and line value
  for (const stakeType of stakeTypes) {
    const stakeTypeId = stakeType.stakeTypeId;
    const stakes = stakeType.stakes || [];

    if (stakes.length === 0) continue;

    // Check if this is a line market (O/U, handicap)
    const hasLines = stakes.some((s) => typeof s.stakeArgument === "number");

    if (hasLines) {
      // Group by line value
      const lineGroups = new Map<number, typeof stakes>();

      for (const stake of stakes) {
        const line = stake.stakeArgument;
        if (typeof line !== "number") continue;

        if (!lineGroups.has(line)) {
          lineGroups.set(line, []);
        }
        lineGroups.get(line)!.push(stake);
      }

      // Create a market for each line
      Array.from(lineGroups.entries()).forEach(([line, lineStakes]) => {
        const marketName = getMarketName(stakeType, line);
        const groupName = MARKET_GROUPS[stakeTypeId] || "Inne";
        const marketType = MARKET_TYPES[stakeTypeId];

        const selections: MarketSelection[] = lineStakes
          .map((stake) => ({
            name: getSelectionName(stake.stakeCode, stake.stakeName, stakeTypeId, homeTeam, awayTeam),
            odds: stake.betFactor,
            externalId: stake.stakeId ? String(stake.stakeId) : undefined,
          }))
          .filter((sel) => sel.odds > 0);

        if (selections.length > 0) {
          markets.push({
            name: marketName,
            groupName,
            type: marketType,
            selections,
          });
        }
      });
    } else {
      // Non-line market (1X2, DC, BTTS, etc.)
      const marketName = getMarketName(stakeType);
      const groupName = MARKET_GROUPS[stakeTypeId] || "Inne";
      const marketType = MARKET_TYPES[stakeTypeId];

      const selections: MarketSelection[] = stakes
        .map((stake) => ({
          name: getSelectionName(stake.stakeCode, stake.stakeName, stakeTypeId, homeTeam, awayTeam),
          odds: stake.betFactor,
          externalId: stake.stakeId ? String(stake.stakeId) : undefined,
        }))
        .filter((sel) => sel.odds > 0);

      if (selections.length > 0) {
        markets.push({
          name: marketName,
          groupName,
          type: marketType,
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
export function isValidEvent(event: BettersEvent): boolean {
  if (!event.teamA || !event.teamB) return false;
  if (!event.eventId) return false;
  return true;
}

/**
 * Check if event has valid 1X2 odds
 */
export function hasValid1X2Odds(event: BettersEvent): boolean {
  const odds1x2 = parse1X2Odds(event);
  return odds1x2.home > 1 && odds1x2.draw > 1 && odds1x2.away > 1;
}
