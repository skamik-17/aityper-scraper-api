/**
 * Extended Odds Repository
 * Handles database operations for Double Chance, Over/Under, and BTTS markets
 */

import { getSupabase } from "../config/database.js";
import type { PolishBookmaker } from "../config/index.js";
import type { RawScrapedMatchOdds } from "../types/scraper.js";
import type { OverUnderLine } from "../types/markets.js";
import { getCanonicalTeamName, getNormalizedTeamName } from "../scrapers/team-matcher.js";

// Type definitions for extended market rows
interface DoubleChanceInsert {
  league_slug: string;
  home_team: string;
  away_team: string;
  home_team_normalized: string;
  away_team_normalized: string;
  bookmaker: PolishBookmaker;
  home_or_draw: number | null;
  draw_or_away: number | null;
  home_or_away: number | null;
  event_url: string | null;
  scraped_at: string;
}

interface OverUnderInsert {
  league_slug: string;
  home_team: string;
  away_team: string;
  home_team_normalized: string;
  away_team_normalized: string;
  bookmaker: PolishBookmaker;
  line: number;
  over_odds: number | null;
  under_odds: number | null;
  event_url: string | null;
  scraped_at: string;
}

interface BTTSInsert {
  league_slug: string;
  home_team: string;
  away_team: string;
  home_team_normalized: string;
  away_team_normalized: string;
  bookmaker: PolishBookmaker;
  yes_odds: number | null;
  no_odds: number | null;
  event_url: string | null;
  scraped_at: string;
}

/**
 * Insert extended market odds from a match detail scrape
 */
export async function insertExtendedMarketOdds(
  matchOdds: RawScrapedMatchOdds,
  leagueSlug: string = "ekstraklasa"
): Promise<{ doubleChance: boolean; overUnder: number; btts: boolean }> {
  const supabase = getSupabase();
  const result = { doubleChance: false, overUnder: 0, btts: false };

  const homeTeam = getCanonicalTeamName(matchOdds.homeTeam, leagueSlug);
  const awayTeam = getCanonicalTeamName(matchOdds.awayTeam, leagueSlug);
  const homeNorm = getNormalizedTeamName(matchOdds.homeTeam, leagueSlug);
  const awayNorm = getNormalizedTeamName(matchOdds.awayTeam, leagueSlug);
  const scrapedAt = matchOdds.scrapedAt.toISOString();

  // Insert Double Chance if available
  if (matchOdds.marketDoubleChance) {
    const dcRecord: DoubleChanceInsert = {
      league_slug: leagueSlug,
      home_team: homeTeam,
      away_team: awayTeam,
      home_team_normalized: homeNorm,
      away_team_normalized: awayNorm,
      bookmaker: matchOdds.bookmaker,
      home_or_draw: matchOdds.marketDoubleChance.homeOrDraw || null,
      draw_or_away: matchOdds.marketDoubleChance.drawOrAway || null,
      home_or_away: matchOdds.marketDoubleChance.homeOrAway || null,
      event_url: matchOdds.eventUrl || null,
      scraped_at: scrapedAt,
    };

    const { error } = await supabase.from("odds_double_chance").upsert(dcRecord, {
      onConflict: "league_slug,home_team_normalized,away_team_normalized,bookmaker,scraped_at",
      ignoreDuplicates: true,
    });

    if (!error) {
      result.doubleChance = true;
    } else {
      console.error("[ExtendedOddsRepo] Double Chance insert error:", error);
    }
  }

  // Insert Over/Under for each line
  if (matchOdds.marketOverUnder) {
    const ouRecords: OverUnderInsert[] = [];

    for (const [lineStr, odds] of Object.entries(matchOdds.marketOverUnder)) {
      const line = parseFloat(lineStr);
      if (isNaN(line)) continue;

      ouRecords.push({
        league_slug: leagueSlug,
        home_team: homeTeam,
        away_team: awayTeam,
        home_team_normalized: homeNorm,
        away_team_normalized: awayNorm,
        bookmaker: matchOdds.bookmaker,
        line,
        over_odds: odds.over || null,
        under_odds: odds.under || null,
        event_url: matchOdds.eventUrl || null,
        scraped_at: scrapedAt,
      });
    }

    if (ouRecords.length > 0) {
      const { error } = await supabase.from("odds_over_under").upsert(ouRecords, {
        onConflict: "league_slug,home_team_normalized,away_team_normalized,bookmaker,line,scraped_at",
        ignoreDuplicates: true,
      });

      if (!error) {
        result.overUnder = ouRecords.length;
      } else {
        console.error("[ExtendedOddsRepo] Over/Under insert error:", error);
      }
    }
  }

  // Insert BTTS if available
  if (matchOdds.marketBTTS) {
    const bttsRecord: BTTSInsert = {
      league_slug: leagueSlug,
      home_team: homeTeam,
      away_team: awayTeam,
      home_team_normalized: homeNorm,
      away_team_normalized: awayNorm,
      bookmaker: matchOdds.bookmaker,
      yes_odds: matchOdds.marketBTTS.yes || null,
      no_odds: matchOdds.marketBTTS.no || null,
      event_url: matchOdds.eventUrl || null,
      scraped_at: scrapedAt,
    };

    const { error } = await supabase.from("odds_btts").upsert(bttsRecord, {
      onConflict: "league_slug,home_team_normalized,away_team_normalized,bookmaker,scraped_at",
      ignoreDuplicates: true,
    });

    if (!error) {
      result.btts = true;
    } else {
      console.error("[ExtendedOddsRepo] BTTS insert error:", error);
    }
  }

  return result;
}

