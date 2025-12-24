/**
 * Odds Service
 * Business logic for odds data
 */

import type { PolishBookmaker } from "../config/index.js";
import { CONFIG } from "../config/index.js";
import {
  getLatestOdds,
  getMatchOdds,
  getBookmakerStatus,
} from "../repositories/odds-repository.js";
import { getLastSuccessfulScrapeTime } from "../repositories/scraper-run-repository.js";
import type { MatchOdds, OddsEntry, BestOdds, BookmakerStatus } from "../types/database.js";

interface OddsRow {
  id: string;
  league_slug: string;
  home_team: string;
  away_team: string;
  home_team_normalized: string;
  away_team_normalized: string;
  bookmaker: string;
  home_odds: number;
  draw_odds: number;
  away_odds: number;
  has_no_tax_promo: boolean;
  promo_details: string | null;
  event_name: string | null;
  event_url: string | null;
  scraped_at: string;
}

/**
 * Get all latest odds grouped by match
 */
export async function getAllLatestOdds(leagueSlug: string = "ekstraklasa"): Promise<{
  matches: MatchOdds[];
  lastUpdated: string | null;
  bookmakerStatus: Record<PolishBookmaker, BookmakerStatus>;
}> {
  const oddsData = await getLatestOdds(leagueSlug);
  const lastScrape = await getLastSuccessfulScrapeTime();

  // Group odds by match
  const matchMap = new Map<string, { match: Partial<MatchOdds>; odds: OddsEntry[] }>();

  for (const row of oddsData as OddsRow[]) {
    const matchKey = `${row.home_team_normalized}:${row.away_team_normalized}`;

    if (!matchMap.has(matchKey)) {
      matchMap.set(matchKey, {
        match: {
          id: matchKey.replace(/:/g, "-vs-"),
          homeTeam: row.home_team,
          awayTeam: row.away_team,
          homeTeamNormalized: row.home_team_normalized,
          awayTeamNormalized: row.away_team_normalized,
        },
        odds: [],
      });
    }

    matchMap.get(matchKey)!.odds.push({
      bookmaker: row.bookmaker as PolishBookmaker,
      homeOdds: row.home_odds,
      drawOdds: row.draw_odds,
      awayOdds: row.away_odds,
      hasNoTaxPromo: row.has_no_tax_promo,
      promoDetails: row.promo_details,
      eventUrl: row.event_url,
      scrapedAt: row.scraped_at,
    });
  }

  // Convert to MatchOdds array with best odds
  const matches: MatchOdds[] = [];

  for (const [, { match, odds }] of matchMap) {
    const bestOdds = calculateBestOdds(odds);
    matches.push({
      ...(match as MatchOdds),
      odds,
      bestOdds,
    });
  }

  // Determine bookmaker status
  const bookmakerStatus = await getBookmakerStatusMap(leagueSlug);

  return {
    matches,
    lastUpdated: lastScrape?.toISOString() || null,
    bookmakerStatus,
  };
}

/**
 * Get odds for a specific match
 */
export async function getOddsForMatch(
  homeTeam: string,
  awayTeam: string,
  leagueSlug: string = "ekstraklasa"
): Promise<MatchOdds | null> {
  const oddsData = await getMatchOdds(homeTeam, awayTeam, leagueSlug);

  if (oddsData.length === 0) {
    return null;
  }

  const firstRow = oddsData[0] as OddsRow;
  const odds: OddsEntry[] = oddsData.map((row: OddsRow) => ({
    bookmaker: row.bookmaker as PolishBookmaker,
    homeOdds: row.home_odds,
    drawOdds: row.draw_odds,
    awayOdds: row.away_odds,
    hasNoTaxPromo: row.has_no_tax_promo,
    promoDetails: row.promo_details,
    eventUrl: row.event_url,
    scrapedAt: row.scraped_at,
  }));

  const bestOdds = calculateBestOdds(odds);

  return {
    id: `${firstRow.home_team_normalized}-vs-${firstRow.away_team_normalized}`,
    homeTeam: firstRow.home_team,
    awayTeam: firstRow.away_team,
    homeTeamNormalized: firstRow.home_team_normalized,
    awayTeamNormalized: firstRow.away_team_normalized,
    odds,
    bestOdds,
  };
}

/**
 * Calculate best odds for each outcome
 */
function calculateBestOdds(odds: OddsEntry[]): BestOdds {
  let bestHome: { bookmaker: PolishBookmaker; odds: number } = {
    bookmaker: "sts",
    odds: 0,
  };
  let bestDraw: { bookmaker: PolishBookmaker; odds: number } = {
    bookmaker: "sts",
    odds: 0,
  };
  let bestAway: { bookmaker: PolishBookmaker; odds: number } = {
    bookmaker: "sts",
    odds: 0,
  };

  for (const entry of odds) {
    if (entry.homeOdds > bestHome.odds) {
      bestHome = { bookmaker: entry.bookmaker, odds: entry.homeOdds };
    }
    if (entry.drawOdds > bestDraw.odds) {
      bestDraw = { bookmaker: entry.bookmaker, odds: entry.drawOdds };
    }
    if (entry.awayOdds > bestAway.odds) {
      bestAway = { bookmaker: entry.bookmaker, odds: entry.awayOdds };
    }
  }

  return {
    home: bestHome,
    draw: bestDraw,
    away: bestAway,
  };
}

/**
 * Get bookmaker status map
 */
async function getBookmakerStatusMap(
  leagueSlug: string
): Promise<Record<PolishBookmaker, BookmakerStatus>> {
  const status: Record<PolishBookmaker, BookmakerStatus> = {} as Record<
    PolishBookmaker,
    BookmakerStatus
  >;
  const now = new Date();
  const staleThreshold = 60 * 60 * 1000; // 1 hour

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
    // If error, mark all as stale
    for (const bookmaker of CONFIG.BOOKMAKERS) {
      status[bookmaker] = "stale";
    }
  }

  return status;
}

/**
 * Calculate next update time
 */
export function getNextUpdateTime(): string {
  const now = new Date();
  const intervalMs = CONFIG.SCRAPE_INTERVAL_MINUTES * 60 * 1000;
  const nextUpdate = new Date(
    Math.ceil(now.getTime() / intervalMs) * intervalMs
  );
  return nextUpdate.toISOString();
}
