/**
 * forbet's full-offer mapping, shared by the HTTP and browser paths: one listed event
 * and its detail payload → one FullMatchOffer, or null when the detail has no markets.
 */
import type { FullMatchOffer } from "../../../types/full-offer.js";
import { getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { toIsoStartTime } from "../../shared/start-time.js";
import { buildEventUrl } from "./navigation.js";
import { parseAllMarkets, parseTeamNames } from "./parser.js";
import type { ForbetEvent } from "./types.js";

export function toForbetOffer(_listed: ForbetEvent, detail: ForbetEvent, league: string): FullMatchOffer | null {
  const teams = parseTeamNames(detail.eventName);
  const markets = parseAllMarkets(detail, teams);
  if (markets.length === 0) return null;
  return {
    matchId: String(detail.eventId),
    bookmaker: "forbet",
    homeTeam: getCanonicalTeamName(teams.homeTeam, league),
    awayTeam: getCanonicalTeamName(teams.awayTeam, league),
    eventUrl: buildEventUrl(detail.eventId),
    markets,
    startTime: toIsoStartTime(detail.eventStart),
    scrapedAt: new Date(),
  };
}
