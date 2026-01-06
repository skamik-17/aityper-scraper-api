/**
 * Betclic Internal Types
 *
 * Type definitions for Betclic gRPC/protobuf responses.
 * These are bookmaker-specific types used internally by the scraper.
 */

/**
 * Parsed protobuf field value with type information
 */
export interface ProtobufFieldValue {
  type: "varint" | "bytes" | "float" | "double";
  data: number | Buffer;
}

/**
 * Parsed fields map from protobuf message
 */
export type ParsedFields = Map<number, ProtobufFieldValue[]>;

/**
 * Single outcome extracted from protobuf buffer
 */
export interface ExtractedOutcome {
  /** Selection name (e.g., "Manchester United", "Remis", "Powyżej 2,5") */
  name: string;
  /** Decimal odds value */
  odds: number;
}

/**
 * Parsed match from listing response
 */
export interface BetclicListingMatch {
  /** Match ID as string (can be very large BigInt) */
  matchId: string | null;
  /** Original match name from API */
  matchName: string;
  /** Parsed home team name */
  homeTeam: string;
  /** Parsed away team name */
  awayTeam: string;
  /** 1X2 odds */
  homeOdds: number;
  drawOdds: number;
  awayOdds: number;
}

/**
 * Parsed match details with all markets
 */
export interface BetclicMatchDetails {
  /** Original match name from API */
  matchName: string;
  /** Parsed home team name */
  homeTeam: string;
  /** Parsed away team name */
  awayTeam: string;
  /** All extracted outcomes from the match */
  outcomes: ExtractedOutcome[];
}

/**
 * Parsed team names
 */
export interface ParsedTeams {
  homeTeam: string;
  awayTeam: string;
}

/**
 * 1X2 market odds
 */
export interface Market1X2 {
  home: number;
  draw: number;
  away: number;
}

/**
 * Double Chance market odds
 */
export interface MarketDoubleChance {
  homeOrDraw: number;
  drawOrAway: number;
  homeOrAway: number;
}

/**
 * Both Teams To Score market odds
 */
export interface MarketBTTS {
  yes: number;
  no: number;
}

/**
 * Over/Under line odds
 */
export interface MarketOverUnderLine {
  over: number;
  under: number;
}

/**
 * Full Over/Under market with all lines
 */
export type MarketOverUnder = Record<string, MarketOverUnderLine>;

/**
 * Varint read result with bytes consumed
 */
export interface VarintReadResult {
  value: number;
  bytesRead: number;
}

/**
 * BigInt varint read result for large match IDs
 */
export interface BigIntVarintReadResult {
  value: bigint;
  bytesRead: number;
}
