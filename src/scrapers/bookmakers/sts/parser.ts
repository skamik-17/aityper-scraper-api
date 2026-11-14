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
  EUROPEAN_HANDICAP_IDS,
  ASIAN_HANDICAP_IDS,
  ASIAN_TOTAL_MARKET_IDS,
  OVER_UNDER_LINE_MARKET_IDS,
  STS_EXTRA_GROUP_TYPES,
  STS_EXTRA_GROUP_EXCLUDED_MARKET_IDS,
  STS_PER_PLAYER_YES_MARKET_IDS,
  STS_PER_PLAYER_DROPDOWN_FOLDS,
} from "./constants.js";
import { getSelectionNameByOutcomeId } from "./outcome-map.js";
import type {
  STSCategory,
  STSFixture,
  STSWebSocketData,
  STSMarket,
  STSMarketLine,
  STSOutcome,
} from "./types.js";
import { buildEventUrl } from "./navigation.js";

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

type LeagueFilterConfig = (typeof LEAGUE_CONFIG)[string];

/**
 * Name filter for one tournament: the configured substring plus the
 * per-league exclusions. `tournamentName` must already be lowercased.
 * Strict leagues apply it as a second guard after the id match.
 */
function tournamentPassesNameFilters(
  league: string,
  config: LeagueFilterConfig,
  tournamentName: string
): boolean {
  if (!tournamentName.includes(config.tournamentFilter)) return false;

  // Exclude Segunda Division for La Liga
  if (
    league === "laliga" &&
    (tournamentName.includes("2") || tournamentName.includes("hypermotion"))
  ) {
    return false;
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
      return false;
    }
    // Skip Cup competitions
    if (
      tournamentName.includes("cup") ||
      tournamentName.includes("puchar") ||
      tournamentName.includes("trophy")
    ) {
      return false;
    }
    // Skip lower leagues (League 1, Championship, etc.)
    if (
      tournamentName.includes("league 1") ||
      tournamentName.includes("championship") ||
      tournamentName.includes("ligue 2") ||
      tournamentName.includes("second") ||
      tournamentName.includes("third")
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Diagnostic for a strict league whose listing came back empty. It names
 * every other category/tournament that the name filters alone would have
 * accepted, so an STS id renumbering (the league moved to new keys) can be
 * told apart from an empty calendar. It runs only on an empty result:
 * category 249 always holds name-filter matches for the Premier League
 * (Northern Premier League, Premier League 2), so warning on every run
 * would be noise.
 */
function warnStrictIdMiss(
  categories: Record<string, STSCategory>,
  league: string,
  config: LeagueFilterConfig
): void {
  const candidates: string[] = [];
  for (const [catKey, cat] of Object.entries(categories)) {
    if (!(cat.n || "").toLowerCase().includes(config.countryFilter)) continue;
    for (const [tournKey, tourn] of Object.entries(cat.T || {})) {
      // The configured pair itself is no renumbering: it was present but
      // yielded no usable fixture (missing names, self-fixtures).
      if (catKey === String(config.categoryId) && tournKey === String(config.tournamentId)) continue;
      if (!tournamentPassesNameFilters(league, config, (tourn.n || "").toLowerCase())) continue;
      const fixtureCount = Object.keys(tourn.FX || {}).length;
      candidates.push(`C${catKey}/T${tournKey} "${cat.n || ""}" / "${tourn.n || ""}" (${fixtureCount} fixtures)`);
    }
  }
  if (candidates.length === 0) return;
  console.warn(
    `[STS] Strict id filter for ${league} (C${config.categoryId}/T${config.tournamentId}) matched 0 fixtures; ` +
      `name-filter candidates: ${candidates.join(", ")}`
  );
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
      for (const [catKey, cat] of Object.entries(football.C)) {
        // Strict leagues are matched by ids first: tournament keys repeat
        // across categories, so both the category and the tournament key
        // must match. The name filters below remain a second guard.
        if (config.strictTournamentId && catKey !== String(config.categoryId)) continue;
        const countryName = (cat.n || "").toLowerCase();
        if (!countryName.includes(config.countryFilter)) continue;

        // Iterate through tournaments
        for (const [tournKey, tourn] of Object.entries(cat.T || {})) {
          if (config.strictTournamentId && tournKey !== String(config.tournamentId)) continue;
          if (!tournamentPassesNameFilters(league, config, (tourn.n || "").toLowerCase())) continue;

      // Extract fixtures
      for (const [fixId, fix] of Object.entries(tourn.FX || {})) {
        if (!fix.H?.n || !fix.A?.n) continue;

        // A real fixture never has the same club on both sides. This has
        // been observed live: one STS scrape captured a WebSocket frame
        // where fix.H.n was already equal to fix.A.n (the away team's name
        // duplicated into the home slot), producing a "Manchester United vs
        // Manchester United" row that survived because nothing downstream
        // checks home !== away either. Comparing case-insensitively/trimmed
        // here, before the slug, before canonicalization, before the
        // match_id, is the first point both raw names exist together and
        // has zero false-positive risk.
        if (fix.H.n.trim().toLowerCase() === fix.A.n.trim().toLowerCase()) {
          console.warn(
            `[STS] Dropping self-fixture ${fixId}: "${fix.H.n}" vs "${fix.A.n}"`
          );
          continue;
        }

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

  if (config.strictTournamentId && fixtures.length === 0) {
    warnStrictIdMiss(football.C, league, config);
  }

  return fixtures;
}

/**
 * Markets of one source that belong to the fixture: the main group
 * P["1m<stsId>"], then each extra group of the fixture (`f` = fixture id,
 * `r` in STS_EXTRA_GROUP_TYPES) without STS_EXTRA_GROUP_EXCLUDED_MARKET_IDS.
 * Extra groups are read only next to the main group: a source without the
 * fixture's main offer yields nothing, so it never becomes a partial write.
 */
function collectFixtureMarkets(source: STSWebSocketData, fixture: STSFixture): [string, STSMarket][] {
  const mainGroup = source.P?.[`1m${fixture.stsId}`]?.m;
  if (!mainGroup) return [];

  const entries = Object.entries(mainGroup) as [string, STSMarket][];
  for (const group of Object.values(source.P ?? {})) {
    if (group.f !== fixture.id || group.r === undefined || !STS_EXTRA_GROUP_TYPES.has(group.r)) continue;
    for (const [marketIdStr, market] of Object.entries(group.m ?? {}) as [string, STSMarket][]) {
      if (STS_EXTRA_GROUP_EXCLUDED_MARKET_IDS.has(parseInt(marketIdStr, 10))) continue;
      entries.push([marketIdStr, market]);
    }
  }
  return entries;
}

/**
 * Selections of one STS_PER_PLAYER_DROPDOWN_FOLDS market: one per line, never
 * merged by name (two players can share a display name), named after the
 * player and priced at the line's "Tak" outcome. A line folds only as
 * "<player><suffix>" with exactly one priced "Tak" selection. Any other line
 * would publish a wrong price under that player, so it is dropped with a
 * warning and never emitted on its own.
 */
function foldPerPlayerLines(
  marketId: number,
  market: STSMarket,
  fold: { suffix: string; dropdownName: string },
  fixture: STSFixture
): MarketSelection[] {
  const lines = Object.values(market.l || {}) as STSMarketLine[];
  const selections: MarketSelection[] = [];
  const dropped: string[] = [];

  for (const line of lines) {
    const lineName = (line.n || "").trim();
    const player = lineName.endsWith(fold.suffix) ? lineName.slice(0, -fold.suffix.length).trim() : "";
    const lineSelections = parseLineSelections(marketId, line, fixture);
    if (player && lineSelections.length === 1 && lineSelections[0].name === "Tak") {
      selections.push({ ...lineSelections[0], name: player });
    } else {
      const prices = lineSelections.map((s) => `${s.name}@${s.odds}`).join(", ") || "no price";
      dropped.push(`"${lineName}" (${prices})`);
    }
  }

  if (dropped.length > 0) {
    console.warn(
      `[STS] ${fixture.home} vs ${fixture.away}: dropped ${dropped.length} of ${lines.length} lines of market ${marketId} ` +
        `that do not fold into "${fold.dropdownName}" (expected "<player>${fold.suffix}" with one "Tak" price): ` +
        dropped.slice(0, 3).join("; ")
    );
  }

  return selections;
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
    // Process each market of the fixture's main and extra groups
    for (const [marketIdStr, market] of collectFixtureMarkets(source, fixture)) {
      const marketId = parseInt(marketIdStr, 10);
      const groupName = MARKET_GROUPS[marketId] || "Inne";
      const marketType = MARKET_TYPES[marketId] ?? marketId; // Use ID as fallback for unmapped markets

      // Per-player "yes" lines become one dropdown market, built before the
      // name-based dedup below
      const fold = STS_PER_PLAYER_DROPDOWN_FOLDS[marketId];
      if (fold) {
        const selections = foldPerPlayerLines(marketId, market, fold, fixture);
        if (selections.length > 0) {
          markets.push({
            name: fold.dropdownName,
            bookmakerMarketId: marketIdStr,
            groupName,
            type: marketType,
            selections,
          });
        }
        continue;
      }

      for (const [, line] of Object.entries(market.l || {}) as [string, STSMarketLine][]) {
        // STS pads some line names ("\t <P> - strzeli gola")
        const lineName = (line.n || "").trim();
        const rawName = lineName.length > 0 ? lineName : `[STS ID: ${marketId}]`;
        const selections = parseLineSelections(marketId, line, fixture);

        if (selections.length > 0) {
          let finalName = rawName;
          
          if (OVER_UNDER_LINE_MARKET_IDS.has(marketId)) {
            // Append the line value so each O/U line survives the name-based
            // dedup below (line names are identical across lines)
            const lineValue = extractLineFromSelections(line, marketId);
            if (lineValue && !rawName.endsWith(` ${lineValue}`)) {
              finalName = `${rawName} ${lineValue}`;
            }
          } else if (EUROPEAN_HANDICAP_IDS.has(marketId)) {
            const handicapValue = extractHandicapFromSelections(line);
            if (handicapValue) {
              finalName = `${rawName} ${handicapValue}`;
            }
          } else if (ASIAN_HANDICAP_IDS.has(marketId)) {
            const handicapValue = extractAsianHandicapFromSelections(line);
            if (handicapValue) {
              finalName = `${rawName} ${handicapValue}`;
            }
          } else if (PLAYER_STAT_MARKET_IDS.has(marketId)) {
            let playerName = extractPlayerNameFromLineName(lineName);
            if (!playerName || playerName === "Zawodnik") {
              playerName = extractPlayerNameFromOutcome(selections[0]?.name || "");
            }
            if (playerName) {
              finalName = `${rawName}|${playerName}`;
            }
          }

          markets.push({
            name: finalName,
            bookmakerMarketId: marketIdStr,
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
 * Market 192 ("Dokładna liczba kartek") carries a second outcome-id block
 * (218-222: "0-2"/"3-4"/"5-6"/"7+"/"9+") whose odds are flat placeholder
 * quotes (~41-50 across ALL bands, mathematically impossible next to the
 * genuine "0-1"/"2-3"/"4-5"/"6-7"/"8+" scheme priced 1.5-20 in the same
 * line). Never publish these as live odds.
 */
const CARDS_EXACT_RANGE_MARKET_ID = 192;
const CARDS_EXACT_RANGE_PLACEHOLDER_OUTCOME_IDS = new Set([218, 219, 220, 221, 222]);

/** The nameless outcome of the STS_PER_PLAYER_YES_MARKET_IDS lines. */
const PER_PLAYER_YES_OUTCOME_ID = 74;

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

    // Skip placeholder second-scheme bands of the exact-cards market
    if (
      marketId === CARDS_EXACT_RANGE_MARKET_ID &&
      CARDS_EXACT_RANGE_PLACEHOLDER_OUTCOME_IDS.has(outcomeId)
    ) {
      continue;
    }

    const selectionName = getSelectionName(marketId, outcomeId, outcome, fixture);
    // An outcome with no resolvable label must be skipped, never surfaced
    // under its numeric outcome id.
    if (!selectionName) continue;

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
): string | null {
  if (outcome.n && outcome.n.length > 1) {
    return outcome.n;
  }

  // The single nameless outcome of a per-player line is its "yes" price.
  // Outcome 74 has no global name, so elsewhere it stays unresolved.
  if (outcomeId === PER_PLAYER_YES_OUTCOME_ID && !outcome.n && STS_PER_PLAYER_YES_MARKET_IDS.has(marketId)) {
    return "Tak";
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

    case MARKET_IDS.BTTS_BY_HALF:
      if (outcomeId === 241) return "nie / nie";
      if (outcomeId === 242) return "tak / nie";
      if (outcomeId === 243) return "tak / tak";
      if (outcomeId === 244) return "nie / tak";
      break;

    // Market 221 (FIRST_CORNER) and 179 (FIRST_CARD): the "no corner"/"no
    // card" outcome shares global outcome id 7 with the "First/Last goal"
    // markets (8, 9), where it means "Bez gola" (no goal). That text leaking
    // into these unrelated markets is misleading (and fragile - a future
    // rename of id 7 for goal markets would silently corrupt these too), so
    // give them their own market-appropriate "none" label instead.
    case 221:
    case 179:
      if (outcomeId === 7) return "Brak";
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

  return outcome.n || null;
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
      // For Asian Total Goals (full match, HT, 2nd half), extract integer
      // lines (e.g., "+1", "+2", "-3")
      if (ASIAN_TOTAL_MARKET_IDS.has(marketId)) {
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

function extractAsianHandicapFromSelections(line: STSMarketLine): string | null {
  if (!line.o) return null;

  for (const [, outcome] of Object.entries(line.o) as [string, STSOutcome][]) {
    if (outcome.n) {
      const match = outcome.n.match(/^1\s*\(([+-]?\d+(?:[.,]\d+)?)\)/);
      if (match) {
        return match[1].replace(",", ".");
      }
    }
  }

  return null;
}
