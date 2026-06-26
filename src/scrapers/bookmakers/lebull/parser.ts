/**
 * LeBull Parser Module
 *
 * Pure parsing logic for transforming LeBull/sbteam.xyz API responses
 * into the unified ScrapedMarket format.
 *
 * This module has NO Playwright dependencies - it only works with
 * raw JSON data from the API.
 */

import type { MarketSelection, ScrapedMarket } from "../../../types/full-offer.js";
import type { MarketOverUnderOdds } from "../../../types/full-offer.js";
import type {
  LebullEvent,
  LebullStakeType,
  LebullStake,
  ParsedTeams,
  Parsed1X2Odds,
  ParsedDoubleChanceOdds,
  ParsedBTTSOdds,
  ParsedOverUnderLine,
  ParsedEventMarkets,
} from "./types.js";
import {
  STAKE_TYPES,
  STAKE_CODES,
  MARKET_GROUPS,
  MARKET_TYPES,
} from "./constants.js";

/**
 * Parse team names from a LeBull event
 */
export function parseTeamNames(event: LebullEvent): ParsedTeams {
  return {
    homeTeam: (event.teamA || "").trim(),
    awayTeam: (event.teamB || "").trim(),
  };
}

/**
 * Get human-readable market name based on stake type ID
 *
 * Prefers the API-provided market type name (stakeTypeName) when available,
 * since it covers stake types beyond the hard-coded switch (e.g. the extended
 * stake type IDs requested for full offers). Falls back to the curated switch
 * and finally to a generic "Rynek <id>" placeholder only when the API name is blank.
 */
function getMarketName(
  stakeTypeId: number,
  stake?: LebullStake,
  apiName?: string
): string {
  const apiLabel = (apiName || "").trim();

  if (apiLabel) {
    // For line markets, append the line value so distinct lines stay disambiguated
    const lineMarketTypes: number[] = [
      STAKE_TYPES.OVER_UNDER,
      STAKE_TYPES.HALF_TIME_OVER_UNDER,
      STAKE_TYPES.HANDICAP,
    ];
    if (stake?.stakeArgument !== undefined && lineMarketTypes.includes(stakeTypeId)) {
      return `${apiLabel} ${stake.stakeArgument}`;
    }
    return apiLabel;
  }

  switch (stakeTypeId) {
    case STAKE_TYPES.MATCH_RESULT:
      return "Wynik meczu";
    case STAKE_TYPES.DOUBLE_CHANCE:
      return "Podwojna szansa";
    case STAKE_TYPES.BTTS:
      return "Obie druzyny strzelą";
    case STAKE_TYPES.OVER_UNDER:
      if (stake?.stakeArgument !== undefined) {
        return `Liczba goli ${stake.stakeArgument}`;
      }
      return "Liczba goli";
    case STAKE_TYPES.HALF_TIME_RESULT:
      return "Wynik 1. polowy";
    case STAKE_TYPES.HALF_TIME_OVER_UNDER:
      if (stake?.stakeArgument !== undefined) {
        return `Liczba goli 1. polowa ${stake.stakeArgument}`;
      }
      return "Liczba goli 1. polowa";
    case STAKE_TYPES.CORRECT_SCORE:
      return "Dokladny wynik";
    case STAKE_TYPES.DRAW_NO_BET:
      return "Remis = zwrot";
    case STAKE_TYPES.HANDICAP:
      if (stake?.stakeArgument !== undefined) {
        return `Handicap ${stake.stakeArgument}`;
      }
      return "Handicap";
    default:
      return `Rynek ${stakeTypeId}`;
  }
}

/**
 * Get selection display name based on stake data
 */
