/**
 * Betcris Parser Module
 *
 * Pure parsing logic for transforming Swarm WebSocket API responses
 * into the unified ScrapedMarket format.
 *
 * This module has NO Playwright dependencies - it only works with
 * raw JSON data captured from WebSocket frames.
 */

import type { MarketSelection, ScrapedMarket } from "../../../types/full-offer.js";
import type { MarketOverUnderOdds } from "../../../types/markets.js";
import type { RawScrapedOdds, RawScrapedMatchOdds } from "../../../types/scraper.js";
import type {
  SwarmData,
  SwarmGame,
  SwarmMarket,
  SwarmEvent,
  ParsedTeams,
} from "./types.js";
import {
  SWARM_MARKET_TYPES,
  MARKET_GROUPS,
  MARKET_TYPE_MAPPING,
  SELECTION_CODES,
  WS_CONFIG,
} from "./constants.js";
import { getCanonicalTeamName } from "../../team-matcher.js";

/**
 * Parse team names from a Swarm game
 */
export function parseTeamNames(game: SwarmGame): ParsedTeams {
  return {
    homeTeam: game.team1_name?.trim() || "",
    awayTeam: game.team2_name?.trim() || "",
  };
}

/**
 * Parse 1X2 odds from a game's markets
 */
export function parse1X2Odds(game: SwarmGame): {
  home: number;
  draw: number;
  away: number;
} {
  const result = { home: 0, draw: 0, away: 0 };

  for (const market of Object.values(game.market || {})) {
    if (market.type === SWARM_MARKET_TYPES.MATCH_RESULT) {
      for (const event of Object.values(market.event || {})) {
        const price = event.price;
        if (!price || price <= 1) continue;

        if (event.type_1 === SELECTION_CODES.HOME) result.home = price;
        else if (event.type_1 === SELECTION_CODES.DRAW) result.draw = price;
        else if (event.type_1 === SELECTION_CODES.AWAY) result.away = price;
      }
      break;
    }
  }

  return result;
}

/**
 * Parse Double Chance odds from a game's markets
 */
export function parseDoubleChance(game: SwarmGame): {
  homeOrDraw: number;
  drawOrAway: number;
  homeOrAway: number;
} | null {
  const result = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
  let found = false;

  for (const market of Object.values(game.market || {})) {
    // Check for exact Double Chance market type
    if (market.type === SWARM_MARKET_TYPES.DOUBLE_CHANCE) {
      for (const event of Object.values(market.event || {})) {
        const price = event.price;
        const name = event.name?.toLowerCase() || "";
        const type1 = event.type_1?.toUpperCase() || "";
        if (!price || price <= 1) continue;

        if (type1 === SELECTION_CODES.HOME_OR_DRAW || name.includes("1x") || name.includes("w1 lub x")) {
          result.homeOrDraw = price;
          found = true;
        } else if (type1 === SELECTION_CODES.DRAW_OR_AWAY || name.includes("x2") || name.includes("x lub w2")) {
          result.drawOrAway = price;
          found = true;
        } else if (type1 === SELECTION_CODES.HOME_OR_AWAY || name.includes("12") || name.includes("w1 lub w2")) {
          result.homeOrAway = price;
          found = true;
        }
      }
      break;
    }
  }

  return found ? result : null;
}

/**
 * Parse BTTS odds from a game's markets
 */
export function parseBTTS(game: SwarmGame): {
  yes: number;
  no: number;
} | null {
  const result = { yes: 0, no: 0 };
  let found = false;

  for (const market of Object.values(game.market || {})) {
    if (market.type === SWARM_MARKET_TYPES.BTTS) {
      for (const event of Object.values(market.event || {})) {
        const price = event.price;
        const type1 = event.type_1?.toLowerCase() || "";
        if (!price || price <= 1) continue;

        if (type1 === SELECTION_CODES.YES.toLowerCase()) {
          result.yes = price;
          found = true;
        } else if (type1 === SELECTION_CODES.NO.toLowerCase()) {
          result.no = price;
          found = true;
        }
      }
      break;
    }
  }

  return found ? result : null;
}

