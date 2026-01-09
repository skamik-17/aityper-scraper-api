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

export type BookmakerStatus = "stale" | "available";

export interface MatchOdds {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  leagueSlug: string;
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
      scraper_runs: {
        Row: {
          id: number;
          bookmaker: string;
          league_slug: string;
          started_at: string;
          finished_at: string | null;
          status: string;
          matches_found: number;
          markets_saved: number;
          error_message: string | null;
          duration_ms: number | null;
        };
        Insert: {
          id?: number;
          bookmaker: string;
          league_slug: string;
          started_at?: string;
          finished_at?: string | null;
          status?: string;
          matches_found?: number;
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
    };
    Enums: {
      view_type: ViewType;
      parameter_type: ParameterType;
      market_category: MarketCategory;
    };
    CompositeTypes: Record<string, never>;
  };
}