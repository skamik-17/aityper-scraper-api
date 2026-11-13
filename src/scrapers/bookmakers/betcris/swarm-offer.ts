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
 * Why the detail copy of a listing game must not be written, or null when it
 * can be. The listing asks for the 1X2 only, so a usable detail copy has more
 * markets than the listing copy, or every market the game reports
 * (`markets_count`, the larger of both copies) when it really offers no more.
 * A thinner copy (`market: {}`, the 1X2 only) is never written, nor is the
 * listing copy in its place: either offer would prune the match's other
 * markets until the next run.
 */
export function thinDetailReason(listingGame: SwarmGame, detailGame: SwarmGame): string | null {
  const n = marketCount(detailGame);
  const listed = marketCount(listingGame);
  if (n > listed) return null;
  const reported = Math.max(listingGame.markets_count || 0, detailGame.markets_count || 0);
  if (n > 0 && reported > 0 && n >= reported) return null;
  return `game ${listingGame.id} detail has ${n} markets, no more than its listing copy (${listed}); ${reported} reported`;
}

/** Why `detail` cannot give the offer of `entry` (missing or thin copy), or null when it can */
export function detailSkipReason(entry: BetcrisListingEntry, detail: SwarmData): string | null {
  const detailGame = findGameInSwarmData(detail, entry.game.id);
  if (!detailGame) return `game ${entry.game.id} missing from reply`;
  return thinDetailReason(entry.game, detailGame);
}

/**
 * Map one listing game and its detail payload to a FullMatchOffer, from the
 * detail copy only. A missing or thin detail copy (see thinDetailReason) or a
 * game without markets gives null.
 */
export function buildBetcrisMatchOffer(
  entry: BetcrisListingEntry,
  detail: SwarmData,
  league: string,
  scrapedAt: Date
): FullMatchOffer | null {
  const game = findGameInSwarmData(detail, entry.game.id);
  if (!game || thinDetailReason(entry.game, game) !== null) return null;

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