/**
 * Get extended market odds for a specific match
 */
export async function getExtendedOddsForMatch(
  homeTeam: string,
  awayTeam: string,
  leagueSlug: string = "ekstraklasa"
) {
  const supabase = getSupabase();
  const homeNorm = getNormalizedTeamName(homeTeam, leagueSlug);
  const awayNorm = getNormalizedTeamName(awayTeam, leagueSlug);

  // Fetch all extended markets in parallel
  const [dcResult, ouResult, bttsResult] = await Promise.all([
    supabase
      .from("latest_double_chance")
      .select("*")
      .eq("league_slug", leagueSlug)
      .eq("home_team_normalized", homeNorm)
      .eq("away_team_normalized", awayNorm),

    supabase
      .from("latest_over_under")
      .select("*")
      .eq("league_slug", leagueSlug)
      .eq("home_team_normalized", homeNorm)
      .eq("away_team_normalized", awayNorm)
      .order("line"),

    supabase
      .from("latest_btts")
      .select("*")
      .eq("league_slug", leagueSlug)
      .eq("home_team_normalized", homeNorm)
      .eq("away_team_normalized", awayNorm),
  ]);

  return {
    doubleChance: dcResult.data || [],
    overUnder: ouResult.data || [],
    btts: bttsResult.data || [],
  };
}

/**
 * Get all extended market odds for a league (grouped by match)
 */
export async function getAllExtendedOdds(leagueSlug: string = "ekstraklasa") {
  const supabase = getSupabase();

  const [dcResult, ouResult, bttsResult] = await Promise.all([
    supabase
      .from("latest_double_chance")
      .select("*")
      .eq("league_slug", leagueSlug)
      .order("home_team_normalized"),

    supabase
      .from("latest_over_under")
      .select("*")
      .eq("league_slug", leagueSlug)
      .order("home_team_normalized"),

    supabase
      .from("latest_btts")
      .select("*")
      .eq("league_slug", leagueSlug)
      .order("home_team_normalized"),
  ]);

  return {
    doubleChance: dcResult.data || [],
    overUnder: ouResult.data || [],
    btts: bttsResult.data || [],
  };
}

/**
 * Get best odds for a specific market across all bookmakers
 */
export function findBestDoubleChanceOdds(
  odds: Array<{
    bookmaker: string;
    home_or_draw: number | null;
    draw_or_away: number | null;
    home_or_away: number | null;
  }>
) {
  const best = {
    homeOrDraw: { bookmaker: "" as PolishBookmaker, odds: 0 },
    drawOrAway: { bookmaker: "" as PolishBookmaker, odds: 0 },
    homeOrAway: { bookmaker: "" as PolishBookmaker, odds: 0 },
  };

  for (const o of odds) {
    if (o.home_or_draw && o.home_or_draw > best.homeOrDraw.odds) {
      best.homeOrDraw = { bookmaker: o.bookmaker as PolishBookmaker, odds: o.home_or_draw };
    }
    if (o.draw_or_away && o.draw_or_away > best.drawOrAway.odds) {
      best.drawOrAway = { bookmaker: o.bookmaker as PolishBookmaker, odds: o.draw_or_away };
    }
    if (o.home_or_away && o.home_or_away > best.homeOrAway.odds) {
      best.homeOrAway = { bookmaker: o.bookmaker as PolishBookmaker, odds: o.home_or_away };
    }
  }

  return best;
}

export function findBestOverUnderOdds(
  odds: Array<{
    bookmaker: string;
    line: number;
    over_odds: number | null;
    under_odds: number | null;
  }>
) {
  const bestByLine: Record<
    string,
    {
      over: { bookmaker: PolishBookmaker; odds: number };
      under: { bookmaker: PolishBookmaker; odds: number };
    }
  > = {};

  for (const o of odds) {
    const lineKey = o.line.toFixed(1);

    if (!bestByLine[lineKey]) {
      bestByLine[lineKey] = {
        over: { bookmaker: "" as PolishBookmaker, odds: 0 },
        under: { bookmaker: "" as PolishBookmaker, odds: 0 },
      };
    }

    if (o.over_odds && o.over_odds > bestByLine[lineKey].over.odds) {
      bestByLine[lineKey].over = { bookmaker: o.bookmaker as PolishBookmaker, odds: o.over_odds };
    }
    if (o.under_odds && o.under_odds > bestByLine[lineKey].under.odds) {
      bestByLine[lineKey].under = { bookmaker: o.bookmaker as PolishBookmaker, odds: o.under_odds };
    }
  }

  return bestByLine;
}

export function findBestBTTSOdds(
  odds: Array<{
    bookmaker: string;
    yes_odds: number | null;
    no_odds: number | null;
  }>
) {
  const best = {
    yes: { bookmaker: "" as PolishBookmaker, odds: 0 },
    no: { bookmaker: "" as PolishBookmaker, odds: 0 },
  };

  for (const o of odds) {
    if (o.yes_odds && o.yes_odds > best.yes.odds) {
      best.yes = { bookmaker: o.bookmaker as PolishBookmaker, odds: o.yes_odds };
    }
    if (o.no_odds && o.no_odds > best.no.odds) {
      best.no = { bookmaker: o.bookmaker as PolishBookmaker, odds: o.no_odds };
    }
  }

  return best;
}
