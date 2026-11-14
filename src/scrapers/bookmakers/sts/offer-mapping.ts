/**
 * The one mapping from an STS listing fixture plus its WebSocket payloads to a
 * FullMatchOffer, and the [STS/FullOffer] log vocabulary. Both transports (the
 * browser capture and the direct WebSocket session) go through here, so their
 * output and the log lines sts-run-check.py parses cannot drift apart.
 */
import type { FullMatchOffer } from "../../../types/full-offer.js";
import { matchToCanonical } from "../../../utils/team-matcher.js";
import { parseAllMarkets } from "./parser.js";
import type { STSFixture, STSWebSocketData } from "./types.js";

export type StsOfferResult =
  | { kind: "offer"; offer: FullMatchOffer }
  /** `warning: null` = no markets (a silent skip, as before the extraction) */
  | { kind: "skip"; warning: string | null };

const pair = (fixture: STSFixture) => `${fixture.home} vs ${fixture.away}`;

export const stsLog = {
  found: (count: number, leagueSlug: string) => `[STS/FullOffer] Found ${count} fixtures for ${leagueSlug}`,
  matchMarkets: (fixture: STSFixture, markets: number) => `[STS/FullOffer] ${pair(fixture)}: ${markets} markets`,
  completed: (matches: number, markets: number) =>
    `[STS/FullOffer] Completed: ${matches} matches, ${markets} total markets`,
  noSnapshot: (fixture: STSFixture) =>
    `[STS/FullOffer] No fixture snapshot for ${pair(fixture)} after 2 attempts - skipping (previous snapshot kept)`,
  youth: (fixture: STSFixture) => `[STS/FullOffer] Skipping ${pair(fixture)}: Youth team match`,
  notWhitelisted: (fixture: STSFixture, leagueSlug: string) =>
    `[STS/FullOffer] Skipping ${pair(fixture)}: Teams not in ${leagueSlug} whitelist`,
  sameClub: (fixture: STSFixture, canonicalName: string) =>
    `[STS/FullOffer] Dropping "${fixture.home}" vs "${fixture.away}": both canonicalize to ${canonicalName}`,
};

const YOUTH_MARKERS = ["u21", "u23", "under 21", "under 23"];

function isYouthFixture(fixture: STSFixture): boolean {
  const home = fixture.home.toLowerCase();
  const away = fixture.away.toLowerCase();
  return YOUTH_MARKERS.some((marker) => home.includes(marker) || away.includes(marker));
}

export function mapStsFixtureToOffer(
  fixture: STSFixture,
  fixtureJson: STSWebSocketData | null,
  initialJson: STSWebSocketData | null,
  leagueSlug: string,
): StsOfferResult {
  const markets = parseAllMarkets(fixture, fixtureJson, initialJson);
  if (markets.length === 0) return { kind: "skip", warning: null };

  if (isYouthFixture(fixture)) return { kind: "skip", warning: stsLog.youth(fixture) };

  const homeMatch = matchToCanonical(fixture.home, leagueSlug);
  const awayMatch = matchToCanonical(fixture.away, leagueSlug);
  if (!homeMatch || !awayMatch) return { kind: "skip", warning: stsLog.notWhitelisted(fixture, leagueSlug) };

  // Two genuinely different raw names can still canonicalize to the SAME club -
  // observed live: "Stockton Town" and "Alfreton Town" (a non-league fixture
  // that slipped past the tournament filter) both fuzzy-matched onto the
  // Premier League's "Luton Town" whitelist entry, producing a "Luton Town vs
  // Luton Town" row. This is the exact call site where two distinct inputs
  // became one output, so it is the one place that can name both raw inputs in
  // the warning - which is the diagnostic this bug otherwise leaves no trace of.
  // Compare canonical names: they are unique per roster, while national-team rosters carry id "".
  if (homeMatch.name === awayMatch.name) return { kind: "skip", warning: stsLog.sameClub(fixture, homeMatch.name) };

  return {
    kind: "offer",
    offer: {
      matchId: fixture.id,
      bookmaker: "sts",
      homeTeam: homeMatch.name,
      awayTeam: awayMatch.name,
      eventUrl: fixture.eventUrl,
      markets,
      startTime: fixture.startTime,
      scrapedAt: new Date(),
    },
  };
}
