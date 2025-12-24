/**
 * Odds Repository
 * Handles all database operations for scraped odds
 */

import { getSupabase } from "../config/database.js";
import type { PolishBookmaker } from "../config/index.js";
import type { RawScrapedOdds } from "../types/scraper.js";
import { getCanonicalTeamName } from "../scrapers/normalizer.js";

// Normalize team name for storage
function normalizeForStorage(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Insert scraped odds into database
 */
export async function insertScrapedOdds(
  odds: RawScrapedOdds[],
  leagueSlug: string = "ekstraklasa"
): Promise<{ inserted: number; errors: number }> {
  const supabase = getSupabase();
  let inserted = 0;
  let errors = 0;

  // Prepare records for insert
  const records = odds.map((o) => ({
    league_slug: leagueSlug,
    home_team: o.homeTeam,
    away_team: o.awayTeam,
    home_team_normalized: normalizeForStorage(getCanonicalTeamName(o.homeTeam)),
    away_team_normalized: normalizeForStorage(getCanonicalTeamName(o.awayTeam)),
    bookmaker: o.bookmaker,
    home_odds: o.homeOdds,
    draw_odds: o.drawOdds,
    away_odds: o.awayOdds,
    has_no_tax_promo: o.hasNoTaxPromo,
    promo_details: o.promoDetails || null,
    event_name: o.eventName,
    event_url: o.eventUrl || null,
    scraped_at: o.scrapedAt.toISOString(),
  }));

  // Insert in batches to avoid timeout
  const batchSize = 50;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    const { error } = await supabase.from("scraped_odds").upsert(batch, {
      onConflict: "league_slug,home_team_normalized,away_team_normalized,bookmaker,scraped_at",
      ignoreDuplicates: true,
    });

    if (error) {
      console.error("[OddsRepository] Insert error:", error);
      errors += batch.length;
    } else {
      inserted += batch.length;
    }
  }

  return { inserted, errors };
}

/**
 * Get latest odds for all matches
 */
export async function getLatestOdds(leagueSlug: string = "ekstraklasa") {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("latest_odds")
    .select("*")
    .eq("league_slug", leagueSlug)
    .order("home_team_normalized");

  if (error) {
    console.error("[OddsRepository] getLatestOdds error:", error);
    throw error;
  }

  return data || [];
}

/**
 * Get latest odds for a specific match
 */
export async function getMatchOdds(
  homeTeam: string,
  awayTeam: string,
  leagueSlug: string = "ekstraklasa"
) {
  const supabase = getSupabase();
  const homeNorm = normalizeForStorage(getCanonicalTeamName(homeTeam));
  const awayNorm = normalizeForStorage(getCanonicalTeamName(awayTeam));

  const { data, error } = await supabase
    .from("latest_odds")
    .select("*")
    .eq("league_slug", leagueSlug)
    .eq("home_team_normalized", homeNorm)
    .eq("away_team_normalized", awayNorm);

  if (error) {
    console.error("[OddsRepository] getMatchOdds error:", error);
    throw error;
  }

  return data || [];
}

/**
 * Get latest scrape timestamp for a bookmaker
 */
export async function getLastScrapeTime(
  bookmaker: PolishBookmaker,
  leagueSlug: string = "ekstraklasa"
): Promise<Date | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("scraped_odds")
    .select("scraped_at")
    .eq("league_slug", leagueSlug)
    .eq("bookmaker", bookmaker)
    .order("scraped_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return null;
  }

  return new Date(data[0].scraped_at);
}

/**
 * Get bookmaker status summary
 */
export async function getBookmakerStatus(leagueSlug: string = "ekstraklasa") {
  const supabase = getSupabase();

  // Get latest scrape for each bookmaker
  const { data, error } = await supabase
    .from("scraped_odds")
    .select("bookmaker, scraped_at")
    .eq("league_slug", leagueSlug)
    .order("scraped_at", { ascending: false });

  if (error) {
    console.error("[OddsRepository] getBookmakerStatus error:", error);
    throw error;
  }

  // Group by bookmaker and get latest
  const statusMap = new Map<PolishBookmaker, { lastScrape: Date; matchCount: number }>();
  const matchCounts = new Map<PolishBookmaker, number>();

  for (const row of data || []) {
    const bm = row.bookmaker as PolishBookmaker;
    if (!statusMap.has(bm)) {
      statusMap.set(bm, {
        lastScrape: new Date(row.scraped_at),
        matchCount: 0,
      });
    }
    matchCounts.set(bm, (matchCounts.get(bm) || 0) + 1);
  }

  // Update match counts
  for (const [bm, status] of statusMap) {
    status.matchCount = matchCounts.get(bm) || 0;
  }

  return statusMap;
}

/**
 * Clean up old odds data
 */
export async function cleanupOldOdds(): Promise<{ deleted: number }> {
  const supabase = getSupabase();

  // Use the cleanup function
  const { error } = await supabase.rpc("cleanup_old_odds");

  if (error) {
    console.error("[OddsRepository] cleanup error:", error);
    return { deleted: 0 };
  }

  return { deleted: -1 }; // -1 indicates success but count unknown
}
