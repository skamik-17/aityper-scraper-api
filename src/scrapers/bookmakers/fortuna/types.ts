/**
 * Fortuna Internal Types
 *
 * Type definitions for Fortuna API responses.
 * These are bookmaker-specific types used internally by the scraper.
 */

/**
 * Participant (team) in a fixture
 */
export interface FortunaParticipant {
  /** Participant name (team name) */
  name: string;
  /** Participant type: HOME or AWAY */
  type: "HOME" | "AWAY";
}

/**
 * Single fixture (match) from Fortuna API
 */
export interface FortunaFixture {
  /** Unique fixture ID (format: "ufo:mtch:XX-XXX") */
  id: string;
  /** Match name (format: "HomeTeam - AwayTeam") */
  name: string;
  /** Tournament/competition ID */
  tournamentId: string;
  /** Home and away participants */
  participants: FortunaParticipant[];
  /** Match start datetime (Unix timestamp in milliseconds) */
  startDatetime: number;
  /** SEO-friendly name for URL construction */
  seoName: string;
}

/**
 * Individual outcome in a market
 */
export interface FortunaOutcome {
  /** Outcome code: "1" = home, "0" = draw, "2" = away, etc. */
  name: string;
  /** Display name: team name, "Remis", "Ponad 2.5", etc. */
  longName: string;
  /** Decimal odds value */
  odds: number;
  /** Specifiers for line markets (e.g., { total: "2.5" }) */
  specifiers?: Record<string, string>;
}

/**
 * Single market from Fortuna API
 */
export interface FortunaMarket {
  /** Unique market ID */
  id: string;
  /** Fixture ID this market belongs to */
  fixtureId: string;
  /** Market type ID (e.g., "ufo:mtyp:00-00" for 1X2) */
  marketTypeId: string;
  /** Market type display name */
  marketTypeName: string;
  /** Market name (often same as marketTypeName) */
  name: string;
  /** All outcomes for this market */
  outcomes: FortunaOutcome[];
  /** Specifiers for line markets */
  specifiers?: Record<string, string>;
}

/**
 * API response for fixtures list
 */
export interface FortunaFixturesResponse {
  /** Array of fixtures */
  fixtures: FortunaFixture[];
}

/**
 * API response for markets (overview or full)
 */
export type FortunaMarketsResponse = FortunaMarket[];

/**
 * Combined data structure for league scraping
 */
export interface FortunaLeagueData {
  /** All fixtures for the league */
  fixtures: FortunaFixture[];
  /** All markets for those fixtures */
  markets: FortunaMarket[];
}

/**
 * Parsed team names from fixture
 */
export interface ParsedTeams {
  homeTeam: string;
  awayTeam: string;
}

/**
 * Intermediate structure for grouped markets
 * Used during parsing before converting to ScrapedMarket
 */
export interface GroupedMarket {
  /** Market type ID from Fortuna */
  marketTypeId: string;
  /** Display name for the market */
  name: string;
  /** Group name for UI categorization */
  groupName: string;
  /** Normalized market type */
  type: string;
  /** Line value for O/U and handicap markets */
  line?: string;
  /** All selections for this market */
  selections: {
    name: string;
    odds: number;
    code: string;
  }[];
}
