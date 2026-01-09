import type { PolishBookmaker } from "../config/index.js";
import { CONFIG } from "../config/index.js";
import {
  getLatestOdds,
  getMatchOdds,
  getBookmakerStatus,
} from "../repositories/odds-repository.js";
import { getLastSuccessfulScrapeTime } from "../repositories/scraper-run-repository.js";
import type { MatchOdds, OddsEntry, BestOdds, BookmakerStatus, LatestOddsRow, MarketSelectionJson, ViewType, MarketCategory } from "../types/database.js";
import { updateBestOdds } from "../utils/market-aggregation.js";

export async function getAllLatestOdds(leagueSlug: string = "ekstraklasa"): Promise<{
  matches: MatchOdds[];
  lastUpdated: string | null;
  bookmakerStatus: Record<PolishBookmaker, BookmakerStatus>;
}> {
  const oddsData = await getLatestOdds(leagueSlug);
  const lastScrape = await getLastSuccessfulScrapeTime();

  const matchMap = new Map<string, MatchOdds>();

  for (const row of oddsData) {
    const matchKey = row.match_id;

    if (!matchMap.has(matchKey)) {
      matchMap.set(matchKey, {
        matchId: matchKey,
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        leagueSlug: row.league_slug,
        markets: {},
      });
    }

    const match = matchMap.get(matchKey)!;
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

  const matches = Array.from(matchMap.values());
  const bookmakerStatus = await getBookmakerStatusMap(leagueSlug);

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
