/**
 * Which pass each bookmaker runs on a scheduler tick (plan 10), and the wrapper
 * that turns a scraper's `scrapeFullOffer` into that pass inside the aggregator.
 *
 * With INCREMENTAL_BOOKMAKERS empty nothing here changes a run: planTick gives the
 * hourly full run, and withScrapeMode returns the scraper itself.
 */
import type { PolishBookmaker } from "../../config/index.js";
import type { IncrementalConfig } from "../../config/incremental.js";
import { createScrapeBudget, type ScrapeBudget } from "../../scrapers/shared/budget.js";
import { isIncrementalScraper, transportTotals } from "../../scrapers/shared/incremental/incremental-scraper.js";
import {
  DEFAULT_MAX_DURATION_MS,
  hasTransportStats,
  type FullOfferScraper,
  type TransportStatsSource,
} from "../../scrapers/shared/scraper-contract.js";
import type { FullOfferScraperResult } from "../../types/full-offer.js";
import type { RunRequest } from "../run-coordinator.js";
import {
  dryRunLedger,
  finalizeIncrementalPass,
  runIncrementalPass,
  type DryRunLedger,
  type IncrementalPassDeps,
} from "./incremental-pass.js";

export type ScrapeMode = "full" | "incremental" | "plan-only";

export interface TickPlan {
  modes: Partial<Record<PolishBookmaker, ScrapeMode>>;
  /** === the full run is due: only this tick records outcomes. */
  hourly: boolean;
}

/**
 * A tick within half a pass of a full interval after the last full run counts as the full one,
 * so the hourly run lands at interval ± half a tick and never drifts later each hour.
 */
const fullDueSlackMs = (cfg: IncrementalConfig) => (cfg.passMinutes * 60_000) / 2;

export function planTick(i: {
  now: number;
  lastFullAt: number | null;
  fullIntervalMs: number;
  bookmakers: readonly PolishBookmaker[];
  cfg: IncrementalConfig;
}): TickPlan {
  const fullDue = i.lastFullAt === null || i.now - i.lastFullAt >= i.fullIntervalMs - fullDueSlackMs(i.cfg);
  const modes: Partial<Record<PolishBookmaker, ScrapeMode>> = {};
  for (const bm of i.bookmakers) {
    if (i.cfg.bookmakers.has(bm)) {
      if (!i.cfg.dryRun) modes[bm] = "incremental";
      else modes[bm] = fullDue ? "full" : "plan-only";
    } else if (fullDue) {
      modes[bm] = "full";
    }
  }
  return { modes, hourly: fullDue };
}

/** The interval scheduler's request for one tick; null when the tick has nothing to run. */
export function buildTickRequest(i: {
  now: number;
  lastFullAt: number | null;
  fullIntervalMs: number;
  leagues: readonly string[];
  bookmakers: readonly PolishBookmaker[];
  cfg: IncrementalConfig;
}): RunRequest | null {
  const plan = planTick(i);
  const bookmakers = Object.keys(plan.modes) as PolishBookmaker[];
  if (bookmakers.length === 0) return null;
  return { trigger: "interval", leagues: [...i.leagues], bookmakers, modes: plan.modes, recordOutcomes: plan.hourly };
}

const warnedNotCapable = new Set<PolishBookmaker>();

export interface ScrapeForRunContext {
  runId: string;
  budget: ScrapeBudget;
  cfg: IncrementalConfig;
  /** Test seams; production uses the defaults. */
  deps?: Partial<IncrementalPassDeps>;
  ledger?: DryRunLedger;
}

export async function scrapeForRun(
  bookmaker: PolishBookmaker,
  scraper: FullOfferScraper,
  league: string,
  mode: ScrapeMode,
  ctx: ScrapeForRunContext,
): Promise<FullOfferScraperResult> {
  const { runId, budget, cfg } = ctx;
  if (!isIncrementalScraper(scraper)) {
    if (mode !== "full" && !warnedNotCapable.has(bookmaker)) {
      warnedNotCapable.add(bookmaker);
      console.warn(`[Incremental] ${bookmaker} is not incremental-capable; running the full pass`);
    }
    return scraper.scrapeFullOffer(league, budget);
  }

  const passOpts = (m: "incremental" | "forced" | "plan-only") => ({ runId, budget, mode: m, ledger: ctx.ledger ?? dryRunLedger });
  const listed = cfg.bookmakers.has(bookmaker);

  if (mode === "full") {
    if (listed && !cfg.dryRun) return runIncrementalPass(scraper, league, passOpts("forced"), ctx.deps);

    const before = transportTotals(scraper.transportStats());
    const started = Date.now();
    const result = await scraper.scrapeFullOffer(league, budget);
    if (listed) {
      // Dry run: the full pass's cost is the baseline of the incremental report
      const after = transportTotals(scraper.transportStats());
      console.log(
        `[FullPassCost] ${JSON.stringify({
          runId,
          bookmaker,
          league,
          matches: result.matches.length,
          requests: after.requests - before.requests,
          bytes: after.bytes - before.bytes,
          durationMs: Date.now() - started,
          at: new Date(ctx.deps?.now?.() ?? Date.now()).toISOString(),
        })}`,
      );
      const plan = await runIncrementalPass(scraper, league, passOpts("plan-only"), ctx.deps);
      await finalizeIncrementalPass(plan, runId, ctx.deps);
    }
    return result;
  }

  if (mode === "incremental") return runIncrementalPass(scraper, league, passOpts("incremental"), ctx.deps);

  const plan = await runIncrementalPass(scraper, league, passOpts("plan-only"), ctx.deps);
  await finalizeIncrementalPass(plan, runId, ctx.deps);
  return plan;
}

/**
 * The scraper the aggregator runs for this unit. A full run of a bookmaker outside
 * INCREMENTAL_BOOKMAKERS (and any scraper without the contract) gets the scraper itself,
 * so today's path is unchanged by construction.
 */
export function withScrapeMode(
  bookmaker: PolishBookmaker,
  scraper: FullOfferScraper,
  mode: ScrapeMode,
  ctx: { runId: string; cfg: IncrementalConfig },
): FullOfferScraper {
  if (!isIncrementalScraper(scraper) && mode === "full") return scraper;
  if (mode === "full" && !ctx.cfg.bookmakers.has(bookmaker)) return scraper;

  const wrapped: FullOfferScraper & Partial<TransportStatsSource> & { transport?: unknown } = {
    bookmaker,
    scrapeFullOffer: (league: string, budget?: ScrapeBudget) =>
      scrapeForRun(bookmaker, scraper, league, mode, {
        ...ctx,
        budget: budget ?? createScrapeBudget(DEFAULT_MAX_DURATION_MS.http),
      }),
    cleanup: () => scraper.cleanup(),
  };
  // Plan 07's DeclaresTransport classification reads the picked instance; keep it identical
  const transport = (scraper as { transport?: unknown }).transport;
  if (transport !== undefined) wrapped.transport = transport;
  if (hasTransportStats(scraper)) wrapped.transportStats = () => scraper.transportStats();
  return wrapped;
}
