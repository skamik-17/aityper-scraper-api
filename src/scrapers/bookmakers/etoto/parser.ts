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
 *
 * Prefers the human-readable label provided directly by the eToto API
 * (`game.gameName`, e.g. "1x2", "Podwójna szansa", "Suma goli"). Only falls
 * back to derived/hard-coded names when the API name is blank. This mirrors
 * the Fortuna fix so the normalization audit receives the bookmaker's real
 * market names instead of placeholder-replaced ones.
 */
export function getMarketName(game: EtotoGame): string {
  // Use the API-provided name when available.
  const apiName = (game.gameName || "").trim();
  if (apiName) {
    return apiName;
  }

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
      // Create unique market key for line markets.
      // Scoreline handicaps ("Handicap 1:0", "1. połowa - handicap 2:0") are
      // already unique per line, and the eToto API argument uses the opposite
      // sign convention (arg -1 for the home +1 scoreline 1:0), so appending
      // it would produce misleading names like "handicap 1:0 -1".
      let uniqueName = marketName;
      const hasScorelineHandicap = /handicap\s+\d+\s*:\s*\d+/i.test(marketName);
      if (
        typeof game.argument === "number" &&
        !hasScorelineHandicap &&
        !marketName.includes(String(game.argument))
      ) {
        uniqueName = `${marketName} ${game.argument}`;
      }

      markets.push({
        name: uniqueName,
        // Carry the stable eToto market-type id so the audit can match by id
        // instead of relying on brittle name regexes.
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
 * Patterns identifying combo / specials pseudo-events that the eToto category
 * endpoint returns alongside real matches (e.g. "Dzień meczowy 26.06 - 6 meczów").
 * These are not real two-team fixtures: they only carry a handful of special
 * markets, so they must be skipped — otherwise the audit measures matches[0]
 * (this pseudo-event, ~50 markets) instead of a real match's full offer (~541).
 */
const COMBO_EVENT_PATTERNS: RegExp[] = [
  // Matchday combo bets, e.g. "Dzień meczowy 26.06"
  /dzie[nń]\s+meczow/i,
  // A side that is just a count of matches, e.g. "6 meczów" / "6 mecze"
  /^\d+\s*mecz/i,
];

/**
 * Returns true when the event is a combo/specials pseudo-event rather than a
 * real two-team fixture, based on its name (and either side of it).
 */
export function isComboEvent(event: EtotoEvent): boolean {
  const eventName = event.eventName || "";
  const teams = parseTeamNames(eventName);
  const candidates = [eventName, teams.homeTeam, teams.awayTeam];
  return COMBO_EVENT_PATTERNS.some((re) => candidates.some((c) => re.test(c)));
}

/**
 * Validate that an event has the minimum required data
 */
export function isValidEvent(event: EtotoEvent): boolean {
  if (!event.eventName) return false;
  if (!event.eventId) return false;

  const teams = parseTeamNames(event.eventName);
  if (!teams.homeTeam || !teams.awayTeam) return false;

  // Skip combo/specials pseudo-events so audits measure a real match.
  if (isComboEvent(event)) return false;

  return true;
}
