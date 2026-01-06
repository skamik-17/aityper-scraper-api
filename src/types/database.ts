/**
 * Supabase Database Types
 * Generated from database schema
 */

import type { PolishBookmaker } from "../config/index.js";

// JSON type for market selections stored in database
export interface MarketSelectionJson {
  name: string;
  odds: number;
  normalizedName?: string;
}

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
      scraped_markets: {
        Row: {
          id: string;
          match_id: string;
          league_slug: string;
          home_team: string;
          away_team: string;
          home_team_normalized: string;
          away_team_normalized: string;
          bookmaker: PolishBookmaker;
          group_id: string | null;
          external_id: string | null;
          name: string;
          normalized_type: string;
          market_key: string | null;
          param_value: string | null;
          normalized_group: string;
          selections: MarketSelectionJson[];
          event_url: string | null;
          scraped_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          match_id: string;
          league_slug: string;
          home_team: string;
          away_team: string;
          home_team_normalized: string;
          away_team_normalized: string;
          bookmaker: PolishBookmaker;
          group_id?: string | null;
          external_id?: string | null;
          name: string;
          normalized_type: string;
          market_key?: string | null;
          param_value?: string | null;
          normalized_group?: string;
          selections: MarketSelectionJson[];
          event_url?: string | null;
          scraped_at: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["scraped_markets"]["Insert"]>;
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
      latest_markets: {
        Row: {
          id: string;
          match_id: string;
          league_slug: string;
          home_team: string;
          away_team: string;
          home_team_normalized: string;
          away_team_normalized: string;
          bookmaker: PolishBookmaker;
          group_id: string | null;
          external_id: string | null;
          name: string;
          normalized_type: string;
          market_key: string | null;
          param_value: string | null;
          normalized_group: string;
          selections: MarketSelectionJson[];
          event_url: string | null;
          scraped_at: string;
        };
        Relationships: [];
      };
      market_comparison: {
        Row: {
          match_id: string;
          league_slug: string;
          home_team: string;
          away_team: string;
          market_key: string;
          normalized_type: string;
          normalized_group: string;
          param_value: string | null;
          bookmaker: PolishBookmaker;
          market_name: string;
          selections: MarketSelectionJson[];
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
