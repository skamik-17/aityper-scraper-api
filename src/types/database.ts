import type { PolishBookmaker } from "../config/index.js";
import type {
  MarketCategory,
  ViewType,
  ParameterType,
  NormalizedMarketType,
  NormalizedSelection,
} from "../services/normalization/types.js";

export type {
  MarketCategory,
  ViewType,
  ParameterType,
};

export interface MarketSelectionJson {
  name: string;
  odds: number;
  normalizedName?: NormalizedSelection;
}

// ============================================================================
// SERVICE LAYER TYPES (Not directly in DB schema but used in repositories/services)
// ============================================================================

// "error": the bookmaker's latest run failed. Same union as the frontend's BookmakerStatus.
export type BookmakerStatus = "available" | "stale" | "error";

export interface MatchOdds {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  leagueSlug: string;
  startTime?: string;
  markets: Record<string, MarketOdds>;
}

export interface MarketOdds {
  code: NormalizedMarketType;
  namePl: string;
  viewType: ViewType;
  category: MarketCategory;
  paramValue: string | null;
  bookmakerOdds: Record<string, BookmakerOddsData>;
  bestOdds: BestOdds;
}

export interface BookmakerOddsData {
  selections: MarketSelectionJson[];
  eventUrl?: string;
  scrapedAt: string;
  /** Older than staleAfterMs (plan 09 Task 8); absent when fresh. */
  stale?: true;
}

export type BestOdds = Record<string, {
  bookmaker: PolishBookmaker;
  odds: number;
}>;

export type LatestOddsRow = Database["public"]["Views"]["latest_odds"]["Row"];

export type OddsInsert = Database["public"]["Tables"]["odds"]["Insert"];

export type OddsEntry = LatestOddsRow;

