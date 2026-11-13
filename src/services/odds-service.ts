import type { PolishBookmaker } from "../config/index.js";
import { CONFIG } from "../config/index.js";
import {
  getAggregatedOdds,
  getMatchOdds,
} from "../repositories/odds-repository.js";
import { getBookmakerStatusSnapshot, type BookmakerHealthMeta } from "./bookmaker-status.js";
import type { MatchOdds, OddsEntry, BestOdds, BookmakerStatus, LatestOddsRow, MarketSelectionJson, ViewType, MarketCategory } from "../types/database.js";
import type { NormalizedMarketType } from "../types/normalization.js";
import { updateBestOdds } from "../utils/market-aggregation.js";

export async function getAllLatestOdds(
  leagueSlug: string = "ekstraklasa",
  options: { onlyMarketKeys?: string[] } = {}
): Promise<{
  matches: MatchOdds[];
  /** Finish time of this league's newest OK run. */
  lastUpdated: string | null;
  bookmakerStatus: Record<PolishBookmaker, BookmakerStatus>;
  bookmakerHealth: Record<PolishBookmaker, BookmakerHealthMeta>;
}> {
  const { onlyMarketKeys } = options;
  // Pruned inside get_matches_with_odds() itself (migration 10) - Postgres
  // never builds the JSON for a market this call doesn't want, instead of
  // building everything and having the loop below throw most of it away.
  // The snapshot never throws: it degrades to odds freshness or all-stale itself.
  const [aggregatedData, snapshot] = await Promise.all([
    getAggregatedOdds(leagueSlug, onlyMarketKeys),
    getBookmakerStatusSnapshot(leagueSlug),
  ]);

  const matches: MatchOdds[] = aggregatedData.map((row) => {
    const markets: MatchOdds["markets"] = {};

    for (const [marketKey, marketData] of Object.entries(row.markets || {})) {
      // Belt-and-suspenders: the SQL layer already filters to
      // onlyMarketKeys, so this is normally a no-op, but keeps this
      // function correct on its own if the RPC signature ever drifts.
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
  }).filter((m) => {
    // Layer 1 (scraper/matcher guards) only protects future writes - the
    // database can already hold a degenerate row from before those guards
    // existed, or from a bookmaker/league this deploy hasn't scraped since.
    // This is the last place that owns the response contract, so it must
    // refuse to publish a match no real fixture could ever be. Logged at
    // error, not warn: a suppressed match here means a scraper defect
    // reached the database, which must stay visible, not silently vanish.
    if (m.homeTeam === m.awayTeam) {
      console.error(
        `[OddsService] Suppressing degenerate match ${m.matchId} (${leagueSlug}): ` +
          `homeTeam === awayTeam ("${m.homeTeam}")`
      );
      return false;
    }
    return true;
  });

  return {
    matches,
    lastUpdated: snapshot.lastSuccessfulRunAt,
    bookmakerStatus: snapshot.status,
    bookmakerHealth: snapshot.health,
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

  // Same guard as getAllLatestOdds: refuse to publish a degenerate row.
  // This route resolves by team name rather than matchId, so it reaches a
  // different DB read (getMatchOdds) than the by-id route above - both
  // paths into the same bad data need their own check.
  if (firstRow.home_team === firstRow.away_team) {
    console.error(
      `[OddsService] Suppressing degenerate match ${firstRow.match_id} (${leagueSlug}): ` +
        `homeTeam === awayTeam ("${firstRow.home_team}")`
    );
    return null;
  }

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

export function getNextUpdateTime(): string {
  const now = new Date();
  const intervalMs = CONFIG.SCRAPE_INTERVAL_MINUTES * 60 * 1000;
  const nextUpdate = new Date(
    Math.ceil(now.getTime() / intervalMs) * intervalMs
  );
  return nextUpdate.toISOString();
}
