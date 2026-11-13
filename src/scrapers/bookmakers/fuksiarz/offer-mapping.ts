/**
 * fuksiarz's full-offer mapping, shared by the HTTP and browser paths. Identity (id,
 * teams, deep link) comes from the listed event, the markets and the kickoff from its
 * detail; null when the detail has no markets.
 */
import type { FullMatchOffer } from "../../../types/full-offer.js";
import { getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { toIsoStartTime } from "../../shared/start-time.js";
import { buildEventUrl } from "./navigation.js";
import { parseAllMarkets, parseTeamNames } from "./parser.js";
import type { FuksiarzEvent } from "./types.js";

export function toFuksiarzOffer(listed: FuksiarzEvent, detail: FuksiarzEvent, league: string): FullMatchOffer | null {
  const teams = parseTeamNames(listed.eventName);
  const markets = parseAllMarkets(detail, teams);
  if (markets.length === 0) return null;
  return {
    matchId: String(listed.eventId),
    bookmaker: "fuksiarz",
    homeTeam: getCanonicalTeamName(teams.homeTeam, league),
    awayTeam: getCanonicalTeamName(teams.awayTeam, league),
    eventUrl: buildEventUrl(listed.eventId),
    markets,
    // eventStart may be epoch seconds or ms; toIsoStartTime applies the same < 1e12 rule
    startTime: toIsoStartTime(detail.eventStart),
    scrapedAt: new Date(),
  };
}
