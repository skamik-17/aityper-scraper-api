import type { PolishBookmaker } from "../config/index.js";
import type { FullMatchOffer, ScrapedMarket } from "../types/full-offer.js";
import { normalizeMarketsForBookmaker } from "./normalization/index.js";
import { saveFullOfferMarkets, saveBatchFullOfferMarkets } from "../repositories/full-offer-repository.js";

export interface NormalizeAndSaveResult {
  matchesProcessed: number;
  marketsNormalized: number;
  marketsSaved: number;
  errors: string[];
}

export async function normalizeAndSaveMatches(
  matches: FullMatchOffer[],
  bookmaker: PolishBookmaker,
  league: string,
  options: { useBatchInsert?: boolean } = {}
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

  if (options.useBatchInsert && normalizedMatches.length > 0) {
    try {
      const batchResult = await saveBatchFullOfferMarkets(normalizedMatches, bookmaker, league);
      result.marketsSaved = batchResult.inserted;
      if (batchResult.errors > 0) {
        result.errors.push(`Batch insert had ${batchResult.errors} errors`);
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
