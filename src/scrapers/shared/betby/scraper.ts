/**
 * Browserless scraper for the Betby (bettech, Sportradar UOF) brands betters and lebull.
 *
 * It still extends PlaywrightScraper, because the aggregator, the audit tooling and the
 * scripts all address scrapers through that class, but it never opens a browser: every
 * method reads the prematch snapshot, the event endpoint and the market descriptions over
 * plain HTTP through BetbyClient.
 *
 * Per league: the snapshot lists the upcoming matches with their listing markets (1, 10,
 * 16, 18). The event endpoint then gives each match its full market list. A match the
 * event endpoint has no usable payload for keeps its listing markets, so one withdrawn or
 * just-started event never costs the run.
 *
 * Betby ids are 19-digit strings above 2^53 and stay strings here (matchId, eventId,
 * tournament id, deep links).
 */
import type { Page } from "playwright";
import { getBookmakerLeagueId } from "../../../config/leagues.js";
import type { FullMatchOffer, FullOfferScraperResult, ScrapedMarket } from "../../../types/full-offer.js";
import type {
  EventUrlEntry,
  MatchDetailResult,
  MatchIdentifier,
  RawScrapedMatchOdds,
  RawScrapedOdds,
  ScraperConfig,
  ScraperResult,
} from "../../../types/scraper.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { findMatchingEvent, getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";
import { BetbyClient } from "./client.js";
import { buildScrapedMarkets, extractBetbyEventId, selectLeagueEvents } from "./parser.js";
import { classifyLine, formatLine, parseSpecifiers, readTotalLine } from "./specifiers.js";
import type { BetbyBookmaker, BetbyBrandConfig, BetbyEvent, BetbyEventRef, FetchText } from "./types.js";

/** Pause between two event requests of one league, to stay gentle on an API with unknown rate limits. */
export const DEFAULT_EVENT_DELAY_MS = 150;

export interface BetbyScraperDeps {
  fetchText?: FetchText;
  /** Clock in ms: picks the upcoming matches and drives the client caches. */
  now?: () => number;
  eventDelayMs?: number;
}

/** The eventIds of one scrapeFullOffer call, split by whether the event endpoint gave a payload. */
export interface BetbyRunStats {
  full: string[];
  listingOnly: string[];
}

/** UOF outcome ids of the legacy markets (`scrapeLeague`, `scrapeMatchDetails`). */
const RESULT_IDS = ["1", "2", "3"] as const; // home, draw, away
const DOUBLE_CHANCE_IDS = ["9", "11", "10"] as const; // 1X, X2, 12
const BTTS_IDS = ["74", "76"] as const; // yes, no
const TOTAL_IDS = ["12", "13"] as const; // over, under

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Trimmed competitor names of an event payload, or null unless it names exactly two. */
function competitorNames(event: BetbyEvent): [string, string] | null {
  const competitors = event.desc?.competitors;
  if (!Array.isArray(competitors) || competitors.length !== 2) return null;
  const [home, away] = competitors.map((c) => (typeof c?.name === "string" ? c.name.trim() : ""));
  return home === "" || away === "" ? null : [home, away];
}

/**
 * Prices of one market by outcome id, in the order asked, or null unless every id quotes.
 * `markets` comes from buildScrapedMarkets, which already dropped blocked outcomes and
 * prices below 1.01. `paramValue` undefined means the market without a specifier.
 */
function quotes(
  markets: ScrapedMarket[],
  marketId: string,
  paramValue: string | undefined,
  outcomeIds: readonly string[],
): number[] | null {
  const market = markets.find((m) => m.bookmakerMarketId === marketId && m.paramValue === paramValue);
  if (market === undefined) return null;
  const byId = new Map(market.selections.map((s) => [s.externalId, s.odds]));
  const prices = outcomeIds.map((id) => byId.get(id));
  return prices.every((p) => p !== undefined) ? (prices as number[]) : null;
}

/**
 * Full-time totals (market 18) on half lines, keyed `"2.5"` as the legacy O/U shape expects.
 * Whole and quarter lines can push or split, so they stay out, and so does any specifier
 * with keys besides `total` (a time window is a different bet).
 */
function halfLineTotals(markets: ScrapedMarket[]): Record<string, { over: number; under: number }> {
  const totals: Record<string, { over: number; under: number }> = {};
  for (const m of markets) {
    if (m.bookmakerMarketId !== "18" || m.paramValue === undefined) continue;
    const specs = parseSpecifiers(m.paramValue);
    if (Object.keys(specs).length !== 1) continue;
    const line = readTotalLine(specs.total);
    if (line === null || classifyLine(line) !== "half") continue;
    const prices = quotes([m], "18", m.paramValue, TOTAL_IDS);
    if (prices !== null) totals[formatLine(line)] = { over: prices[0], under: prices[1] };
  }
  return totals;
}

