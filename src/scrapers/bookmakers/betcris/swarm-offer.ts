/**
 * Pure Swarm game -> FullMatchOffer mapping shared by both betcris transports
 * (browser capture and the direct Swarm client), so they write identical offers.
 */
import type { FullMatchOffer } from "../../../types/full-offer.js";
import { getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { BASE_URL } from "./constants.js";
import { parseAllMarkets, parseSwarmDataForFullOffer } from "./parser.js";
import type { SwarmData, SwarmGame } from "./types.js";

/** One listing game: { game, teams, regionAlias, competitionId } */
export type BetcrisListingEntry = ReturnType<typeof parseSwarmDataForFullOffer>[number];

/**
 * Build the event URL for a match. Stored URLs keep the www.betcris.pl form
 * although the site redirects to betsport.pl.
 */
export function buildEventUrl(regionAlias: string, competitionId: number, gameId: number): string {
  return `${BASE_URL}/zaklady-bukmacherskie/match/Soccer/${regionAlias}/${competitionId}/${gameId}`;
}

function marketCount(game: SwarmGame): number {
  return Object.keys(game.market || {}).length;
}

/** The copy of `gameId` with the most markets in `data`; the first wins ties; null when absent */
export function findGameInSwarmData(data: SwarmData, gameId: number): SwarmGame | null {
  let best: SwarmGame | null = null;
  for (const sport of Object.values(data.sport || {})) {
    for (const region of Object.values(sport.region || {})) {
      for (const competition of Object.values(region.competition || {})) {
        for (const game of Object.values(competition.game || {})) {
          if (game.id === gameId && (best === null || marketCount(game) > marketCount(best))) {
            best = game;
          }
        }
      }
    }
  }
  return best;
}

/**
 * Map one listing game and its detail payload to a FullMatchOffer. The detail
 * copy is used when it has strictly more markets than the listing copy; a game
 * without markets gives null.
 */
export function buildBetcrisMatchOffer(
  entry: BetcrisListingEntry,
  detail: SwarmData,
  league: string,
  scrapedAt: Date
): FullMatchOffer | null {
  const detailGame = findGameInSwarmData(detail, entry.game.id);
  const game =
    detailGame && marketCount(detailGame) > marketCount(entry.game) ? detailGame : entry.game;

  const markets = parseAllMarkets(game, entry.teams);
  if (markets.length === 0) return null;

  return {
    matchId: String(entry.game.id),
    bookmaker: "betcris",
    homeTeam: getCanonicalTeamName(entry.teams.homeTeam, league),
    awayTeam: getCanonicalTeamName(entry.teams.awayTeam, league),
    eventUrl: buildEventUrl(entry.regionAlias, entry.competitionId, entry.game.id),
    markets,
    startTime: game.start_ts ? new Date(game.start_ts * 1000).toISOString() : undefined,
    scrapedAt,
  };
}
