/**
 * Shared run test data, taken from scrape run 2 on 2026-11-06
 * (`440d2fc6`, premier-league, 16:00:00.350Z-16:02:49.798Z).
 * Evidence: docs/superpowers/plans/2026-11-06-scraper-recovery/observability.md
 * ("Status today" and "What still works and must not break").
 * Later tasks append their own builders to this file.
 */
import { CONFIG, type PolishBookmaker } from "../../config/index.js";
import type { BookmakerRunOutcome } from "../../services/run-outcome.js";
import {
  deriveBookmakerStatus,
  staleAfterMs,
  summarizeBookmakerRuns,
  type BookmakerHealthMeta,
  type BookmakerRunSummary,
  type BookmakerStatusSnapshot,
} from "../../services/bookmaker-status.js";
import { toScraperRunInsert } from "../../repositories/scraper-run-repository.js";
import type { BookmakerStatus } from "../../types/database.js";

export const RUN_ID = "440d2fc6-658b-46fe-b288-05261faa0caf";

/** markets_saved per bookmaker that saved rows in run 2 (sum: 68 201). */
export const RUN2_OK: Partial<Record<PolishBookmaker, number>> = {
  fuksiarz: 6222,
  forbet: 5869,
  etoto: 6553,
  betfan: 5600,
  lvbet: 9427,
  fortuna: 12897,
  superbet: 13353,
  betclic: 3150,
  sts: 5130,
};

export function outcome(p: Partial<BookmakerRunOutcome> = {}): BookmakerRunOutcome {
  return {
    runId: RUN_ID,
    bookmaker: "sts",
    league: "premier-league",
    status: "success",
    matchesFound: 20,
    marketsFound: 0,
    marketsSaved: 0,
    error: null,
    startedAt: new Date("2026-11-06T16:00:00.350Z"),
    finishedAt: new Date("2026-11-06T16:02:49.798Z"),
    durationMs: 169448,
    ...p,
  };
}

/** A run summary of a bookmaker whose newest run (run 2) succeeded, unless overridden. */
export function summary(p: Partial<BookmakerRunSummary> & { bookmaker: PolishBookmaker }): BookmakerRunSummary {
  return {
    lastStatus: "success",
    lastRunAt: "2026-11-06T16:00:00.350Z",
    lastSuccessAt: "2026-11-06T16:00:00.350Z",
    consecutiveFailures: 0,
    failingSince: null,
    lastError: null,
    lastMatchesFound: 20,
    lastMarketsSaved: 0,
    recoveredAfterFailures: 0,
    ...p,
  };
}

/** Errors of the five bookmakers that failed run 2 (navigation-enriched where the recorder saw a cause). */
export const RUN2_FAILED: Partial<Record<PolishBookmaker, string>> = {
  betters: "No events found from API | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485",
  lebull: "No events found from API | document HTTP 404 https://lebullpl-ssr.boxwebcdn.work/pl/league/1/4485",
  betcris: "No WebSocket data captured",
  pzbuk: "No WebSocket data captured | websockets opened: wss://www.pzbuk.pl/sportsbook-api/ws?franchiseCode=POLAND_PZBUK&locale=pl",
  totalbet: "No events found from API | fetch HTTP 404 https://totalbet.pl/rest/market/categories/multi/7124/events",
};

/**
 * The status snapshot right after run 2, built through the real row mapping,
 * summary and status derivation: 9 bookmakers available, 5 in error.
 */
export function snapshotFromRun2(now: Date = new Date("2026-11-06T16:16:18.614Z")): BookmakerStatusSnapshot {
  const outcomes = CONFIG.BOOKMAKERS.map((bookmaker) => {
    const saved = RUN2_OK[bookmaker];
    return saved !== undefined
      ? outcome({ bookmaker, status: "success", marketsFound: saved, marketsSaved: saved })
      : outcome({ bookmaker, status: "scrape_failed", matchesFound: 0, error: RUN2_FAILED[bookmaker] ?? null });
  });
  const summaries = summarizeBookmakerRuns(outcomes.map(toScraperRunInsert), CONFIG.BOOKMAKERS);

  const status = {} as Record<PolishBookmaker, BookmakerStatus>;
  const health = {} as Record<PolishBookmaker, BookmakerHealthMeta>;
  for (const bm of CONFIG.BOOKMAKERS) {
    const s = summaries.get(bm);
    status[bm] = deriveBookmakerStatus(s, null, now, staleAfterMs(60));
    health[bm] = {
      status: status[bm],
      lastSuccessAt: s?.lastSuccessAt ?? null,
      failingSince: s?.failingSince ?? null,
      consecutiveFailures: s?.consecutiveFailures ?? 0,
    };
  }

  return {
    source: "scraper_runs",
    status,
    health,
    summaries,
    lastOddsAt: new Map(),
    lastSuccessfulRunAt: "2026-11-06T16:02:49.798Z",
  };
}

/** A promise with its resolve/reject exposed, to hold a run open in a test. */
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A successful full-offer result for `bm`. */
export function okResult(bm: PolishBookmaker, matches: import("../../types/full-offer.js").FullMatchOffer[] = [], league = "premier-league") {
  return { success: true, bookmaker: bm, league, matches };
}

/** Twenty minimal matches H0..H19 vs A0..A19, one 1X2 market each. */
export function twentyMatches(): import("../../types/full-offer.js").FullMatchOffer[] {
  return Array.from({ length: 20 }, (_, i) => ({
    matchId: `m${i}`,
    bookmaker: "betclic" as PolishBookmaker,
    homeTeam: `H${i}`,
    awayTeam: `A${i}`,
    eventUrl: `https://example.test/m${i}`,
    markets: [{ name: "1X2", selections: [{ name: "1", odds: 2 }, { name: "X", odds: 3 }, { name: "2", odds: 4 }] }],
    scrapedAt: new Date("2026-11-07T10:00:00.000Z"),
  })) as import("../../types/full-offer.js").FullMatchOffer[];
}

/** A ScrapeBudget ending at `deadline` (epoch ms) whose signal the test aborts through `controller`. */
export function fakeBudget(deadline: number): import("../../scrapers/shared/budget.js").ScrapeBudget & { controller: AbortController } {
  const controller = new AbortController();
  return {
    controller,
    signal: controller.signal,
    deadline,
    remainingMs: () => (controller.signal.aborted ? 0 : Math.max(0, deadline - Date.now())),
    checkpoint: () => {
      if (controller.signal.aborted) throw controller.signal.reason;
    },
  };
}
