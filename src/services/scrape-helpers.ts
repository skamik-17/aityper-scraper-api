import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import type { PolishBookmaker } from "../config/index.js";
import type { FullMatchOffer, ScrapedMarket } from "../types/full-offer.js";
import { normalizeMarketsForBookmaker } from "./normalization/index.js";
import { formatUnmappedSummary, summarizeUnmappedMarkets } from "./normalization/unmapped-summary.js";
import { saveFullOfferMarkets, saveBatchFullOfferMarkets } from "../repositories/full-offer-repository.js";

export interface NormalizeAndSaveResult {
  matchesProcessed: number;
  marketsNormalized: number;
  marketsSaved: number;
  errors: string[];
  /** Matches whose prune the degenerate-write guard skipped; set only when > 0. */
  pruneSkipped?: number;
}

export async function normalizeAndSaveMatches(
  matches: FullMatchOffer[],
  bookmaker: PolishBookmaker,
  league: string,
  options: { useBatchInsert?: boolean; runId?: string } = {}
): Promise<NormalizeAndSaveResult> {
  const result: NormalizeAndSaveResult = {
    matchesProcessed: 0,
    marketsNormalized: 0,
    marketsSaved: 0,
    errors: [],
  };

  if (matches.length === 0) {
    return result;
  }

  const normalizedMatches: FullMatchOffer[] = [];

  for (const match of matches) {
    // Normalization is synchronous CPU work shared with every other scraper's
    // I/O; let ready callbacks (e.g. a gRPC read timer) run between matches.
    await yieldToEventLoop();
    try {
      match.markets = normalizeMarketsForBookmaker(
        match.markets,
        bookmaker,
        match.homeTeam,
        match.awayTeam,
        league
      );
      result.matchesProcessed++;
      result.marketsNormalized += match.markets.length;
      normalizedMatches.push(match);
    } catch (error) {
      const errorMsg = `Normalization failed for ${match.homeTeam} vs ${match.awayTeam}: ${error instanceof Error ? error.message : "Unknown error"}`;
      console.error(`[ScrapeHelpers] ${errorMsg}`);
      result.errors.push(errorMsg);
    }
  }

  // One roll-up line per call (the aggregator calls this once per bookmaker
  // per run), so renamed raw ids stand out from the per-market OTHER warnings.
  const unmapped = summarizeUnmappedMarkets(normalizedMatches.flatMap((match) => match.markets));
  if (unmapped.otherMarkets > 0) {
    console.warn(formatUnmappedSummary(bookmaker, unmapped));
  }

  if (options.useBatchInsert && normalizedMatches.length > 0) {
    try {
      // The run id lands in odds_snapshot.last_run_id / odds_history.run_id (= scraper_runs.run_id)
      const batchResult = await saveBatchFullOfferMarkets(normalizedMatches, bookmaker, league, { runId: options.runId });
      result.marketsSaved = batchResult.inserted;
      if (batchResult.failedBatches > 0) {
        result.errors.push(
          `Batch insert failed (${batchResult.failedBatches} of ${batchResult.totalBatches} batches): ${batchResult.firstError}`
        );
      }
      // A kept snapshot is a cause, not a failure: with markets saved the run is partial
      const skipped = batchResult.pruneSkipped ?? [];
      if (skipped.length > 0) {
        const first = skipped[0];
        result.errors.push(
          `Prune skipped (degenerate write) for ${skipped.length} of ${batchResult.matchesProcessed} matches: ${first.match_id} ${first.new_rows}/${first.previous_rows} rows`
        );
        result.pruneSkipped = skipped.length;
      }
    } catch (error) {
      const errorMsg = `Batch save failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      console.error(`[ScrapeHelpers] ${errorMsg}`);
      result.errors.push(errorMsg);
    }
  } else {
    for (const match of normalizedMatches) {
      try {
        const saveResult = await saveFullOfferMarkets(
          match.homeTeam,
          match.awayTeam,
          bookmaker,
          match.markets,
          league,
          match.eventUrl,
          match.startTime
        );
        result.marketsSaved += saveResult.inserted;
      } catch (error) {
        const errorMsg = `Save failed for ${match.homeTeam} vs ${match.awayTeam}: ${error instanceof Error ? error.message : "Unknown error"}`;
        console.error(`[ScrapeHelpers] ${errorMsg}`);
        result.errors.push(errorMsg);
      }
    }
  }

  return result;
}

export async function normalizeMatchMarkets(
  match: FullMatchOffer,
  bookmaker: PolishBookmaker
): Promise<ScrapedMarket[]> {
  return normalizeMarketsForBookmaker(
    match.markets,
    bookmaker,
    match.homeTeam,
    match.awayTeam
  );
}

export function logScrapeProgress(
  bookmaker: PolishBookmaker,
  league: string,
  matchIndex: number,
  totalMatches: number,
  homeTeam: string,
  awayTeam: string,
  marketsCount: number
): void {
  const progress = Math.round((matchIndex / totalMatches) * 100);
  console.log(
    `[${bookmaker}/${league}] [${progress}%] ${homeTeam} vs ${awayTeam}: ${marketsCount} markets`
  );
}

export function createMatchKey(homeTeam: string, awayTeam: string, league: string): string {
  const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, "-");
  return `${league}:${normalize(homeTeam)}:${normalize(awayTeam)}`;
}
