
import { getBookmakerLeagueId } from "../../../config/leagues.js";
import type { FullMatchOffer, FullOfferScraperResult } from "../../../types/full-offer.js";
import type {
  ScraperConfig,
} from "../../../types/scraper.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../../types/scraper.js";
import { getCanonicalTeamName } from "../../../utils/team-matcher.js";
import { PlaywrightScraper } from "../../base/playwright-base.js";
import { BudgetExceededError, budgetAbortReason, createScrapeBudget, type ScrapeBudget } from "../budget.js";
import { MAX_SKIPPED_DETAIL_RATIO } from "../detail-fetch.js";
import type { HttpClient } from "../http/http-client.js";
import { HttpError } from "../http/http-error.js";
import type { TransportStats } from "../scraper-contract.js";
import { BetbyClient } from "./client.js";
import { BETBY_BUDGET_MS } from "./http.js";
import { buildScrapedMarkets, selectLeagueEvents } from "./parser.js";
import type { BetbyBookmaker, BetbyBrandConfig, BetbyEvent, BetbyEventRef, FetchText } from "./types.js";

/** Pause between two event requests of one league, to stay gentle on an API with unknown rate limits. */
export const DEFAULT_EVENT_DELAY_MS = 150;

/** Consecutive failed event requests after which a scrape stops (README §5.1). */
export const MAX_CONSECUTIVE_EVENT_FAILURES = 2;

export interface BetbyScraperDeps {
  /** Raw transport (tests); wins over `http`. */
  fetchText?: FetchText;
  /** HTTP client of the brand; defaults to a fresh shared-HttpClient instance. */
  http?: HttpClient;
  /** Clock in ms: picks the upcoming matches and drives the client caches. */
  now?: () => number;
  eventDelayMs?: number;
}

/** The eventIds of one scrapeFullOffer call, split by what the event endpoint gave. */
export interface BetbyRunStats {
  full: string[];
  listingOnly: string[];
  /** Event requests that failed; these matches were skipped. */
  failed: string[];
}

/** What the event endpoint gave for one match: a payload, no payload (listing fallback), or a failed request. */
type FullEventOutcome = { event: BetbyEvent } | { none: string } | { failed: string }; // over, under

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