function getSelectionName(
  stake: LebullStake,
  stakeTypeId: number,
  teams?: ParsedTeams
): string {
  const name = (stake.stakeName || "").trim();

  // If we have a meaningful name, use it
  if (name && name.length > 0) {
    return name;
  }

  // Otherwise map based on stake code
  switch (stakeTypeId) {
    case STAKE_TYPES.MATCH_RESULT:
    case STAKE_TYPES.HALF_TIME_RESULT:
      if (stake.stakeCode === STAKE_CODES.HOME) return teams?.homeTeam || "1";
      if (stake.stakeCode === STAKE_CODES.DRAW) return "Remis";
      if (stake.stakeCode === STAKE_CODES.AWAY) return teams?.awayTeam || "2";
      break;
    case STAKE_TYPES.BTTS:
      if (stake.stakeCode === 1) return "Tak";
      if (stake.stakeCode === 2) return "Nie";
      break;
    case STAKE_TYPES.OVER_UNDER:
    case STAKE_TYPES.HALF_TIME_OVER_UNDER:
      if (stake.stakeCode === 1) return "Powyzej";
      if (stake.stakeCode === 2) return "Ponizej";
      break;
  }

  return String(stake.stakeCode);
}

/**
 * Parse 1X2 market odds from event data
 * Used for backward compatibility with scrapeLeague
 */
export function parse1X2Odds(event: LebullEvent): Parsed1X2Odds {
  const result: Parsed1X2Odds = { home: 0, draw: 0, away: 0 };
  const stakeTypes = event.stakeTypes || [];

  for (const stakeType of stakeTypes) {
    if (stakeType.stakeTypeId === STAKE_TYPES.MATCH_RESULT && result.home === 0) {
      for (const stake of stakeType.stakes || []) {
        if (stake.stakeCode === STAKE_CODES.HOME) {
          result.home = stake.betFactor || 0;
        } else if (stake.stakeCode === STAKE_CODES.DRAW) {
          result.draw = stake.betFactor || 0;
        } else if (stake.stakeCode === STAKE_CODES.AWAY) {
          result.away = stake.betFactor || 0;
        }
      }
    }
  }

  return result;
}

/**
 * Parse Double Chance market from event
 */
export function parseDoubleChance(event: LebullEvent): ParsedDoubleChanceOdds | null {
  const result: ParsedDoubleChanceOdds = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
  let found = false;
  const stakeTypes = event.stakeTypes || [];

  for (const stakeType of stakeTypes) {
    if (stakeType.stakeTypeId === STAKE_TYPES.DOUBLE_CHANCE) {
      for (const stake of stakeType.stakes || []) {
        const name = (stake.stakeName || "").toUpperCase();
        if (name === "1X") {
          result.homeOrDraw = stake.betFactor || 0;
          found = true;
        } else if (name === "X2") {
          result.drawOrAway = stake.betFactor || 0;
          found = true;
        } else if (name === "12") {
          result.homeOrAway = stake.betFactor || 0;
          found = true;
        }
      }
    }
  }

  return found ? result : null;
}

/**
 * Parse BTTS market from event
 */
export function parseBTTS(event: LebullEvent): ParsedBTTSOdds | null {
  const result: ParsedBTTSOdds = { yes: 0, no: 0 };
  let found = false;
  const stakeTypes = event.stakeTypes || [];

  for (const stakeType of stakeTypes) {
    if (stakeType.stakeTypeId === STAKE_TYPES.BTTS) {
      for (const stake of stakeType.stakes || []) {
        const name = (stake.stakeName || "").toLowerCase();
        if (name === "tak" || name.includes("tak")) {
          result.yes = stake.betFactor || 0;
          found = true;
        } else if (name === "nie" || name.includes("nie")) {
          result.no = stake.betFactor || 0;
          found = true;
        }
      }
    }
  }

  return found ? result : null;
}

/**
 * Parse Over/Under markets from event
 * Returns a record keyed by line (e.g., "2.5")
 */
