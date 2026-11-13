/**
 * betfan's full-offer mapping, shared by the HTTP and browser paths. Identity (id,
 * teams, deep link) comes from the listed event, the markets from its detail, and the
 * kickoff from the detail when it has one, else from the listing; null when the
 * detail has no markets.
 */
import type { FullMatchOffer } from "../../../types/full-offer.js";
import { getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { toIsoStartTime } from "../../shared/start-time.js";
import { buildEventUrl } from "./navigation.js";
import { parseAllMarkets, parseTeamNames } from "./parser.js";
import type { BetfanEvent } from "./types.js";

export function toBetfanOffer(listed: BetfanEvent, detail: BetfanEvent, league: string): FullMatchOffer | null {
  const markets = parseAllMarkets(detail);
  if (markets.length === 0) return null;
  const teams = parseTeamNames(listed);
  return {
    matchId: String(listed.eventId),
    bookmaker: "betfan",
    homeTeam: getCanonicalTeamName(teams.homeTeam, league),
    awayTeam: getCanonicalTeamName(teams.awayTeam, league),
    eventUrl: buildEventUrl(listed.eventId),
    markets,
    startTime: toIsoStartTime(detail.eventStart ?? listed.eventStart),
    scrapedAt: new Date(),
  };
}
