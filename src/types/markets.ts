/**
 * Market type definitions for extended betting markets
 * Supports: 1X2, Double Chance, Over/Under Goals, BTTS
 */

// Core market type enum - all supported betting markets
export type MarketType = "1x2" | "double_chance" | "over_under" | "btts";

// Outcome types per market
export type Outcome1X2 = "home" | "draw" | "away";
export type OutcomeDoubleChance = "1X" | "X2" | "12";
export type OutcomeBTTS = "yes" | "no";
export type OutcomeOverUnder = "over" | "under";

// Over/Under line values (0.5 to 5.5)
export type OverUnderLine = 0.5 | 1.5 | 2.5 | 3.5 | 4.5 | 5.5;

// Market odds structures
export interface Market1X2Odds {
  home: number;
  draw: number;
  away: number;
}

export interface MarketDoubleChanceOdds {
  homeOrDraw: number; // 1X
  drawOrAway: number; // X2
  homeOrAway: number; // 12
}

export interface MarketBTTSOdds {
  yes: number;
  no: number;
}

export interface MarketOverUnderOdds {
  over: number;
  under: number;
}

// Combined market odds structure
export interface MarketOdds {
  market1X2?: Market1X2Odds;
  marketDoubleChance?: MarketDoubleChanceOdds;
  marketBTTS?: MarketBTTSOdds;
  marketOverUnder?: Record<string, MarketOverUnderOdds>; // Keys: "0.5", "1.5", etc.
}
