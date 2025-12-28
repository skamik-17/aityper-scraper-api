/**
 * Supabase Database Types
 * Generated from database schema
 */

import type { PolishBookmaker } from "../config/index.js";

export interface Database {
  public: {
    Tables: {
      scraped_odds: {
        Row: {
          id: string;
          league_slug: string;
          home_team: string;
          away_team: string;
          home_team_normalized: string;
          away_team_normalized: string;
          bookmaker: PolishBookmaker;
          home_odds: number;
          draw_odds: number;
          away_odds: number;
          has_no_tax_promo: boolean;
          promo_details: string | null;
          event_name: string | null;
          event_url: string | null;
          scraped_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          league_slug?: string;
          home_team: string;
          away_team: string;
          home_team_normalized: string;
          away_team_normalized: string;
          bookmaker: PolishBookmaker;
          home_odds: number;
          draw_odds: number;
          away_odds: number;
          has_no_tax_promo?: boolean;
          promo_details?: string | null;
          event_name?: string | null;
          event_url?: string | null;
          scraped_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          league_slug?: string;
          home_team?: string;
          away_team?: string;
          home_team_normalized?: string;
          away_team_normalized?: string;
          bookmaker?: PolishBookmaker;
          home_odds?: number;
          draw_odds?: number;
          away_odds?: number;
          has_no_tax_promo?: boolean;
          promo_details?: string | null;
          event_name?: string | null;
          event_url?: string | null;
          scraped_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      scraper_runs: {
        Row: {
          id: string;
          run_id: string;
          league_slug: string;
          bookmaker: PolishBookmaker;
          status: string;
          matches_found: number;
          error_message: string | null;
          started_at: string;
          completed_at: string;
          duration_ms: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          run_id: string;
          league_slug: string;
          bookmaker: PolishBookmaker;
          status: string;
          matches_found?: number;
          error_message?: string | null;
          started_at: string;
          completed_at: string;
          duration_ms: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          run_id?: string;
          league_slug?: string;
          bookmaker?: PolishBookmaker;
          status?: string;
          matches_found?: number;
          error_message?: string | null;
          started_at?: string;
          completed_at?: string;
          duration_ms?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      odds_double_chance: {
        Row: {
          id: string;
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
          created_at: string;
        };
        Insert: {
          id?: string;
          league_slug?: string;
          home_team: string;
          away_team: string;
          home_team_normalized: string;
          away_team_normalized: string;
          bookmaker: PolishBookmaker;
          home_or_draw?: number | null;
          draw_or_away?: number | null;
          home_or_away?: number | null;
          event_url?: string | null;
          scraped_at: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["odds_double_chance"]["Insert"]>;
        Relationships: [];
      };
      odds_over_under: {
        Row: {
          id: string;
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
          created_at: string;
        };
        Insert: {
          id?: string;
          league_slug?: string;
          home_team: string;
          away_team: string;
          home_team_normalized: string;
          away_team_normalized: string;
          bookmaker: PolishBookmaker;
          line: number;
          over_odds?: number | null;
          under_odds?: number | null;
          event_url?: string | null;
          scraped_at: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["odds_over_under"]["Insert"]>;
        Relationships: [];
      };
      odds_btts: {
        Row: {
          id: string;
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
          created_at: string;
        };
        Insert: {
          id?: string;
          league_slug?: string;
          home_team: string;
          away_team: string;
          home_team_normalized: string;
          away_team_normalized: string;
          bookmaker: PolishBookmaker;
          yes_odds?: number | null;
          no_odds?: number | null;
          event_url?: string | null;
          scraped_at: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["odds_btts"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      latest_odds: {
        Row: {
          id: string;
          league_slug: string;
          home_team: string;
          away_team: string;
          home_team_normalized: string;
          away_team_normalized: string;
          bookmaker: PolishBookmaker;
          home_odds: number;
          draw_odds: number;
          away_odds: number;
          has_no_tax_promo: boolean;
          promo_details: string | null;
          event_name: string | null;
          event_url: string | null;
          scraped_at: string;
        };
        Relationships: [];
      };
      latest_double_chance: {
        Row: {
          id: string;
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
        };
        Relationships: [];
      };
      latest_over_under: {
        Row: {
          id: string;
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
        };
        Relationships: [];
      };
      latest_btts: {
        Row: {
          id: string;
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
        };
        Relationships: [];
      };
    };
    Functions: {
      cleanup_old_odds: {
        Args: Record<string, never>;
        Returns: void;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// Helper types for API responses
export interface OddsEntry {
  bookmaker: PolishBookmaker;
  homeOdds: number;
  drawOdds: number;
  awayOdds: number;
  hasNoTaxPromo: boolean;
  promoDetails: string | null;
  eventUrl: string | null;
  scrapedAt: string;
}

export interface BestOdds {
  home: { bookmaker: PolishBookmaker; odds: number };
  draw: { bookmaker: PolishBookmaker; odds: number };
  away: { bookmaker: PolishBookmaker; odds: number };
}

export interface MatchOdds {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamNormalized: string;
  awayTeamNormalized: string;
  odds: OddsEntry[];
  bestOdds: BestOdds;
}

export type BookmakerStatus = "available" | "error" | "stale";

// Extended market types
export type DoubleChanceRow = Database["public"]["Views"]["latest_double_chance"]["Row"];
export type OverUnderRow = Database["public"]["Views"]["latest_over_under"]["Row"];
export type BTTSRow = Database["public"]["Views"]["latest_btts"]["Row"];
