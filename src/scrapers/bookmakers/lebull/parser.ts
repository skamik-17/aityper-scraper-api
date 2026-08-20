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
 * Stake types whose stakes carry a line/threshold value in stakeArgument.
 * These are grouped by line so each line becomes a separate market, and the
 * line value is appended to the market name so the normalizer can extract
 * the parameter (the API market names alone are generic, e.g. the bare
 * "Obie połowy powyżej" is sent for every goal line).
 */
const LINE_STAKE_TYPE_IDS: number[] = [
  STAKE_TYPES.OVER_UNDER,
  STAKE_TYPES.HALF_TIME_OVER_UNDER,
  STAKE_TYPES.HANDICAP,
  // "Obie połowy powyżej" (both halves over X goals)
  332813,
  // "Obie połowy poniżej" (both halves under X goals)
  332814,
  // "Obie drużyny suma powyżej" (each team over X goals) — the line
  // disambiguates BTTS (0.5) from BTTS 2+ goals (1.5)
  332818,
  // "Wynik meczu i suma" (result + over/under) — several goal lines per event
  134,
  // "Podwójna szansa i suma" (double chance + over/under)
  332815,
  // "Obie strzelą i suma" (BTTS + over/under)
  5774433,
];

/**
 * 3-way (European) handicap stake types carry their line in stakeArgument but
 * are only identifiable by the API market name; without line grouping all
 * lines merge into one market and the parameter is unrecoverable downstream.
 */
function isThreeWayHandicapName(apiName?: string): boolean {
  return /handicap\s*3[\s-]?drogow|handicap\s*europejsk/i.test(apiName || "");
}

/**
 * Get human-readable market name based on stake type ID
 *
 * Prefers the API-provided market type name (stakeTypeName) when available,
 * since it covers stake types beyond the hard-coded switch (e.g. the extended
 * stake type IDs requested for full offers). Falls back to the curated switch
 * and finally to a generic "Rynek <id>" placeholder only when the API name is blank.
 *
 * `line` is the (already regrouped, home-perspective for handicaps) line value
 * of the market group — NOT the raw per-stake argument, which for away-side
 * handicap stakes carries the opposite sign.
 */
function getMarketName(
  stakeTypeId: number,
  line?: string,
  apiName?: string,
  isLineMarket?: boolean
): string {
  const apiLabel = (apiName || "").trim();
  const appendLine =
    line !== undefined &&
    (isLineMarket ?? LINE_STAKE_TYPE_IDS.includes(stakeTypeId));

  if (apiLabel) {
    // For line markets, append the line value so distinct lines stay disambiguated
    if (appendLine) {
      return `${apiLabel} ${line}`;
    }
    return apiLabel;
  }

  const fallback = getFallbackMarketName(stakeTypeId, line);
  // Some fallback labels already embed the line ("Liczba goli 2.5") — only
  // append when it is still missing (e.g. the generic "Rynek <id>" label).
  if (appendLine && line !== undefined && !fallback.includes(line)) {
    return `${fallback} ${line}`;
  }
  return fallback;
}

function getFallbackMarketName(stakeTypeId: number, line?: string): string {
  switch (stakeTypeId) {
    case STAKE_TYPES.MATCH_RESULT:
      return "Wynik meczu";
    case STAKE_TYPES.DOUBLE_CHANCE:
      return "Podwojna szansa";
    case STAKE_TYPES.BTTS:
      return "Obie druzyny strzelą";
    case STAKE_TYPES.OVER_UNDER:
      if (line !== undefined) {
        return `Liczba goli ${line}`;
      }
      return "Liczba goli";
    case STAKE_TYPES.HALF_TIME_RESULT:
      return "Wynik 1. polowy";
    case STAKE_TYPES.HALF_TIME_OVER_UNDER:
      if (line !== undefined) {
        return `Liczba goli 1. polowa ${line}`;
      }
      return "Liczba goli 1. polowa";
    case STAKE_TYPES.CORRECT_SCORE:
      // On the sbteam.xyz feed stake type 7 is the half-comparison bet
      // ("1. < 2." / "1. = 2." / "1. > 2."), not a correct-score market —
      // the "Dokladny wynik" label used to reroute it into CORRECT_SCORE.
      return "Polowa z najwiekszym wynikiem";
    case STAKE_TYPES.DRAW_NO_BET:
      return "Remis = zwrot";
    case STAKE_TYPES.HANDICAP:
      if (line !== undefined) {
        return `Handicap ${line}`;
      }
      return "Handicap";
    default:
      return `Rynek ${stakeTypeId}`;
  }
}