export function parseOverUnder(event: LebullEvent): Record<string, MarketOverUnderOdds> | null {
  const result: Record<string, MarketOverUnderOdds> = {};
  const stakeTypes = event.stakeTypes || [];

  for (const stakeType of stakeTypes) {
    if (stakeType.stakeTypeId === STAKE_TYPES.OVER_UNDER) {
      for (const stake of stakeType.stakes || []) {
        const lineVal = stake.stakeArgument;
        // Only process half-integer lines (e.g., 0.5, 1.5, 2.5)
        if (typeof lineVal === "number" && lineVal % 1 === 0.5) {
          const line = lineVal.toFixed(1);
          const name = (stake.stakeName || "").toLowerCase();

          if (!result[line]) {
            result[line] = { over: 0, under: 0 };
          }

          if (name.includes("powyżej") || name.includes("powyzej") || name.includes("over")) {
            result[line].over = stake.betFactor || 0;
          } else if (name.includes("poniżej") || name.includes("ponizej") || name.includes("under")) {
            result[line].under = stake.betFactor || 0;
          }
        }
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse all standard markets from event
 * Returns the legacy format used by scrapeMatchDetails
 */
export function parseEventMarkets(event: LebullEvent): ParsedEventMarkets {
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
export function parseAllMarkets(event: LebullEvent, teams?: ParsedTeams): ScrapedMarket[] {
  const markets: ScrapedMarket[] = [];
  const stakeTypes = event.stakeTypes || [];

  if (stakeTypes.length === 0) {
    return markets;
  }

  // Get teams from event if not provided
  const parsedTeams = teams || parseTeamNames(event);

  // Group stakes by market type and line (for O/U and handicap)
  for (const stakeType of stakeTypes) {
    const stakeTypeId = stakeType.stakeTypeId;
    const stakes = stakeType.stakes || [];

    if (stakes.length === 0) continue;

    // For line markets (O/U, handicap), group by line value
    const lineMarketTypes: number[] = [
      STAKE_TYPES.OVER_UNDER,
      STAKE_TYPES.HALF_TIME_OVER_UNDER,
      STAKE_TYPES.HANDICAP,
    ];
    const isLineMarket = lineMarketTypes.includes(stakeTypeId);

    if (isLineMarket) {
      // Group stakes by their line value
      const lineGroups = new Map<string, LebullStake[]>();

      for (const stake of stakes) {
        const line = stake.stakeArgument !== undefined
          ? String(stake.stakeArgument)
          : "default";

        if (!lineGroups.has(line)) {
          lineGroups.set(line, []);
        }
        lineGroups.get(line)!.push(stake);
      }

      // Create a market for each line
      for (const [line, lineStakes] of lineGroups) {
        const firstStake = lineStakes[0];
        const marketName = getMarketName(stakeTypeId, firstStake, stakeType.stakeTypeName);
        const groupName = MARKET_GROUPS[stakeTypeId] || "Inne";
        const marketType = MARKET_TYPES[stakeTypeId];

        const selections: MarketSelection[] = lineStakes
          .map((stake) => ({
            name: getSelectionName(stake, stakeTypeId, parsedTeams),
            odds: stake.betFactor || 0,
            externalId: stake.stakeId ? String(stake.stakeId) : undefined,
          }))
          .filter((sel) => sel.odds > 0);

        if (selections.length > 0) {
          markets.push({
            name: marketName,
            bookmakerMarketId: String(stakeTypeId),
            groupName,
            type: marketType,
            selections,
          });
        }
      }
    } else {
      // Non-line market - all stakes go together
      const marketName = getMarketName(stakeTypeId, undefined, stakeType.stakeTypeName);
      const groupName = MARKET_GROUPS[stakeTypeId] || "Inne";
      const marketType = MARKET_TYPES[stakeTypeId];

      const selections: MarketSelection[] = stakes
        .map((stake) => ({
          name: getSelectionName(stake, stakeTypeId, parsedTeams),
          odds: stake.betFactor || 0,
          externalId: stake.stakeId ? String(stake.stakeId) : undefined,
        }))
        .filter((sel) => sel.odds > 0);

      if (selections.length > 0) {
        markets.push({
          name: marketName,
          bookmakerMarketId: String(stakeTypeId),
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
export function isValidEvent(event: LebullEvent): boolean {
  if (!event.teamA || !event.teamB) return false;
  if (!event.eventId) return false;
  return true;
}

/**
 * Check if event has valid 1X2 odds
 */
export function hasValid1X2Odds(event: LebullEvent): boolean {
  const odds = parse1X2Odds(event);
  return odds.home > 1 && odds.draw > 1 && odds.away > 1;
}