/**
 * Parse Over/Under odds from a game's markets
 */
export function parseOverUnder(game: SwarmGame): Record<string, MarketOverUnderOdds> | null {
  const result: Record<string, MarketOverUnderOdds> = {};

  for (const market of Object.values(game.market || {})) {
    // Only exact OverUnder type (not HalfTimeOverUnder, Team1OverUnder, etc.)
    if (market.type === SWARM_MARKET_TYPES.OVER_UNDER) {
      const base = market.base;

      if (base && base > 0 && base.toString().includes(".5")) {
        const line = base.toFixed(1);
        if (!result[line]) result[line] = { over: 0, under: 0 };

        for (const event of Object.values(market.event || {})) {
          const price = event.price;
          const type1 = event.type_1?.toLowerCase() || "";
          if (!price || price <= 1) continue;

          if (type1 === SELECTION_CODES.OVER.toLowerCase()) result[line].over = price;
          else if (type1 === SELECTION_CODES.UNDER.toLowerCase()) result[line].under = price;
        }
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Get human-readable market name from Swarm market
 */
function getMarketName(market: SwarmMarket): string {
  // Prefer the market name from the API if available
  if (market.name && market.name.length > 0) {
    return market.name;
  }

  // Fallback to type-based naming
  switch (market.type) {
    case SWARM_MARKET_TYPES.MATCH_RESULT:
      return "Wynik meczu";
    case SWARM_MARKET_TYPES.DOUBLE_CHANCE:
    case SWARM_MARKET_TYPES.DOUBLE_CHANCE_ALT:
      return "Podwojna szansa";
    case SWARM_MARKET_TYPES.OVER_UNDER:
      return market.base ? `Liczba goli ${market.base}` : "Liczba goli";
    case SWARM_MARKET_TYPES.BTTS:
      return "Obie druzyny strzela";
    case SWARM_MARKET_TYPES.HALF_TIME_RESULT:
      return "Wynik 1. polowy";
    case SWARM_MARKET_TYPES.HALF_TIME_OVER_UNDER:
      return market.base ? `Gole 1. polowa ${market.base}` : "Gole 1. polowa";
    case SWARM_MARKET_TYPES.HALF_TIME_BTTS:
      return "Obie strzela 1. polowa";
    case SWARM_MARKET_TYPES.TEAM1_OVER_UNDER:
      return market.base ? `Gole gospodarzy ${market.base}` : "Gole gospodarzy";
    case SWARM_MARKET_TYPES.TEAM2_OVER_UNDER:
      return market.base ? `Gole gosci ${market.base}` : "Gole gosci";
    case SWARM_MARKET_TYPES.ASIAN_HANDICAP:
      return market.base ? `Handicap azjatycki ${market.base}` : "Handicap azjatycki";
    case SWARM_MARKET_TYPES.EUROPEAN_HANDICAP:
      return market.base ? `Handicap europejski ${market.base}` : "Handicap europejski";
    case SWARM_MARKET_TYPES.CORRECT_SCORE:
      return "Dokladny wynik";
    case SWARM_MARKET_TYPES.DRAW_NO_BET:
      return "Remis = zwrot";
    case SWARM_MARKET_TYPES.ODD_EVEN:
      return "Parzyste/Nieparzyste";
    case SWARM_MARKET_TYPES.WIN_TO_NIL:
      return "Wygrana do zera";
    case SWARM_MARKET_TYPES.CLEAN_SHEET:
      return "Czyste konto";
    case SWARM_MARKET_TYPES.HALF_TIME_FULL_TIME:
      return "Wynik polowa/mecz";
    default:
      return market.name || `Rynek ${market.type}`;
  }
}

/**
 * Get selection display name from Swarm event
 */
function getSelectionName(event: SwarmEvent, market: SwarmMarket, teams?: ParsedTeams): string {
  // Prefer the event name if meaningful
  if (event.name && event.name.length > 1 && !event.name.match(/^[0-9]+$/)) {
    return event.name;
  }

  const type1 = event.type_1?.toUpperCase() || "";

  // Map type_1 codes to display names
  switch (type1) {
    case SELECTION_CODES.HOME:
      return teams?.homeTeam || "1";
    case SELECTION_CODES.DRAW:
      return "Remis";
    case SELECTION_CODES.AWAY:
      return teams?.awayTeam || "2";
    case SELECTION_CODES.HOME_OR_DRAW:
      return "1X";
    case SELECTION_CODES.DRAW_OR_AWAY:
      return "X2";
    case SELECTION_CODES.HOME_OR_AWAY:
      return "12";
    case SELECTION_CODES.OVER.toUpperCase():
      return market.base ? `Powyzej ${market.base}` : "Powyzej";
    case SELECTION_CODES.UNDER.toUpperCase():
      return market.base ? `Ponizej ${market.base}` : "Ponizej";
    case SELECTION_CODES.YES.toUpperCase():
      return "Tak";
    case SELECTION_CODES.NO.toUpperCase():
      return "Nie";
    default:
      return event.name || type1;
  }
}

/**
 * Parse ALL markets from a game into unified ScrapedMarket format
 * This is the main function for full offer scraping
 */
export function parseAllMarkets(game: SwarmGame, teams?: ParsedTeams): ScrapedMarket[] {
  const markets: ScrapedMarket[] = [];
  const parsedTeams = teams || parseTeamNames(game);

  for (const market of Object.values(game.market || {})) {
    const events = Object.values(market.event || {});
    if (events.length === 0) continue;

    // Get market metadata
    const marketName = getMarketName(market);
    const groupName = MARKET_GROUPS[market.type] || "Inne";
    const marketType = MARKET_TYPE_MAPPING[market.type];

    // Convert selections
    const selections: MarketSelection[] = events
      .map((event) => ({
        name: getSelectionName(event, market, parsedTeams),
        odds: event.price || 0,
        externalId: String(event.id),
        status: "active" as const,
      }))
      .filter((sel) => sel.odds > 1);

    if (selections.length > 0) {
      markets.push({
        name: marketName,
        groupName,
        type: marketType,
        selections,
      });
    }
  }

  return markets;
}

/**
 * Parse Swarm data for league listing (1X2 odds only)
 * Used by scrapeLeague for comparison tables
 */
export function parseSwarmDataForLeague(
  data: SwarmData,
  league: string,
  competitionId: number
): RawScrapedOdds[] {
  const bookmaker = "betcris" as const;
  const matches: RawScrapedOdds[] = [];

  for (const sport of Object.values(data.sport || {})) {
    // Only football
    if (sport.alias !== "Soccer") continue;

    for (const region of Object.values(sport.region || {})) {
      for (const competition of Object.values(region.competition || {})) {
        // Filter by competition ID
        if (competition.id !== competitionId) continue;

        for (const game of Object.values(competition.game || {})) {
          // Skip blocked games
          if (game.is_blocked) continue;

          const teams = parseTeamNames(game);
          if (!teams.homeTeam || !teams.awayTeam) continue;

          const odds1x2 = parse1X2Odds(game);

          // Skip if no valid 1X2 odds
          if (odds1x2.home <= 1 || odds1x2.draw <= 1 || odds1x2.away <= 1) continue;

          // Build event URL
          const regionAlias = region.alias || "England";
          const eventUrl = `https://www.betcris.pl/zaklady-bukmacherskie/match/Soccer/${regionAlias}/${competition.id}/${game.id}`;

          matches.push({
            bookmaker,
            eventName: `${teams.homeTeam} - ${teams.awayTeam}`,
            homeTeam: getCanonicalTeamName(teams.homeTeam, league),
            awayTeam: getCanonicalTeamName(teams.awayTeam, league),
            homeOdds: odds1x2.home,
            drawOdds: odds1x2.draw,
            awayOdds: odds1x2.away,
            hasNoTaxPromo: false,
            scrapedAt: new Date(),
            eventUrl,
          });
        }
      }
    }
  }

  return matches;
}

/**
 * Parse Swarm data for match details (extended markets)
 * Used by scrapeMatchDetails
 */
export function parseSwarmDataForMatchDetails(
  data: SwarmData,
  eventUrl: string,
  targetGameId?: number
): RawScrapedMatchOdds | null {
  // Find the target game by ID or the game with most markets
  let targetGame: SwarmGame | null = null;
  let bestGame: SwarmGame | null = null;
  let maxMarkets = 0;

  for (const sport of Object.values(data.sport || {})) {
    for (const region of Object.values(sport.region || {})) {
      for (const competition of Object.values(region.competition || {})) {
        for (const game of Object.values(competition.game || {})) {
          const marketCount = Object.keys(game.market || {}).length;

          if (targetGameId && game.id === targetGameId) {
            targetGame = game;
          }

          if (marketCount > maxMarkets) {
            maxMarkets = marketCount;
            bestGame = game;
          }
        }
      }
    }
  }

  const game = targetGame || bestGame;
  if (!game || Object.keys(game.market || {}).length < WS_CONFIG.MIN_MARKETS_MATCH_DETAILS) {
    return null;
  }

  const teams = parseTeamNames(game);
  if (!teams.homeTeam) return null;

  // Parse all standard markets
  const odds1x2 = parse1X2Odds(game);
  const doubleChance = parseDoubleChance(game);
  const btts = parseBTTS(game);
  const overUnder = parseOverUnder(game);

  return {
    bookmaker: "betcris",
    eventName: `${teams.homeTeam} - ${teams.awayTeam}`,
    homeTeam: teams.homeTeam,
    awayTeam: teams.awayTeam,
    eventUrl,
    hasNoTaxPromo: false,
    scrapedAt: new Date(),
    market1X2: {
      home: odds1x2.home,
      draw: odds1x2.draw,
      away: odds1x2.away,
    },
    marketDoubleChance: doubleChance || undefined,
    marketBTTS: btts || undefined,
    marketOverUnder: overUnder || undefined,
  };
}

/**
 * Parse Swarm data for full offer scraping
 * Returns all matches with all their markets
 */
export function parseSwarmDataForFullOffer(
  data: SwarmData,
  league: string,
  competitionId: number
): Array<{
  game: SwarmGame;
  teams: ParsedTeams;
  regionAlias: string;
  competitionId: number;
}> {
  const results: Array<{
    game: SwarmGame;
    teams: ParsedTeams;
    regionAlias: string;
    competitionId: number;
  }> = [];

  for (const sport of Object.values(data.sport || {})) {
    if (sport.alias !== "Soccer") continue;

    for (const region of Object.values(sport.region || {})) {
      for (const competition of Object.values(region.competition || {})) {
        if (competition.id !== competitionId) continue;

        for (const game of Object.values(competition.game || {})) {
          if (game.is_blocked) continue;

          const teams = parseTeamNames(game);
          if (!teams.homeTeam || !teams.awayTeam) continue;

          results.push({
            game,
            teams,
            regionAlias: region.alias || "",
            competitionId: competition.id,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Validate that a game has enough markets for match details
 */
export function hasEnoughMarkets(game: SwarmGame): boolean {
  return Object.keys(game.market || {}).length >= WS_CONFIG.MIN_MARKETS_MATCH_DETAILS;
}

/**
 * Check if a game has valid 1X2 odds
 */
export function hasValid1X2Odds(game: SwarmGame): boolean {
  const odds = parse1X2Odds(game);
  return odds.home > 1 && odds.draw > 1 && odds.away > 1;
}