/**
 * Determine which side a 2-way handicap stake refers to.
 * LeBull (sbteam.xyz feed, same as betters) names handicap stakes "1"/"2"
 * (optionally "Handicap 1"/"Handicap 2"); stake codes are used as a fallback.
 */
function getHandicapStakeSide(stake: LebullStake): "home" | "away" | null {
  const name = (stake.stakeName || "").toLowerCase().trim();
  if (/^(handicap\s*)?1(\b|$)/.test(name)) return "home";
  if (/^(handicap\s*)?2(\b|$)/.test(name)) return "away";
  if (stake.stakeCode === STAKE_CODES.HOME) return "home";
  if (stake.stakeCode === 2 || stake.stakeCode === STAKE_CODES.AWAY) return "away";
  return null;
}

/**
 * Sentinel odds guard: the sbteam.xyz feed pads some markets with placeholder
 * quotes (0, 1.0) that are not real prices and would poison best-odds
 * comparisons downstream.
 *
 * NOTE: 1.01 itself is a genuine short price on lopsided markets (e.g. a
 * near-certain favorite in a Draw No Bet or Double Chance market), so the
 * threshold check below must be inclusive (`>=`) — an earlier strict `>`
 * comparison silently dropped these legitimate 1.01 selections, producing
 * one-sided markets (missing HOME/YES leg) downstream.
 */