export class BetbyScraper extends PlaywrightScraper {
  bookmaker: BetbyBookmaker;
  readonly transport = "http" as const;
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
    this.client = new BetbyClient(brand, { fetchText: deps.fetchText, http: deps.http, now: deps.now });
  }

  /** Counters of this brand's HttpClient, cumulative since construction (copies). */
  transportStats(): TransportStats {
    return this.client.transportStats();
  }

  async scrapeFullOffer(league: string, budget?: ScrapeBudget): Promise<FullOfferScraperResult> {
    const startedAt = Date.now();
    this.lastRunStats = null;
    const runBudget = budget ?? createScrapeBudget(BETBY_BUDGET_MS);
    try {
      const tournamentId = this.tournamentId(league);
      if (tournamentId === null) throw new Error(`Unknown league: ${league}`);

      const snapshot = await this.client.fetchSnapshot(runBudget.signal);
      const refs = selectLeagueEvents(snapshot, tournamentId, this.now());
      if (refs.length === 0) {
        // README §3 empty-listing rule: success with no matches (observability: `empty`)
        const reason = `Betby ${this.tag}: 0 upcoming matches for tournament ${tournamentId} in snapshot ${snapshot.manifestVersion} (${Object.keys(snapshot.events).length} events)`;
        console.warn(`[${this.tag}/FullOffer] ${reason}`);
        this.lastRunStats = { full: [], listingOnly: [], failed: [] };
        return { success: true, bookmaker: this.bookmaker, league, matches: [], error: reason, duration: Date.now() - startedAt };
      }

      const descriptions = await this.client.fetchDescriptions(runBudget.signal);
      const stats: BetbyRunStats = { full: [], listingOnly: [], failed: [] };
      const matches: FullMatchOffer[] = [];
      // Error texts of the failed event requests: all of them, and the current unbroken run.
      const failures: string[] = [];
      let streak: string[] = [];
      for (const [i, ref] of refs.entries()) {
        if (i > 0 && this.eventDelayMs > 0) await this.delay(this.eventDelayMs);
        runBudget.checkpoint();
        const outcome = await this.fullEvent(ref, runBudget.signal);
        if ("failed" in outcome) {
          stats.failed.push(ref.eventId);
          failures.push(outcome.failed);
          streak.push(outcome.failed);
          console.warn(`[${this.tag}/FullOffer] ${ref.eventId}: event request failed (${outcome.failed}); match skipped`);
          if (streak.length >= MAX_CONSECUTIVE_EVENT_FAILURES) {
            // The endpoint is down: stop asking, and write nothing so the previous rows stay.
            this.lastRunStats = stats;
            const error = `stopped after ${streak.length} consecutive event failures | ${streak[0]}`;
            return this.createFullOfferErrorResult(league, new Error(error), Date.now() - startedAt);
          }
          continue;
        }
        streak = [];
        const event = "event" in outcome ? outcome.event : null;
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
        `[${this.tag}/FullOffer] Completed: ${matches.length} matches (${stats.full.length} full, ${stats.listingOnly.length} listing-only, ${stats.failed.length} failed), ${totalMarkets} markets`,
      );
      if (stats.failed.length === 0) {
        return { success: true, bookmaker: this.bookmaker, league, matches, duration: Date.now() - startedAt };
      }
      // m: matches written plus failed requests; matches without quotable markets count in neither.
      const attempted = matches.length + stats.failed.length;
      const error = `${stats.failed.length} of ${attempted} details failed | ${failures[0]}`;
      if (stats.failed.length / attempted > MAX_SKIPPED_DETAIL_RATIO) {
        return this.createFullOfferErrorResult(league, new Error(error), Date.now() - startedAt);
      }
      return { success: true, bookmaker: this.bookmaker, league, matches, error, duration: Date.now() - startedAt };
    } catch (err) {
      // A budget abort reports the budget's reason, not the request it happened to cut.
      const cause = runBudget.signal.aborted ? budgetAbortReason(runBudget.signal) : err;
      return this.createFullOfferErrorResult(league, cause, Date.now() - startedAt);
    }
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
   * What the event endpoint gives for one match:
   * - `{ event }`: a payload naming the snapshot's teams.
   * - `{ none }` (after a warning): the listing markets must do, because the endpoint has no
   *   event for the id (HTTP 200 without `events`, or 404) or the payload names other teams
   *   than the snapshot. That check matters because every outcome id is relative to
   *   competitor 1 and 2, so a reordered payload would put each price on the wrong side.
   * - `{ failed }`: the request itself failed (another HTTP status, timeout, network, invalid
   *   JSON); the caller skips the match.
   * A budget abort is rethrown instead: the scrape then fails as a whole.
   */
  private async fullEvent(ref: BetbyEventRef, signal: AbortSignal): Promise<FullEventOutcome> {
    let event: BetbyEvent | null;
    try {
      event = await this.client.fetchEvent(ref.eventId, signal);
    } catch (err) {
      if (err instanceof BudgetExceededError || (err instanceof HttpError && err.kind === "aborted")) throw err;
      return { failed: errorMessage(err) };
    }
    const teams = event === null ? null : competitorNames(event);
    let reason: string;
    if (event === null) {
      reason = "the event endpoint has no event for this id";
    } else if (teams === null || teams[0] !== ref.homeTeam || teams[1] !== ref.awayTeam) {
      reason = `teams ${teams?.join(" - ") ?? "missing"} differ from the snapshot`;
    } else {
      return { event };
    }
    console.warn(`[${this.tag}/FullOffer] ${ref.eventId}: no event payload (${reason}); using listing markets`);
    return { none: reason };
  }
}
