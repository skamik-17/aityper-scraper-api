/**
 * Full Offer Repository
 * Handles database operations for normalized full offer markets
 * Uses scraped_markets table with market_key for cross-bookmaker comparison
 */

import { getSupabase } from "../config/database.js";
import type { PolishBookmaker } from "../config/index.js";
import type { ScrapedMarket, MarketSelection } from "../types/full-offer.js";
import type { NormalizedMarketType, NormalizedMarketGroup } from "../types/normalization.js";
import { getCanonicalTeamName, getNormalizedTeamName } from "../scrapers/team-matcher.js";

// Types for database inserts
interface ScrapedMarketInsert {
  match_id: string;
  league_slug: string;
  home_team: string;
  away_team: string;
  home_team_normalized: string;
  away_team_normalized: string;
  bookmaker: PolishBookmaker;
  external_id?: string;
  name: string;
  normalized_type: string;
  market_key?: string;
  param_value?: string;
  normalized_group: string;
  selections: MarketSelection[];
  event_url?: string;
  scraped_at: string;
}

// Types for comparison queries
export interface MarketComparisonEntry {
  market_key: string;
  normalized_type: string;
  normalized_group: string;
  param_value?: string;
  bookmaker: PolishBookmaker;
  market_name: string;
  selections: MarketSelection[];
  event_url?: string;
  scraped_at: string;
}

export interface FullOfferComparison {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  markets: Record<string, {
    type: NormalizedMarketType;
    group: NormalizedMarketGroup;
    name: string;
    paramValue?: string;
    bookmakerOdds: Record<PolishBookmaker, {
      selections: MarketSelection[];
      eventUrl?: string;
      scrapedAt: string;
    }>;
    bestOdds: Record<string, { bookmaker: PolishBookmaker; odds: number }>;
  }>;
}

/**
 * Generate a match ID from team names
 */
function generateMatchId(homeTeam: string, awayTeam: string, leagueSlug: string): string {
  const homeNorm = getNormalizedTeamName(homeTeam, leagueSlug);
  const awayNorm = getNormalizedTeamName(awayTeam, leagueSlug);
  return `${leagueSlug}:${homeNorm}:${awayNorm}`;
}

/**
 * Save full offer markets for a match from a specific bookmaker
 * Uses UPSERT to update existing records
 */
export async function saveFullOfferMarkets(
  homeTeam: string,
  awayTeam: string,
  bookmaker: PolishBookmaker,
  markets: ScrapedMarket[],
  leagueSlug: string = "ekstraklasa",
  eventUrl?: string
): Promise<{ inserted: number; errors: number }> {
  const supabase = getSupabase();
  const result = { inserted: 0, errors: 0 };

  if (markets.length === 0) {
    return result;
  }

  const matchId = generateMatchId(homeTeam, awayTeam, leagueSlug);
  const canonicalHome = getCanonicalTeamName(homeTeam, leagueSlug);
  const canonicalAway = getCanonicalTeamName(awayTeam, leagueSlug);
  const homeNorm = getNormalizedTeamName(homeTeam, leagueSlug);
  const awayNorm = getNormalizedTeamName(awayTeam, leagueSlug);
  const scrapedAt = new Date().toISOString();

  // Build insert records and deduplicate by name
  // (some bookmakers return duplicate market names)
  const recordsMap = new Map<string, ScrapedMarketInsert>();
  for (const market of markets) {
    const key = market.name; // Dedupe key: same market name = same market
    recordsMap.set(key, {
      match_id: matchId,
      league_slug: leagueSlug,
      home_team: canonicalHome,
      away_team: canonicalAway,
      home_team_normalized: homeNorm,
      away_team_normalized: awayNorm,
      bookmaker,
      external_id: undefined,
      name: market.name,
      normalized_type: market.normalizedType || "OTHER",
      market_key: market.marketKey,
      param_value: market.paramValue,
      normalized_group: market.normalizedGroup || "OTHER",
      selections: market.selections,
      event_url: eventUrl,
      scraped_at: scrapedAt,
    });
  }
  const records = Array.from(recordsMap.values());

  // Batch insert in chunks of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from("scraped_markets")
      .upsert(batch, {
        onConflict: "match_id,bookmaker,name,scraped_at",
        ignoreDuplicates: false, // Update if exists
      });

    if (error) {
      console.error(`[FullOfferRepo] Batch insert error:`, error);
      result.errors += batch.length;
    } else {
      result.inserted += batch.length;
    }
  }

  return result;
}

/**
 * Get full offer comparison for a match
 * Groups markets by market_key for cross-bookmaker comparison
 */
