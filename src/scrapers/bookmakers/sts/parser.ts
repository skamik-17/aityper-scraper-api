/**
 * STS Parser Module
 *
 * Pure parsing logic for transforming STS WebSocket data
 * into the unified ScrapedMarket format.
 *
 * This module has NO Playwright dependencies - it only works with
 * raw JSON data from WebSocket frames.
 */

import type { MarketSelection, ScrapedMarket } from "../../../types/full-offer.js";
import type { MarketOverUnderOdds } from "../../../types/full-offer.js";
import {
  MARKET_IDS,
  MARKET_GROUPS,
  MARKET_TYPES,
  OUTCOME_1X2,
  OUTCOME_DOUBLE_CHANCE,
  OUTCOME_BTTS,
  OUTCOME_OVER_UNDER,
  CORRECT_SCORE_OUTCOMES,
  HALF_CORRECT_SCORE_OUTCOMES,
  LEAGUE_CONFIG,
  PLAYER_STAT_MARKET_IDS,
} from "./constants.js";
import { getSelectionNameByOutcomeId } from "./outcome-map.js";
import type {
  STSFixture,
  STSOdds,
  STSWebSocketData,
  STSMarket,
  STSMarketLine,
  STSOutcome,
  WSCaptureResult,
} from "./types.js";
import { buildEventUrl } from "./navigation.js";

/**
 * Parsed fixture with odds data
 */
export interface ParsedFixtureWithOdds {
  fixture: STSFixture;
  odds: STSOdds;
}

/**
 * Parse JSON from WebSocket raw data string
 * STS sends data in format: "header\n{json}"
 */
export function parseWebSocketJson(rawData: string): STSWebSocketData | null {
  try {
    const lines = rawData.split("\n");
    // JSON is typically on line 1 (after header) or line 0 for some messages
    const jsonStr = lines[1] || lines[0];
    return JSON.parse(jsonStr) as STSWebSocketData;
  } catch {
    return null;
  }
}

/**
 * Extract fixtures from STS WebSocket data for a specific league
 * Path: B.S.1.C.{catId}.T.{tournId}.FX.{fixId}
 */
export function parseFixtures(
  data: STSWebSocketData,
  league: string
): STSFixture[] {
  const config = LEAGUE_CONFIG[league];
  if (!config) return [];

  const fixtures: STSFixture[] = [];
  const football = data.B?.S?.["1"];
  if (!football?.C) return fixtures;

      // Iterate through categories (countries)
      for (const [, cat] of Object.entries(football.C)) {
        const countryName = (cat.n || "").toLowerCase();
        if (!countryName.includes(config.countryFilter)) continue;

        // Iterate through tournaments
        for (const [, tourn] of Object.entries(cat.T || {})) {
          const tournamentName = (tourn.n || "").toLowerCase();
          if (!tournamentName.includes(config.tournamentFilter)) continue;

          // Exclude Segunda Division for La Liga
          if (
            league === "laliga" &&
            (tournamentName.includes("2") || tournamentName.includes("hypermotion"))
          ) {
            continue;
          }

          // Exclude U21, U23, Cup, and non-Premier League tournaments for Premier League
          if (league === "premier-league") {
            // Skip U21/U23 matches
            if (
              tournamentName.includes("u21") ||
              tournamentName.includes("u23") ||
              tournamentName.includes("under 21") ||
              tournamentName.includes("under 23")
            ) {
              continue;
            }
            // Skip Cup competitions
            if (
              tournamentName.includes("cup") ||
              tournamentName.includes("puchar") ||
              tournamentName.includes("trophy")
            ) {
              continue;
            }
            // Skip lower leagues (League 1, Championship, etc.)
            if (
              tournamentName.includes("league 1") ||
              tournamentName.includes("championship") ||
              tournamentName.includes("ligue 2") ||
              tournamentName.includes("second") ||
              tournamentName.includes("third")
            ) {
              continue;
            }
          }

      // Extract fixtures
      for (const [fixId, fix] of Object.entries(tourn.FX || {})) {
        if (!fix.H?.n || !fix.A?.n) continue;

        fixtures.push({
          id: fixId,
          home: fix.H.n,
          away: fix.A.n,
          startTime: fix.t || "",
          stsId: fix.sid || 0,
          tournament: tourn.n || "",
          country: cat.n || "",
          eventUrl: buildEventUrl(fix.H.n, fix.A.n, fixId),
        });
      }
    }
  }

  return fixtures;
}

/**
 * Extract odds for a specific fixture from WebSocket data
 * Path: P.{assocKey}.m.{marketId}.l.{lineId}.o.{outcomeId}
 */