export class BetbyScraper extends PlaywrightScraper {
  bookmaker: BetbyBookmaker;
  config: ScraperConfig;
  readonly client: BetbyClient;
  /** The eventIds of the last scrapeFullOffer call; null until one completes. `scripts/betby-smoke.ts` reads it. */
  lastRunStats: BetbyRunStats | null = null;

  private readonly brand: BetbyBrandConfig;
  private readonly tag: string;
  private readonly now: () => number;
  private readonly eventDelayMs: number;

  /** Does no I/O: the client resolves its endpoints on the first request. */
  constructor(brand: BetbyBrandConfig, deps: BetbyScraperDeps = {}) {
    super();
    this.brand = brand;
    this.bookmaker = brand.bookmaker;
    this.config = { ...DEFAULT_SCRAPER_CONFIGS[brand.bookmaker], enabled: true };
    this.tag = brand.logTag;
    this.now = deps.now ?? (() => Date.now());
    this.eventDelayMs = deps.eventDelayMs ?? DEFAULT_EVENT_DELAY_MS;
    this.client = new BetbyClient(brand, { fetchText: deps.fetchText, now: deps.now });
  }

  async scrapeFullOffer(league: string): Promise<FullOfferScraperResult> {
    const startedAt = Date.now();
    this.lastRunStats = null;
    try {
      const tournamentId = this.tournamentId(league);
      if (tournamentId === null) throw new Error(`Unknown league: ${league}`);

      const snapshot = await this.client.fetchSnapshot();
      const refs = selectLeagueEvents(snapshot, tournamentId, this.now());
      if (refs.length === 0) {
        throw new Error(
          `Betby ${this.tag}: 0 upcoming matches for tournament ${tournamentId} in snapshot ${snapshot.manifestVersion} (${Object.keys(snapshot.events).length} events)`,
        );
      }

      const descriptions = await this.client.fetchDescriptions();
      const stats: BetbyRunStats = { full: [], listingOnly: [] };
      const matches: FullMatchOffer[] = [];
      for (const [i, ref] of refs.entries()) {
        if (i > 0 && this.eventDelayMs > 0) await this.delay(this.eventDelayMs);
        const event = await this.fullEvent(ref);
        (event === null ? stats.listingOnly : stats.full).push(ref.eventId);

        const markets = buildScrapedMarkets(event?.markets ?? ref.listingMarkets, descriptions, [ref.homeTeam, ref.awayTeam]);
        if (markets.length === 0) {
          console.warn(`[${this.tag}/FullOffer] ${ref.eventId}: no quotable markets; skipped`);
          continue;
        }
        matches.push({
          matchId: ref.eventId,
          bookmaker: this.bookmaker,
          homeTeam: getCanonicalTeamName(ref.homeTeam, league),
          awayTeam: getCanonicalTeamName(ref.awayTeam, league),
          eventUrl: this.brand.buildEventUrl(ref),
          markets,
          startTime: ref.startTime,
          scrapedAt: new Date(this.now()),
        });
      }
      this.lastRunStats = stats;

      const totalMarkets = matches.reduce((n, m) => n + m.markets.length, 0);
      console.log(
        `[${this.tag}/FullOffer] Completed: ${matches.length} matches (${stats.full.length} full, ${stats.listingOnly.length} listing-only), ${totalMarkets} markets`,
      );
      return { success: true, bookmaker: this.bookmaker, league, matches, duration: Date.now() - startedAt };
    } catch (err) {
      return this.createFullOfferErrorResult(league, err, Date.now() - startedAt);
    }
  }

