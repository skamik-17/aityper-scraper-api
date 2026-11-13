/**
 * lvbet's full-offer mapping, shared by the HTTP and browser paths: the valid matches of
 * a competition view, and one match plus its raw markets → one FullMatchOffer.
 */
import type { FullMatchOffer } from "../../../types/full-offer.js";
import { getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { toIsoStartTime } from "../../shared/start-time.js";
import { buildEventUrl } from "./navigation.js";
import { isValidMatch, parseAllMarkets } from "./parser.js";
import type { LVBetCompetitionResponse, LVBetMarket, LVBetMatch } from "./types.js";

/** The competition view's valid matches, in listing order. */
export function selectLvbetMatches(listing: LVBetCompetitionResponse | null | undefined): LVBetMatch[] {
  return (listing?.matches ?? []).filter((match) => isValidMatch(match));
}

/** One match's offer, or null when it has no raw markets or none parses. */
export function mapLvbetMatchOffer(match: LVBetMatch, rawMarkets: LVBetMarket[], league: string): FullMatchOffer | null {
  if (rawMarkets.length === 0) return null;
  const homeTeam = match.home![0];
  const awayTeam = match.away![0];
  const markets = parseAllMarkets(rawMarkets, { homeTeam, awayTeam });
  if (markets.length === 0) return null;

  const offer: FullMatchOffer = {
    matchId: match.match_id,
    bookmaker: "lvbet",
    homeTeam: getCanonicalTeamName(homeTeam, league),
    awayTeam: getCanonicalTeamName(awayTeam, league),
    eventUrl: buildEventUrl(match, league),
    markets,
    startTime: toIsoStartTime(match.date),
    scrapedAt: new Date(),
  };
  console.log(`[LVBet/FullOffer] ${homeTeam} vs ${awayTeam}: ${markets.length} markets`);
  return offer;
}