const MIN_VALID_ODDS = 1.01;

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

  // Merge the per-combo "Dokładny wynik <combos>" Yes/No stake types into a
  // single Multiwynik market: each sub-market's "Tak" price IS that combo's
  // odds. Stored per (bookmaker, market_key), the nine sub-markets would
  // otherwise overwrite each other leaving a single combo downstream.
  const multiResultSelections: MarketSelection[] = [];
  const multiResultStakeTypeIds = new Set<number>();
  for (const stakeType of stakeTypes) {
    const label = (stakeType.stakeTypeName || "").trim();
    const comboMatch = label.match(/^dok[lł]adny\s+wynik\s+(.+)$/i);
    if (!comboMatch) continue;
    const combo = comboMatch[1].trim().replace(/\s+/g, " ");
    // Besides literal score pairs and the "X"/"Remis" draw leg, the catalog's
    // MULTI_RESULT also has the two "other win" catch-all buckets — without
    // this branch they fail the score-pattern check below and get silently
    // dropped even though they are valid MULTI_RESULT legs.
    const isOtherWinCombo = /^inne\s+zwyci[eę]stwo/i.test(combo);
    if (!/\d+\s*:\s*\d+/.test(combo) && !/^(x|remis)$/i.test(combo) && !isOtherWinCombo) continue;

    const yesStake = (stakeType.stakes || []).find(
      (stake) => (stake.stakeName || "").trim().toLowerCase() === "tak"
    );
    multiResultStakeTypeIds.add(stakeType.stakeTypeId);
    if (yesStake && (yesStake.betFactor || 0) >= MIN_VALID_ODDS) {
      multiResultSelections.push({
        name: combo,
        odds: yesStake.betFactor || 0,
        externalId: yesStake.stakeId ? String(yesStake.stakeId) : undefined,
      });
    }
  }
  if (multiResultSelections.length > 0) {
    markets.push({
      name: "Multiwynik",
      // Stake type 40424 is one of the combo sub-markets; the normalizer maps
      // this id to MULTI_RESULT.
      bookmakerMarketId: "40424",
      groupName: MARKET_GROUPS[STAKE_TYPES.CORRECT_SCORE] || "Inne",
      type: MARKET_TYPES[40424],
      selections: multiResultSelections,
    });
  }

  // Group stakes by market type and line (for O/U and handicap)
  for (const stakeType of stakeTypes) {
    const stakeTypeId = stakeType.stakeTypeId;
    const stakes = stakeType.stakes || [];

    if (stakes.length === 0) continue;
    if (multiResultStakeTypeIds.has(stakeTypeId)) continue;

    // For line markets (O/U, handicap, both-halves lines) group by line value;
    // 3-way handicaps are detected by name since their stake type id varies.
    const isLineMarket =
      LINE_STAKE_TYPE_IDS.includes(stakeTypeId) ||
      isThreeWayHandicapName(stakeType.stakeTypeName);

    if (isLineMarket) {
      // Group stakes by their line value
      const lineGroups = new Map<string, LebullStake[]>();
      const isTwoWayHandicap = stakeTypeId === STAKE_TYPES.HANDICAP;
      const isThreeWayHandicap =
        !isTwoWayHandicap && isThreeWayHandicapName(stakeType.stakeTypeName);

      for (const stake of stakes) {
        let line: string;

        if (isThreeWayHandicap) {
          // The sbteam.xyz feed sends stakeArgument as JSON `null` (not an
          // omitted field) for 3-way handicap stakes, so the per-stake line
          // below is unusable; the real line already lives in the stake
          // type's own name as a "(home:away)" starting-score pair (e.g.
          // "Handicap 3-drogowy (0:3)"), shared by every stake in this stake
          // type, so group them all together instead.
          line = String(stakeTypeId);
        } else {
          // Line-market rows without a line value are duplicate/truncated feed
          // rows (e.g. a bare "Obie połowy powyżej" with no threshold), or a
          // JSON `null` rather than a genuinely missing field — either way
          // they cannot be assigned a parameter and would pollute a bogus
          // "base"/stringified-"null" bucket downstream, so skip them entirely.
          if (stake.stakeArgument === undefined || stake.stakeArgument === null) continue;

          // LeBull quotes handicap lines per selected team: the away stake with
          // stakeArgument -1.5 means "away team at -1.5", not the away side of
          // the home -1.5 market. Regroup away-side stakes under the negated
          // (home-perspective) line so each market pairs HOME(line) with
          // AWAY(-line) like every other bookmaker (same fix as betters, which
          // shares the sbteam.xyz feed).
          const groupLine =
            isTwoWayHandicap && getHandicapStakeSide(stake) === "away"
              ? -stake.stakeArgument
              : stake.stakeArgument;
          line = String(groupLine);
        }

        if (!lineGroups.has(line)) {
          lineGroups.set(line, []);
        }
        lineGroups.get(line)!.push(stake);
      }

      // Create a market for each line
      for (const [line, lineStakes] of lineGroups) {
        // 3-way handicap names already embed the line as a "(home:away)" pair
        // (e.g. "Handicap 3-drogowy (0:3)"); appending the synthetic group key
        // (the stake type id) would just tack a meaningless number onto the name.
        const marketName = getMarketName(
          stakeTypeId,
          isThreeWayHandicap ? undefined : line,
          stakeType.stakeTypeName,
          true
        );
        const groupName = MARKET_GROUPS[stakeTypeId] || "Inne";
        const marketType = MARKET_TYPES[stakeTypeId];

        const selections: MarketSelection[] = lineStakes
          .map((stake) => ({
            name: getSelectionName(stake, stakeTypeId, parsedTeams),
            odds: stake.betFactor || 0,
            externalId: stake.stakeId ? String(stake.stakeId) : undefined,
          }))
          .filter((sel) => sel.odds >= MIN_VALID_ODDS);

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
        .filter((sel) => sel.odds >= MIN_VALID_ODDS);

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
