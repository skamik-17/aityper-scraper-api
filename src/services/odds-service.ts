import type { PolishBookmaker } from "../config/index.js";
import { CONFIG } from "../config/index.js";
import {
  getAggregatedOdds,
  getMatchOdds,
  getBookmakerStatus,
} from "../repositories/odds-repository.js";
import { getLastSuccessfulScrapeTime } from "../repositories/scraper-run-repository.js";
import type { MatchOdds, OddsEntry, BestOdds, BookmakerStatus, LatestOddsRow, MarketSelectionJson, ViewType, MarketCategory } from "../types/database.js";
import type { NormalizedMarketType } from "../types/normalization.js";
import { updateBestOdds } from "../utils/market-aggregation.js";

export async function getAllLatestOdds(
  leagueSlug: string = "ekstraklasa",
  options: { onlyMarketKeys?: string[] } = {}
): Promise<{
  matches: MatchOdds[];
  lastUpdated: string | null;
  bookmakerStatus: Record<PolishBookmaker, BookmakerStatus>;
}> {
  const aggregatedData = await getAggregatedOdds(leagueSlug);
  const lastScrape = await getLastSuccessfulScrapeTime();
  const bookmakerStatus = await getBookmakerStatusMap(leagueSlug);
  const { onlyMarketKeys } = options;

  const matches: MatchOdds[] = aggregatedData.map((row) => {
    const markets: MatchOdds["markets"] = {};

    for (const [marketKey, marketData] of Object.entries(row.markets || {})) {
      // Every current frontend consumer of this endpoint (verified by
      // grepping every `.markets[...]` access across the whole frontend
      // repo) only ever reads the MATCH_WINNER market - for the 1X2
      // indicator shown while browsing/searching matches. Everything else
      // (every parameter line, every player market, every OTHER-bucket
      // entry) was being fully built and shipped to the browser for
      // nothing: for a single Premier League match that's ~6800
      // (market x bookmaker) entries and several MB of JSON that gets
      // downloaded, parsed, and thrown away unread - repeated on every
      // poll. Callers that DO need full data (the single-match detail
      // page) go through a completely different endpoint
      // (/api/matches/:home/:away/normalized-markets) and never call this
      // function at all, so skipping unlisted markets here is safe.
      if (onlyMarketKeys && !onlyMarketKeys.includes(marketKey)) {
        continue;
      }

      const bestOdds: BestOdds = {};
      const bookmakerOdds: Record<string, { selections: any[]; eventUrl?: string; scrapedAt: string }> = {};

      for (const [bookmaker, oddsData] of Object.entries(marketData.bookmakerOdds || {})) {
        bookmakerOdds[bookmaker] = {
          selections: oddsData.selections,
          eventUrl: oddsData.eventUrl ?? undefined,
          scrapedAt: oddsData.scrapedAt,
        };
        updateBestOdds(bestOdds, bookmaker as PolishBookmaker, oddsData.selections);
      }

      markets[marketKey] = {
        code: marketData.code as NormalizedMarketType,
        namePl: marketData.namePl,
        viewType: marketData.viewType as ViewType,
        category: marketData.category as MarketCategory,
        paramValue: marketData.paramValue,
        bookmakerOdds,
        bestOdds,
      };
    }

    return {
      matchId: row.match_id,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      leagueSlug,
      startTime: row.start_time ?? undefined,
      markets,
    };
  });

  let lastUpdated: string | null = null;
  if (lastScrape && !isNaN(lastScrape.getTime())) {
    lastUpdated = lastScrape.toISOString();
  }

  return {
    matches,
    lastUpdated,
    bookmakerStatus,
  };
}

export async function getOddsForMatch(
  homeTeam: string,
  awayTeam: string,
  leagueSlug: string = "ekstraklasa"
): Promise<MatchOdds | null> {
  const oddsData = await getMatchOdds(homeTeam, awayTeam, leagueSlug);

  if (oddsData.length === 0) {
    return null;
  }

  const firstRow = oddsData[0];
  const match: MatchOdds = {
    matchId: firstRow.match_id,
    homeTeam: firstRow.home_team,
    awayTeam: firstRow.away_team,
    leagueSlug: firstRow.league_slug,
    markets: {},
  };

  for (const row of oddsData) {
    const marketKey = row.market_key;

    if (!match.markets[marketKey]) {
      match.markets[marketKey] = {
        code: row.market_code,
        namePl: row.market_name_pl,
        viewType: row.view_type,
        category: row.category,
        paramValue: row.param_value ?? null,
        bookmakerOdds: {},
        bestOdds: {},
      };
    }

    const market = match.markets[marketKey];
    market.bookmakerOdds[row.bookmaker] = {
      selections: row.selections,
      eventUrl: row.event_url ?? undefined,
      scrapedAt: row.scraped_at,
    };

    updateBestOdds(market.bestOdds, row.bookmaker, row.selections);
  }

  return match;
}

async function getBookmakerStatusMap(
  leagueSlug: string
): Promise<Record<PolishBookmaker, BookmakerStatus>> {
  const status: Record<PolishBookmaker, BookmakerStatus> = {} as Record<
    PolishBookmaker,
    BookmakerStatus
  >;
  const now = new Date();
  const staleThreshold = 60 * 60 * 1000;

  try {
    const statusMap = await getBookmakerStatus(leagueSlug);

    for (const bookmaker of CONFIG.BOOKMAKERS) {
      const bmStatus = statusMap.get(bookmaker);
      if (!bmStatus) {
        status[bookmaker] = "stale";
      } else {
        const age = now.getTime() - bmStatus.lastScrape.getTime();
        status[bookmaker] = age > staleThreshold ? "stale" : "available";
      }
    }
  } catch {
    for (const bookmaker of CONFIG.BOOKMAKERS) {
      status[bookmaker] = "stale";
    }
  }

  return status;
}

export function getNextUpdateTime(): string {
  const now = new Date();
  const intervalMs = CONFIG.SCRAPE_INTERVAL_MINUTES * 60 * 1000;
  const nextUpdate = new Date(
    Math.ceil(now.getTime() / intervalMs) * intervalMs
  );
  return nextUpdate.toISOString();
}