export function extractOdds(
  fixture: STSFixture,
  fixtureJson: STSWebSocketData | null,
  initialJson: STSWebSocketData | null
): STSOdds {
  const result: STSOdds = {
    odds1: null,
    oddsX: null,
    odds2: null,
    odds1X: null,
    oddsX2: null,
    odds12: null,
    bttsYes: null,
    bttsNo: null,
    overUnder: {},
  };

  // Try fixture-specific data first, then initial data
  const sources = [fixtureJson, initialJson].filter(Boolean) as STSWebSocketData[];

  for (const source of sources) {
    // The odds are in P.{assocKey}.m.{marketId}.l.{lineId}.o.{outcomeId}.O
    const assocKey = `1m${fixture.stsId}`;
    const marketData = source.P?.[assocKey]?.m;

    if (!marketData) continue;

    // Market 1 = 1X2 (Match result)
    const market1x2 = marketData[String(MARKET_IDS.MATCH_RESULT_1X2)]?.l?.["1"]?.o;
    if (market1x2) {
      result.odds1 = market1x2[String(OUTCOME_1X2.HOME)]?.O || null;
      result.oddsX = market1x2[String(OUTCOME_1X2.DRAW)]?.O || null;
      result.odds2 = market1x2[String(OUTCOME_1X2.AWAY)]?.O || null;
    }

    // Market 10 = Double Chance
    const marketDC = marketData[String(MARKET_IDS.DOUBLE_CHANCE)]?.l?.["1"]?.o;
    if (marketDC) {
      result.odds1X = marketDC[String(OUTCOME_DOUBLE_CHANCE.HOME_OR_DRAW)]?.O || null;
      result.oddsX2 = marketDC[String(OUTCOME_DOUBLE_CHANCE.DRAW_OR_AWAY)]?.O || null;
      result.odds12 = marketDC[String(OUTCOME_DOUBLE_CHANCE.HOME_OR_AWAY)]?.O || null;
    }

    // Market 43 = BTTS (tak/nie)
    const marketBTTS = marketData[String(MARKET_IDS.BTTS)]?.l?.["1"]?.o;
    if (marketBTTS) {
      result.bttsYes = marketBTTS[String(OUTCOME_BTTS.YES)]?.O || null;
      result.bttsNo = marketBTTS[String(OUTCOME_BTTS.NO)]?.O || null;
    }

    // Market 25 = Total Goals Over/Under
    const marketOU = marketData[String(MARKET_IDS.TOTAL_GOALS)]?.l;
    if (marketOU) {
      for (const [, lineData] of Object.entries(marketOU) as [string, STSMarketLine][]) {
        const outcomes = lineData.o;
        if (!outcomes) continue;

        const overOutcome = outcomes[String(OUTCOME_OVER_UNDER.OVER)];
        const underOutcome = outcomes[String(OUTCOME_OVER_UNDER.UNDER)];

        if (!overOutcome?.O || !underOutcome?.O) continue;

        // Extract line value from outcome name (e.g., "+2.5" or "-2.5")
        const outcomeName = overOutcome.n || underOutcome.n || "";
        const lineMatch = outcomeName.match(/[+-]?(\d+[.,]5)/);

        if (lineMatch) {
          const line = parseFloat(lineMatch[1].replace(",", ".")).toFixed(1);
          result.overUnder[line] = { over: overOutcome.O, under: underOutcome.O };
        }
      }
    }

    // If we found 1X2 odds, we're done with this source
    if (result.odds1) break;
  }

  return result;
}

/**
 * Parse all fixtures with their odds for a league
 */
export function parseLeagueData(
  captureResult: WSCaptureResult,
  league: string
): ParsedFixtureWithOdds[] {
  const initialJson = parseWebSocketJson(captureResult.initialData);
  if (!initialJson) return [];

  const fixtures = parseFixtures(initialJson, league);
  const results: ParsedFixtureWithOdds[] = [];

  for (const fixture of fixtures) {
    const fixtureJson = captureResult.fixtureData.get(fixture.id) || null;
    const odds = extractOdds(fixture, fixtureJson, initialJson);

    if (odds.odds1 && odds.oddsX && odds.odds2) {
      results.push({ fixture, odds });
    }
  }

  return results;
}

/**
 * Parse all markets from fixture WebSocket data into unified ScrapedMarket format
 * This is the main function for full offer scraping
 */
