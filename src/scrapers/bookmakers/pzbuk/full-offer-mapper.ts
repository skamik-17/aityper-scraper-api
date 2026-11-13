/**
 * The one PZBuk event-to-FullMatchOffer mapping, shared by the browser path
 * and the direct WebSocket path (README §3 parity pattern): both transports
 * hand an event plus an INITIAL_STATE snapshot to the same pure code, so their
 * output is identical by construction.
 */
import type { FullMatchOffer, ScrapedMarket } from "../../../types/full-offer.js";
import { getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { buildEventUrl } from "./navigation.js";
import { isValidEvent, parseAllMarkets, parseTeamNames } from "./parser.js";
import type { ParsedTeams, PZBukEvent, PZBukInitialState } from "./types.js";

/** The offer object of one event, given its already parsed markets. */
export function buildPzbukMatchOffer(
  event: PZBukEvent,
  teams: ParsedTeams,
  markets: ScrapedMarket[],
  league: string,
  scrapedAt: Date
): FullMatchOffer {
  return {
    matchId: event.id,
    bookmaker: "pzbuk",
    homeTeam: getCanonicalTeamName(teams.homeTeam, league),
    awayTeam: getCanonicalTeamName(teams.awayTeam, league),
    eventUrl: buildEventUrl(event.id, teams.homeTeam, teams.awayTeam, event.leagueId, event.leagueName),
    markets,
    startTime: event.startingOn,
    scrapedAt,
  };
}

/**
 * Maps one event and its offer snapshot. Null when the event is not a valid
 * fixture, a team name is missing, or no market parses from the snapshot.
 */
export function mapEventOffer(
  event: PZBukEvent,
  offer: PZBukInitialState,
  league: string,
  scrapedAt: Date
): FullMatchOffer | null {
  if (!isValidEvent(event)) return null;
  const teams = parseTeamNames(event);
  if (!teams.homeTeam || !teams.awayTeam) return null;
  const markets = parseAllMarkets(offer, event.id, teams);
  if (markets.length === 0) return null;
  return buildPzbukMatchOffer(event, teams, markets, league, scrapedAt);
}