  /** The upcoming matches with their listing 1X2. */
  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startedAt = Date.now();
    try {
      const tournamentId = this.tournamentId(league);
      if (tournamentId === null) return this.createNotFoundResult(`Unknown league: ${league}`, Date.now() - startedAt);

      const snapshot = await this.client.fetchSnapshot();
      const data: RawScrapedOdds[] = [];
      for (const ref of selectLeagueEvents(snapshot, tournamentId, this.now())) {
        const prices = quotes(buildScrapedMarkets(ref.listingMarkets, {}, [ref.homeTeam, ref.awayTeam]), "1", undefined, RESULT_IDS);
        if (prices === null) continue;
        data.push({
          bookmaker: this.bookmaker,
          eventName: `${ref.homeTeam} - ${ref.awayTeam}`,
          homeTeam: getCanonicalTeamName(ref.homeTeam, league),
          awayTeam: getCanonicalTeamName(ref.awayTeam, league),
          homeOdds: prices[0],
          drawOdds: prices[1],
          awayOdds: prices[2],
          hasNoTaxPromo: false,
          scrapedAt: new Date(this.now()),
          eventId: ref.eventId,
          eventUrl: this.brand.buildEventUrl(ref),
        });
      }
      return { status: "success", bookmaker: this.bookmaker, data, duration: Date.now() - startedAt, timestamp: new Date() };
    } catch (err) {
      return this.createErrorResult(err, Date.now() - startedAt);
    }
  }

  async scrapeMatch(match: MatchIdentifier): Promise<ScraperResult> {
    const startedAt = Date.now();
    const league = match.leagueId ?? "ekstraklasa";

    const all = await this.scrapeLeague(league);
    if (all.status !== "success" || !all.data) return all;

    const hit = findMatchingEvent({ homeTeam: match.homeTeam, awayTeam: match.awayTeam }, all.data, league);
    if (!hit) {
      return this.createNotFoundResult(
        `Match not found on ${this.tag}: ${match.homeTeam} vs ${match.awayTeam}`,
        Date.now() - startedAt,
      );
    }
    return { status: "success", bookmaker: this.bookmaker, data: [hit.event], duration: Date.now() - startedAt, timestamp: new Date() };
  }

  /** 1X2 (1), double chance (10), BTTS (29) and half-line totals (18) from the event endpoint. */
  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startedAt = Date.now();
    const eventId = extractBetbyEventId(eventUrl);
    if (eventId === null) {
      return this.createMatchDetailNotFoundResult(`Invalid ${this.tag} event URL: ${eventUrl}`, Date.now() - startedAt);
    }

    try {
      const event = await this.client.fetchEvent(eventId);
      const teams = event === null ? null : competitorNames(event);
      if (event === null || teams === null) {
        return this.createMatchDetailNotFoundResult(`Event ${eventId} not found in the ${this.tag} API`, Date.now() - startedAt);
      }

      const markets = buildScrapedMarkets(event.markets, {}, teams);
      const result = quotes(markets, "1", undefined, RESULT_IDS);
      if (result === null) {
        return this.createMatchDetailNotFoundResult(`Event ${eventId} has no complete 1X2 on ${this.tag}`, Date.now() - startedAt);
      }
      const doubleChance = quotes(markets, "10", undefined, DOUBLE_CHANCE_IDS);
      const btts = quotes(markets, "29", undefined, BTTS_IDS);
      const totals = halfLineTotals(markets);

      const data: RawScrapedMatchOdds = {
        bookmaker: this.bookmaker,
        eventName: `${teams[0]} - ${teams[1]}`,
        homeTeam: teams[0],
        awayTeam: teams[1],
        eventUrl,
        eventId,
        hasNoTaxPromo: false,
        scrapedAt: new Date(this.now()),
        market1X2: { home: result[0], draw: result[1], away: result[2] },
        marketDoubleChance: doubleChance
          ? { homeOrDraw: doubleChance[0], drawOrAway: doubleChance[1], homeOrAway: doubleChance[2] }
          : undefined,
        marketBTTS: btts ? { yes: btts[0], no: btts[1] } : undefined,
        marketOverUnder: Object.keys(totals).length > 0 ? totals : undefined,
      };
      return { status: "success", bookmaker: this.bookmaker, data, duration: Date.now() - startedAt, timestamp: new Date() };
    } catch (err) {
      return this.createMatchDetailErrorResult(err, Date.now() - startedAt);
    }
  }

  /** Betby event URLs come from the snapshot, never from a listing page. */
  async extractEventUrls(_page: Page): Promise<EventUrlEntry[]> {
    return [];
  }

  /** The league's Betby tournament id, or null when the league is not mapped for this brand. */
  private tournamentId(league: string): string | null {
    const id = getBookmakerLeagueId(league, this.bookmaker);
    if (id === undefined) return null;
    // A number here would be a config bug: a 19-digit id cannot survive as a JS number.
    if (typeof id !== "string") throw new Error(`Betby ${this.tag}: tournament id for ${league} must be a string, got ${id}`);
    return id;
  }

  /**
   * The full event payload for one match, or null (after a warning) when the listing markets
   * must do: the endpoint has no event for the id, the request failed, or the payload names
   * other teams than the snapshot. That last check matters because every outcome id is
   * relative to competitor 1 and 2, so a reordered payload would put each price on the
   * wrong side.
   */
  private async fullEvent(ref: BetbyEventRef): Promise<BetbyEvent | null> {
    let reason: string;
    try {
      const event = await this.client.fetchEvent(ref.eventId);
      const teams = event === null ? null : competitorNames(event);
      if (event === null) {
        reason = "the event endpoint has no event for this id";
      } else if (teams === null || teams[0] !== ref.homeTeam || teams[1] !== ref.awayTeam) {
        reason = `teams ${teams?.join(" - ") ?? "missing"} differ from the snapshot`;
      } else {
        return event;
      }
    } catch (err) {
      reason = errorMessage(err);
    }
    console.warn(`[${this.tag}/FullOffer] ${ref.eventId}: no event payload (${reason}); using listing markets`);
    return null;
  }
}
