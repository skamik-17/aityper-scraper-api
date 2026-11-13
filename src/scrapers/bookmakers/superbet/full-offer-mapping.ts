/**
 * superbet's full-offer mapping, shared by the HTTP and browser paths: the upcoming,
 * offered events of a by-date listing in kickoff order, and one event detail → one
 * FullMatchOffer.
 */
import type { FullMatchOffer } from "../../../types/full-offer.js";
import { getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { toIsoStartTime } from "../../shared/start-time.js";
import { buildEventUrl } from "./navigation.js";
import { isUpcomingOfferedEvent, parseAllMarkets, parseTeamNames } from "./parser.js";
import type { SuperbetEvent, SuperbetEventDetailResponse } from "./types.js";

/**
 * The by-date listing mixes already-played matches (status FINISHED, marketCount 0-1)
 * in with upcoming ones. Keeps only genuine upcoming events that still carry an offer,
 * soonest first, so matches[0] reflects the true full offer rather than a settled match.
 */
export function selectUpcomingSuperbetEvents(events: readonly SuperbetEvent[], now: number): SuperbetEvent[] {
  return events
    .filter((event) => isUpcomingOfferedEvent(event, now))
    .sort((a, b) => (a.unixDateMillis ?? 0) - (b.unixDateMillis ?? 0));
}

/** The offer of the detail's first event, or null when there is none or it has no markets. */
export function mapSuperbetEventOffer(detail: SuperbetEventDetailResponse | null | undefined, league: string): FullMatchOffer | null {
  const fullEvent = detail?.data?.[0];
  if (!fullEvent) return null;
  const teams = parseTeamNames(fullEvent.matchName);
  const markets = parseAllMarkets(fullEvent, teams);
  if (markets.length === 0) return null;

  const offer: FullMatchOffer = {
    matchId: String(fullEvent.eventId),
    bookmaker: "superbet",
    homeTeam: getCanonicalTeamName(teams.homeTeam, league),
    awayTeam: getCanonicalTeamName(teams.awayTeam, league),
    eventUrl: buildEventUrl(fullEvent.eventId),
    markets,
    startTime: toIsoStartTime(fullEvent.unixDateMillis),
    scrapedAt: new Date(),
  };
  console.log(`[Superbet/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${markets.length} markets`);
  return offer;
}
