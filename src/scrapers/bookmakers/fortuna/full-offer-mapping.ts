/**
 * fortuna's full-offer mapping, shared by the HTTP and browser paths: the valid fixtures
 * of a listing, and one fixture plus its raw markets → one FullMatchOffer.
 */
import type { FullMatchOffer } from "../../../types/full-offer.js";
import { getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { buildEventUrl } from "./navigation.js";
import { isValidFixture, parseAllMarkets, parseTeamNames } from "./parser.js";
import type { FortunaFixture, FortunaFixturesResponse, FortunaMarket } from "./types.js";

/** The listing's valid fixtures, in listing order. */
export function selectFortunaFixtures(listing: FortunaFixturesResponse | null | undefined): FortunaFixture[] {
  return (listing?.fixtures ?? []).filter((fixture) => isValidFixture(fixture));
}

/** One fixture's offer, or null when it has no raw markets or none parses. */
export function mapFortunaFixtureOffer(fixture: FortunaFixture, rawMarkets: FortunaMarket[], league: string): FullMatchOffer | null {
  if (rawMarkets.length === 0) return null;
  const teams = parseTeamNames(fixture);
  const markets = parseAllMarkets(rawMarkets, teams);
  if (markets.length === 0) return null;

  const offer: FullMatchOffer = {
    matchId: fixture.id,
    bookmaker: "fortuna",
    homeTeam: getCanonicalTeamName(teams.homeTeam, league),
    awayTeam: getCanonicalTeamName(teams.awayTeam, league),
    eventUrl: buildEventUrl(fixture.id, fixture.seoName),
    markets,
    startTime: new Date(fixture.startDatetime).toISOString(),
    scrapedAt: new Date(),
  };
  console.log(`[Fortuna/FullOffer] ${teams.homeTeam} vs ${teams.awayTeam}: ${markets.length} markets`);
  return offer;
}