export async function getFullOfferByMatch(
  homeTeam: string,
  awayTeam: string,
  leagueSlug: string = "ekstraklasa"
): Promise<FullOfferComparison | null> {
  const supabase = getSupabase();
  const matchId = generateMatchId(homeTeam, awayTeam, leagueSlug);
  const canonicalHome = getCanonicalTeamName(homeTeam, leagueSlug);
  const canonicalAway = getCanonicalTeamName(awayTeam, leagueSlug);

  // Query comparable markets using the view
  const { data, error } = await supabase
    .from("market_comparison")
    .select("*")
    .eq("match_id", matchId)
    .order("normalized_group")
    .order("market_key");

  if (error) {
    console.error("[FullOfferRepo] Query error:", error);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  // Group by market_key
  const marketGroups = new Map<string, {
    type: NormalizedMarketType;
    group: NormalizedMarketGroup;
    name: string;
    paramValue?: string;
    bookmakerOdds: Record<PolishBookmaker, {
      selections: MarketSelection[];
      eventUrl?: string;
      scrapedAt: string;
    }>;
  }>();

  for (const row of data) {
    const marketKey = row.market_key;
    if (!marketKey) continue;

    if (!marketGroups.has(marketKey)) {
      marketGroups.set(marketKey, {
        type: row.normalized_type as NormalizedMarketType,
        group: row.normalized_group as NormalizedMarketGroup,
        name: row.market_name,
        paramValue: row.param_value ?? undefined,
        bookmakerOdds: {} as Record<PolishBookmaker, {
          selections: MarketSelection[];
          eventUrl?: string;
          scrapedAt: string;
        }>,
      });
    }

    const group = marketGroups.get(marketKey)!;
    group.bookmakerOdds[row.bookmaker as PolishBookmaker] = {
      selections: row.selections as MarketSelection[],
      eventUrl: row.event_url ?? undefined,
      scrapedAt: row.scraped_at,
    };
  }

  // Calculate best odds for each market
  const markets: FullOfferComparison["markets"] = {};
  for (const [marketKey, group] of marketGroups) {
    const bestOdds: Record<string, { bookmaker: PolishBookmaker; odds: number }> = {};

    // Find best odds per selection
    for (const [bookmaker, data] of Object.entries(group.bookmakerOdds)) {
      for (const selection of data.selections) {
        const selKey = selection.normalizedName || selection.name;
        if (!bestOdds[selKey] || selection.odds > bestOdds[selKey].odds) {
          bestOdds[selKey] = {
            bookmaker: bookmaker as PolishBookmaker,
            odds: selection.odds,
          };
        }
      }
    }

    markets[marketKey] = {
      ...group,
      bestOdds,
    };
  }

  return {
    matchId,
    homeTeam: canonicalHome,
    awayTeam: canonicalAway,
    markets,
  };
}

/**
 * Get markets grouped by type for a match
 */
export async function getMarketsByType(
  homeTeam: string,
  awayTeam: string,
  marketType: NormalizedMarketType,
  leagueSlug: string = "ekstraklasa"
): Promise<MarketComparisonEntry[]> {
  const supabase = getSupabase();
  const matchId = generateMatchId(homeTeam, awayTeam, leagueSlug);

  const { data, error } = await supabase
    .from("market_comparison")
    .select("*")
    .eq("match_id", matchId)
    .eq("normalized_type", marketType)
    .order("market_key");

  if (error) {
    console.error("[FullOfferRepo] Query by type error:", error);
    return [];
  }

  return (data || []).map((row) => ({
    market_key: row.market_key,
    normalized_type: row.normalized_type,
    normalized_group: row.normalized_group,
    param_value: row.param_value ?? undefined,
    bookmaker: row.bookmaker as PolishBookmaker,
    market_name: row.market_name,
    selections: row.selections as MarketSelection[],
    event_url: row.event_url ?? undefined,
    scraped_at: row.scraped_at,
  }));
}

/**
 * Delete old full offer data
 */
export async function deleteOldFullOfferData(
  olderThanHours: number = 24
): Promise<number> {
  const supabase = getSupabase();
  const cutoffDate = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

  const { count, error } = await supabase
    .from("scraped_markets")
    .delete({ count: "exact" })
    .lt("scraped_at", cutoffDate.toISOString());

  if (error) {
    console.error("[FullOfferRepo] Delete old data error:", error);
    return 0;
  }

  return count || 0;
}

/**
 * Get market counts per bookmaker for a match
 */
export async function getMarketCounts(
  homeTeam: string,
  awayTeam: string,
  leagueSlug: string = "ekstraklasa"
): Promise<Record<PolishBookmaker, number>> {
  const supabase = getSupabase();
  const matchId = generateMatchId(homeTeam, awayTeam, leagueSlug);

  const { data, error } = await supabase
    .from("latest_markets")
    .select("bookmaker")
    .eq("match_id", matchId);

  if (error) {
    console.error("[FullOfferRepo] Market count error:", error);
    return {} as Record<PolishBookmaker, number>;
  }

  const counts: Record<string, number> = {};
  for (const row of data || []) {
    counts[row.bookmaker] = (counts[row.bookmaker] || 0) + 1;
  }

  return counts as Record<PolishBookmaker, number>;
}

/**
 * Get available bookmakers for a match
 */
export async function getAvailableBookmakers(
  homeTeam: string,
  awayTeam: string,
  leagueSlug: string = "ekstraklasa"
): Promise<PolishBookmaker[]> {
  const counts = await getMarketCounts(homeTeam, awayTeam, leagueSlug);
  return Object.keys(counts) as PolishBookmaker[];
}