export interface Database {
  public: {
    Tables: {
      market_types: {
        Row: {
          id: number;
          code: NormalizedMarketType;
          name_pl: string;
          name_en: string;
          description_pl: string;
          description_en: string;
          view_type: ViewType;
          category: MarketCategory;
          has_parameter: boolean;
          param_type: ParameterType | null;
          selections: NormalizedSelection[];
          display_order: number;
          created_at: string;
        };
        Insert: {
          id: number;
          code: NormalizedMarketType;
          name_pl: string;
          name_en: string;
          description_pl: string;
          description_en: string;
          view_type: ViewType;
          category: MarketCategory;
          has_parameter: boolean;
          param_type: ParameterType | null;
          selections: NormalizedSelection[];
          display_order: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["market_types"]["Insert"]>;
        Relationships: [];
      };
      odds: {
        Row: {
          id: number;
          match_id: string;
          league_slug: string;
          home_team: string;
          away_team: string;
          bookmaker: PolishBookmaker;
          event_url: string | null;
          market_type_id: number;
          market_key: string;
          param_value: string | null;
          selections: MarketSelectionJson[];
          scraped_at: string;
        };
        Insert: {
          id?: number;
          match_id: string;
          league_slug: string;
          home_team: string;
          away_team: string;
          bookmaker: PolishBookmaker;
          event_url?: string | null;
          market_type_id: number;
          market_key: string;
          param_value?: string | null;
          selections: MarketSelectionJson[];
          scraped_at: string;
        };
        Update: Partial<Database["public"]["Tables"]["odds"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "odds_market_type_id_fkey";
            columns: ["market_type_id"];
            referencedRelation: "market_types";
            referencedColumns: ["id"];
          }
        ];
      };
      /** Snapshot model (migration 13): one row per (match, bookmaker); detail state from migration 16. */
      odds_snapshot: {
        Row: {
          match_id: string;
          bookmaker: PolishBookmaker;
          league_slug: string;
          event_url: string | null;
          start_time: string | null;
          last_run_id: string | null;
          last_seen_at: string;
          last_changed_at: string;
          row_count: number;
          status: "ok" | "degenerate";
          degenerate_since: string | null;
          /** Migration 16: when the detail behind this snapshot was last fetched; null = never stamped. */
          last_detail_at: string | null;
          /** Migration 16: listing-price fingerprint at that fetch. */
          listing_fingerprint: string | null;
        };
        Insert: {
          match_id: string;
          bookmaker: PolishBookmaker;
          league_slug: string;
          event_url?: string | null;
          start_time?: string | null;
          last_run_id?: string | null;
          last_seen_at: string;
          last_changed_at: string;
          row_count: number;
          status?: "ok" | "degenerate";
          degenerate_since?: string | null;
          last_detail_at?: string | null;
          listing_fingerprint?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["odds_snapshot"]["Insert"]>;
        Relationships: [];
      };
      scraper_runs: {
        Row: {
          id: number;
          // Migration 11: null on rows written before it
          run_id: string | null;
          bookmaker: string;
          league_slug: string;
          started_at: string;
          finished_at: string | null;
          status: string;
          matches_found: number;
          markets_found: number | null;
          markets_saved: number;
          error_message: string | null;
          duration_ms: number | null;
        };
        Insert: {
          id?: number;
          run_id?: string | null;
          bookmaker: string;
          league_slug: string;
          started_at?: string;
          finished_at?: string | null;
          status?: string;
          matches_found?: number;
          markets_found?: number | null;
          markets_saved?: number;
          error_message?: string | null;
          duration_ms?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["scraper_runs"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      latest_odds: {
        Row: {
          id: number;
          match_id: string;
          league_slug: string;
          home_team: string;
          away_team: string;
          bookmaker: PolishBookmaker;
          event_url: string | null;
          market_type_id: number;
          market_key: string;
          param_value: string | null;
          selections: MarketSelectionJson[];
          scraped_at: string;
          market_code: NormalizedMarketType;
          market_name_pl: string;
          market_name_en: string;
          view_type: ViewType;
          category: MarketCategory;
          has_parameter: boolean;
          expected_selections: NormalizedSelection[];
          /** Snapshot model (migration 14): when this quote's content last changed. */
          changed_at?: string;
          /** Snapshot model (migration 14): "degenerate" while the prune guard keeps an older snapshot. */
          snapshot_status?: "ok" | "degenerate";
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
          market_type_id: number;
          market_code: NormalizedMarketType;
          market_name_pl: string;
          market_name_en: string;
          view_type: ViewType;
          category: MarketCategory;
          param_value: string | null;
          bookmaker: PolishBookmaker;
          selections: MarketSelectionJson[];
          event_url: string | null;
          scraped_at: string;
        };
        Relationships: [];
      };
      matches_with_odds: {
        Row: {
          match_id: string;
          league_slug: string;
          home_team: string;
          away_team: string;
          bookmaker_count: number;
          market_count: number;
          last_updated: string;
          bookmakers: PolishBookmaker[];
        };
        Relationships: [];
      };
    };
    Functions: {
      get_best_odds: {
        Args: { p_match_id: string; p_market_key: string };
        Returns: {
          selection_name: NormalizedSelection;
          best_odds: number;
          bookmaker: string;
          all_odds: unknown;
        }[];
      };
      cleanup_old_odds: {
        Args: { hours_to_keep?: number };
        Returns: number;
      };
      /** Migration 16: stamp fetched events and confirm unchanged ones after an incremental pass. */
      record_incremental_pass: {
        Args: {
          p_run_id: string;
          p_bookmaker: string;
          p_fetched: Array<{ match_id: string; fingerprint: string | null }>;
          p_confirmed: Array<{ match_id: string; fingerprint: string | null }>;
          p_cap_near?: string;
          p_cap_far?: string;
        };
        Returns: { stamped: number; confirmed: number; not_confirmed: number; confirmed_rows: number };
      };
    };
    Enums: {
      view_type: ViewType;
      parameter_type: ParameterType;
      market_category: MarketCategory;
    };
    CompositeTypes: Record<string, never>;
  };
}