export function parseAllMarkets(
  fixture: STSFixture,
  fixtureJson: STSWebSocketData | null,
  initialJson: STSWebSocketData | null
): ScrapedMarket[] {
  const markets: ScrapedMarket[] = [];

  // Try fixture-specific data first, then initial data
  const sources = [fixtureJson, initialJson].filter(Boolean) as STSWebSocketData[];

  for (const source of sources) {
    const assocKey = `1m${fixture.stsId}`;
    const marketData = source.P?.[assocKey]?.m;

    if (!marketData) continue;

    // Process each market
    for (const [marketIdStr, market] of Object.entries(marketData) as [string, STSMarket][]) {
      const marketId = parseInt(marketIdStr, 10);
      const marketName = getMarketName(marketId, market);
      const groupName = MARKET_GROUPS[marketId] || "Inne";
      const marketType = MARKET_TYPES[marketId] ?? marketId; // Use ID as fallback for unmapped markets

      for (const [, line] of Object.entries(market.l || {}) as [string, STSMarketLine][]) {
        const selections = parseLineSelections(marketId, line, fixture);

        if (selections.length > 0) {
          let finalName = marketName;
          
          if (marketId === MARKET_IDS.TOTAL_GOALS || marketId === MARKET_IDS.TOTAL_GOALS_ASIAN) {
            const lineValue = extractLineFromSelections(line, marketId);
            if (lineValue) {
              finalName = `${marketName} ${lineValue}`;
            }
          } else if (marketId === MARKET_IDS.EUROPEAN_HANDICAP || marketId === MARKET_IDS.ASIAN_HANDICAP) {
            const handicapValue = extractHandicapFromSelections(line);
            if (handicapValue) {
              finalName = `${marketName} ${handicapValue}`;
            }
          } else if (PLAYER_STAT_MARKET_IDS.has(marketId)) {
            let playerName = extractPlayerNameFromLineName(line.n || "");
            if (!playerName || playerName === "Zawodnik") {
              playerName = extractPlayerNameFromOutcome(selections[0]?.name || "");
            }
            if (playerName) {
              finalName = `${marketName}|${playerName}`;
            }
          }

          markets.push({
            name: finalName,
            groupName,
            type: marketType,
            selections,
          });
        }
      }
    }

    // Continue to aggregate markets from all sources
    // (don't break early - fixtureJson often has more detailed markets)
  }

  // Deduplicate markets by name to avoid double-counting
  const uniqueMarkets = new Map<string, ScrapedMarket>();
  for (const market of markets) {
    const key = `${market.name}|${market.groupName}`;
    // Keep the market with more selections or later (more detailed) source
    if (!uniqueMarkets.has(key) || market.selections.length > (uniqueMarkets.get(key)?.selections.length || 0)) {
      uniqueMarkets.set(key, market);
    }
  }

  return Array.from(uniqueMarkets.values());
}

/**
 * Get human-readable market name based on market ID
 */
function getMarketName(marketId: number, market: STSMarket): string {
  // Use the market's own name if available and meaningful
  if (market.n && market.n.length > 2) {
    return market.n;
  }

  switch (marketId) {
    case MARKET_IDS.MATCH_RESULT_1X2:
      return "Wynik meczu";
    case MARKET_IDS.DOUBLE_CHANCE:
      return "Podwojna szansa";
    case MARKET_IDS.BTTS:
      return "Obie druzyny strzelą";
    case MARKET_IDS.TOTAL_GOALS:
      return "Liczba goli";
    case MARKET_IDS.TOTAL_GOALS_ASIAN:
      return "Liczba goli (zwrot)";
    case MARKET_IDS.HALF_TIME_RESULT:
      return "Wynik 1. polowy";
    case MARKET_IDS.HALF_TIME_TOTAL:
      return "Liczba goli 1. polowa";
    case MARKET_IDS.CORRECT_SCORE:
      return "Dokladny wynik";
    case MARKET_IDS.DRAW_NO_BET:
      return "Remis = zwrot";
    default:
      return `Rynek ${marketId}`;
  }
}

/**
 * Parse selections from a market line
 */
function parseLineSelections(
  marketId: number,
  line: STSMarketLine,
  fixture: STSFixture
): MarketSelection[] {
  const selections: MarketSelection[] = [];

  if (!line.o) return selections;

  for (const [outcomeIdStr, outcome] of Object.entries(line.o) as [string, STSOutcome][]) {
    const outcomeId = parseInt(outcomeIdStr, 10);

    if (!outcome.O || outcome.O <= 0) continue;

    const selectionName = getSelectionName(marketId, outcomeId, outcome, fixture);

    selections.push({
      name: selectionName,
      odds: outcome.O,
      externalId: outcome.id ? String(outcome.id) : undefined,
      status: outcome.s === "active" ? "active" : undefined,
    });
  }

  return selections;
}

function getSelectionName(
  marketId: number,
  outcomeId: number,
  outcome: STSOutcome,
  fixture: STSFixture
): string {
  if (outcome.n && outcome.n.length > 1) {
    return outcome.n;
  }

  switch (marketId) {
    case MARKET_IDS.MATCH_RESULT_1X2:
      if (outcomeId === OUTCOME_1X2.HOME) return fixture.home;
      if (outcomeId === OUTCOME_1X2.DRAW) return "Remis";
      if (outcomeId === OUTCOME_1X2.AWAY) return fixture.away;
      break;

    case MARKET_IDS.DOUBLE_CHANCE:
      if (outcomeId === OUTCOME_DOUBLE_CHANCE.HOME_OR_DRAW) return "1X";
      if (outcomeId === OUTCOME_DOUBLE_CHANCE.HOME_OR_AWAY) return "12";
      if (outcomeId === OUTCOME_DOUBLE_CHANCE.DRAW_OR_AWAY) return "X2";
      break;

    case MARKET_IDS.BTTS:
      if (outcomeId === OUTCOME_BTTS.YES) return "Tak";
      if (outcomeId === OUTCOME_BTTS.NO) return "Nie";
      break;

    case MARKET_IDS.TOTAL_GOALS:
    case MARKET_IDS.TOTAL_GOALS_ASIAN:
      if (outcomeId === OUTCOME_OVER_UNDER.OVER) return "Powyżej";
      if (outcomeId === OUTCOME_OVER_UNDER.UNDER) return "Poniżej";
      break;

    case MARKET_IDS.HALF_TIME_RESULT:
      if (outcomeId === OUTCOME_1X2.HOME) return fixture.home;
      if (outcomeId === OUTCOME_1X2.DRAW) return "Remis";
      if (outcomeId === OUTCOME_1X2.AWAY) return fixture.away;
      break;

    case MARKET_IDS.CORRECT_SCORE:
      if (CORRECT_SCORE_OUTCOMES[outcomeId]) {
        return CORRECT_SCORE_OUTCOMES[outcomeId];
      }
      break;

    case MARKET_IDS.FIRST_HALF_CORRECT_SCORE:
    case MARKET_IDS.SECOND_HALF_CORRECT_SCORE:
      if (HALF_CORRECT_SCORE_OUTCOMES[outcomeId]) {
        return HALF_CORRECT_SCORE_OUTCOMES[outcomeId];
      }
      break;
  }

  const globalName = getSelectionNameByOutcomeId(outcomeId);
  if (globalName) {
    return globalName;
  }

  return outcome.n || String(outcomeId);
}

function extractPlayerNameFromLineName(lineName: string): string | null {
  const dashIndex = lineName.indexOf(" - ");
  if (dashIndex > 0) {
    return lineName.substring(0, dashIndex).trim();
  }
  return null;
}

function extractPlayerNameFromOutcome(outcomeName: string): string | null {
  const match = outcomeName.match(/^(.+?)\s+i\s+[1X2]/i);
  if (match) {
    return match[1].trim();
  }
  return null;
}

function extractLineFromSelections(line: STSMarketLine, marketId: number): string | null {
  if (!line.o) return null;

  for (const [, outcome] of Object.entries(line.o) as [string, STSOutcome][]) {
    if (outcome.n) {
      // For Asian Total Goals, extract integer lines (e.g., "+1", "+2", "-3")
      if (marketId === MARKET_IDS.TOTAL_GOALS_ASIAN) {
        const intMatch = outcome.n.match(/[+-]?(\d+)(?![.,]\d)/);
        if (intMatch) {
          return intMatch[1];
        }
      }

      // For regular Total Goals, extract decimal lines (e.g., "+2.5", "-1.5")
      const decMatch = outcome.n.match(/[+-]?(\d+[.,]5)/);
      if (decMatch) {
        return parseFloat(decMatch[1].replace(",", ".")).toFixed(1);
      }
    }
  }

  return null;
}

function extractHandicapFromSelections(line: STSMarketLine): string | null {
  if (!line.o) return null;

  for (const [, outcome] of Object.entries(line.o) as [string, STSOutcome][]) {
    if (outcome.n) {
      const handicapMatch = outcome.n.match(/\((\d+:\d+)\)/);
      if (handicapMatch) {
        return handicapMatch[1];
      }
    }
  }

  return null;
}

/**
 * Check if fixture has valid 1X2 odds
 */
export function hasValid1X2Odds(odds: STSOdds): boolean {
  return (
    odds.odds1 !== null &&
    odds.odds1 > 0 &&
    odds.oddsX !== null &&
    odds.oddsX > 0 &&
    odds.odds2 !== null &&
    odds.odds2 > 0
  );
}

/**
 * Convert STSOdds to standard markets for backward compatibility
 */
export function oddsToMarketOverUnder(
  odds: STSOdds
): Record<string, MarketOverUnderOdds> | undefined {
  if (Object.keys(odds.overUnder).length === 0) return undefined;
  return odds.overUnder as Record<string, MarketOverUnderOdds>;
}
