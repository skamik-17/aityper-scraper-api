#!/usr/bin/env npx tsx
/**
 * STS Match JSON Exporter - CLI tool for extracting raw match data as JSON
 *
 * Usage:
 *   npx tsx scripts/sts-match-json.ts <match-url>
 *   npx tsx scripts/sts-match-json.ts <league> --first
 *
 * Options:
 *   --output <file>  Save to file instead of stdout
 *   --pretty         Formatted JSON (default for stdout)
 *   --compact        Compact JSON
 */

import { chromium } from "playwright";
import { writeFileSync } from "fs";
import { LEAGUE_CONFIG, MARKET_IDS } from "../src/scrapers/bookmakers/sts/constants.js";
import {
  navigateAndCaptureLeagueData,
  navigateAndCaptureMatchData,
  extractFixtureIdFromUrl,
} from "../src/scrapers/bookmakers/sts/navigation.js";
import { parseWebSocketJson, parseFixtures } from "../src/scrapers/bookmakers/sts/parser.js";
import { getSelectionNameByOutcomeId } from "../src/scrapers/bookmakers/sts/outcome-map.js";
import type { STSWebSocketData, STSMarket, STSMarketLine, STSOutcome } from "../src/scrapers/bookmakers/sts/types.js";

interface MatchJson {
  match: {
    id: string;
    stsId: number;
    homeTeam: string;
    awayTeam: string;
    startTime: string;
    tournament: string;
    country: string;
    eventUrl: string;
  };
  markets: MarketJson[];
  metadata: {
    bookmaker: "sts";
    scrapedAt: string;
    totalMarkets: number;
    totalLines: number;
    totalSelections: number;
  };
}

interface MarketJson {
  marketId: number;
  marketName: string | null;
  lines: LineJson[];
}

interface LineJson {
  lineId: string;
  lineName: string | null;
  selections: SelectionJson[];
}

interface SelectionJson {
  outcomeId: number;
  name: string;
  odds: number;
  status: string | null;
  externalId: number | null;
}

const MARKET_ID_TO_NAME: Record<number, string> = {
  [MARKET_IDS.MATCH_RESULT_1X2]: "Mecz",
  [MARKET_IDS.DOUBLE_CHANCE]: "Podwójna szansa",
  [MARKET_IDS.DRAW_NO_BET]: "Zakład bez remisu",
  [MARKET_IDS.BTTS]: "Obie drużyny strzelą gola",
  [MARKET_IDS.TOTAL_GOALS]: "Liczba goli",
  [MARKET_IDS.TOTAL_GOALS_ASIAN]: "Liczba goli (azjatycki)",
  [MARKET_IDS.FIRST_GOAL]: "1. gol",
  [MARKET_IDS.LAST_GOAL]: "Ostatni gol",
  [MARKET_IDS.WIN_TO_NIL_HOME]: "1. drużyna wygra do zera",
  [MARKET_IDS.WIN_TO_NIL_AWAY]: "2. drużyna wygra do zera",
  [MARKET_IDS.HALF_TIME_RESULT]: "1. połowa - wynik",
  [MARKET_IDS.HALF_TIME_TOTAL]: "1. połowa - liczba goli",
  [MARKET_IDS.HALF_TIME_BTTS]: "1. połowa - obie strzelą",
  [MARKET_IDS.SECOND_HALF_RESULT]: "2. połowa - wynik",
  [MARKET_IDS.SECOND_HALF_TOTAL]: "2. połowa - liczba goli",
  [MARKET_IDS.EUROPEAN_HANDICAP]: "Handicap 1X2",
  [MARKET_IDS.ASIAN_HANDICAP]: "Handicap azjatycki",
  [MARKET_IDS.CORRECT_SCORE]: "Dokładny wynik",
  [MARKET_IDS.HALFTIME_FULLTIME]: "1. połowa / wynik końcowy",
  [MARKET_IDS.RESULT_AND_BTTS]: "Wynik i obie strzelą",
  [MARKET_IDS.RESULT_AND_TOTAL]: "Wynik i liczba goli",
  [MARKET_IDS.FIRST_GOALSCORER]: "Pierwszy strzelec",
  [MARKET_IDS.ANYTIME_GOALSCORER]: "Strzelec gola",
};

function resolveMarketName(marketId: number, lineNameFromData: string | null): string {
  if (lineNameFromData && lineNameFromData.trim() !== "") {
    return lineNameFromData;
  }
  return MARKET_ID_TO_NAME[marketId] || `Market ${marketId}`;
}

function resolveSelectionName(outcomeId: number, outcomeName: string | undefined): string {
  if (outcomeName && outcomeName.trim() !== "") {
    return outcomeName;
  }
  
  const mappedName = getSelectionNameByOutcomeId(outcomeId);
  if (mappedName) {
    return mappedName;
  }
  
  return `outcomeId:${outcomeId}`;
}

function createLineFingerprint(line: LineJson): string {
  return line.selections
    .map((s) => s.name)
    .sort()
    .join("|");
}

/** Extracts numeric sort key from selection names. Patterns: "(0:1)", "(+1.5)", "(-2)" */
function extractLineSortKey(line: LineJson): number {
  if (line.selections.length === 0) return 0;

  const firstName = line.selections[0].name;

  const euroHandicapMatch = firstName.match(/\((-?\d+):(-?\d+)\)/);
  if (euroHandicapMatch) {
    const home = parseInt(euroHandicapMatch[1], 10);
    const away = parseInt(euroHandicapMatch[2], 10);
    return home - away;
  }

  const asianHandicapMatch = firstName.match(/\(([+-]?\d+\.?\d*)\)/);
  if (asianHandicapMatch) {
    return parseFloat(asianHandicapMatch[1]);
  }

  const totalMatch = firstName.match(/^([+-]?\d+\.?\d*)$/);
  if (totalMatch) {
    return parseFloat(totalMatch[1]);
  }

  return 0;
}

function parseRawMarkets(
  fixtureJson: STSWebSocketData | null,
  initialJson: STSWebSocketData | null,
  stsId: number
): { markets: MarketJson[]; totalLines: number; totalSelections: number } {
  const marketsMap = new Map<number, MarketJson>();

  if (stsId <= 0) {
    console.error("[STS] Warning: stsId is 0 or invalid - this is likely a live match");
    return { markets: [], totalLines: 0, totalSelections: 0 };
  }

  const targetAssocKey = `1m${stsId}`;
  const sources = [fixtureJson, initialJson].filter(Boolean) as STSWebSocketData[];

  for (const source of sources) {
    const assocData = source.P?.[targetAssocKey];
    if (!assocData) continue;

    const marketData = (assocData as { m?: Record<string, STSMarket> }).m;
    if (!marketData) continue;

    for (const [marketIdStr, market] of Object.entries(marketData) as [string, STSMarket][]) {
      const marketId = parseInt(marketIdStr, 10);

      let marketNameFromLine: string | null = null;
      const newLines: LineJson[] = [];

      for (const [lineIdStr, line] of Object.entries(market.l || {}) as [string, STSMarketLine][]) {
        const selections: SelectionJson[] = [];

        if (!marketNameFromLine && line.n) {
          marketNameFromLine = line.n;
        }

        for (const [outcomeIdStr, outcome] of Object.entries(line.o || {}) as [string, STSOutcome][]) {
          const outcomeId = parseInt(outcomeIdStr, 10);

          if (!outcome.O || outcome.O <= 0) continue;

          selections.push({
            outcomeId,
            name: resolveSelectionName(outcomeId, outcome.n),
            odds: outcome.O,
            status: outcome.s || null,
            externalId: outcome.id || null,
          });
        }

        if (selections.length > 0) {
          newLines.push({
            lineId: lineIdStr,
            lineName: line.n || null,
            selections: selections.sort((a, b) => a.outcomeId - b.outcomeId),
          });
        }
      }

      if (newLines.length > 0) {
        const existingMarket = marketsMap.get(marketId);

        if (existingMarket) {
          const existingFingerprints = new Set(existingMarket.lines.map(createLineFingerprint));

          for (const line of newLines) {
            const fingerprint = createLineFingerprint(line);
            const hasDuplicateById = existingMarket.lines.some((l) => l.lineId === line.lineId);
            const hasDuplicateByContent = existingFingerprints.has(fingerprint);

            if (!hasDuplicateById && !hasDuplicateByContent) {
              existingMarket.lines.push(line);
              existingFingerprints.add(fingerprint);
            }
          }
        } else {
          marketsMap.set(marketId, {
            marketId,
            marketName: resolveMarketName(marketId, marketNameFromLine),
            lines: newLines,
          });
        }
      }
    }
  }

  const markets = Array.from(marketsMap.values()).sort((a, b) => a.marketId - b.marketId);

  for (const market of markets) {
    market.lines.sort((a, b) => extractLineSortKey(a) - extractLineSortKey(b));
  }

  let totalLines = 0;
  let totalSelections = 0;
  for (const market of markets) {
    totalLines += market.lines.length;
    for (const line of market.lines) {
      totalSelections += line.selections.length;
    }
  }

  return { markets, totalLines, totalSelections };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
STS Match JSON Exporter (Raw Data)

Usage:
  npx tsx scripts/sts-match-json.ts <match-url>
  npx tsx scripts/sts-match-json.ts <league> --first

Options:
  --output <file>   Save to file instead of stdout
  --pretty          Formatted JSON (default for stdout)
  --compact         Compact JSON

Examples:
  npx tsx scripts/sts-match-json.ts "https://www.sts.pl/kursy/lech-poznan-legia-warszawa/f12345"
  npx tsx scripts/sts-match-json.ts ekstraklasa --first
  npx tsx scripts/sts-match-json.ts premier-league --first --output match.json
`);
    process.exit(0);
  }

  const isPretty = args.includes("--pretty") || !args.includes("--compact");
  const isFirstMatch = args.includes("--first");

  const outputIndex = args.indexOf("--output");
  const outputFile = outputIndex !== -1 ? args[outputIndex + 1] : null;

  const target = args.find((a) => !a.startsWith("--") && (args.indexOf(a) === 0 || args[args.indexOf(a) - 1] !== "--output"));

  if (!target) {
    console.error("Missing match URL or league name");
    process.exit(1);
  }

  const isUrl = target.startsWith("http");
  const isLeague = LEAGUE_CONFIG[target] !== undefined;

  if (!isUrl && !isLeague) {
    console.error(`Unknown league: ${target}`);
    console.error(`Available leagues: ${Object.keys(LEAGUE_CONFIG).join(", ")}`);
    process.exit(1);
  }

  if (isLeague && !isFirstMatch) {
    console.error("For league, use --first flag to fetch first match");
    process.exit(1);
  }

  console.error(`[STS] Launching browser...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    const leagueSlug = isUrl ? "ekstraklasa" : target;
    
    const leagueCaptureResult = await navigateAndCaptureLeagueData(page, leagueSlug);
    if (!leagueCaptureResult) {
      console.error("[STS] No WebSocket data received for league");
      process.exit(1);
    }

    const initialJson = parseWebSocketJson(leagueCaptureResult.initialData);
    if (!initialJson) {
      console.error("[STS] Failed to parse WebSocket data");
      process.exit(1);
    }

    const fixtures = parseFixtures(initialJson, leagueSlug);
    if (fixtures.length === 0) {
      console.error("[STS] No fixtures found for league");
      process.exit(1);
    }

    let fixture = fixtures.find(f => f.stsId > 0) || fixtures[0];
    let fixtureId = fixture.id;

    if (isUrl) {
      fixtureId = extractFixtureIdFromUrl(target);
      const found = fixtures.find((f) => f.id === fixtureId);
      if (found) {
        fixture = found;
      } else {
        console.error(`[STS] Fixture ${fixtureId} not found in league data`);
        process.exit(1);
      }
    } else if (fixture.stsId === 0) {
      console.error("[STS] Warning: First fixture has stsId=0 (likely live). Trying to find another...");
      const prematchFixture = fixtures.find(f => f.stsId > 0);
      if (prematchFixture) {
        fixture = prematchFixture;
        fixtureId = fixture.id;
      }
    }

    console.error(`[STS] Found match: ${fixture.home} vs ${fixture.away} (stsId: ${fixture.stsId})`);

    const matchCaptureResult = await navigateAndCaptureMatchData(page, fixture.eventUrl);
    
    const fixtureJson = matchCaptureResult?.fixtureData.get(fixtureId) || null;
    const matchInitialJson = matchCaptureResult ? parseWebSocketJson(matchCaptureResult.initialData) : null;

    const { markets, totalLines, totalSelections } = parseRawMarkets(
      fixtureJson,
      matchInitialJson || initialJson,
      fixture.stsId
    );

    const output: MatchJson = {
      match: {
        id: fixture.id,
        stsId: fixture.stsId,
        homeTeam: fixture.home,
        awayTeam: fixture.away,
        startTime: fixture.startTime,
        tournament: fixture.tournament,
        country: fixture.country,
        eventUrl: fixture.eventUrl,
      },
      markets,
      metadata: {
        bookmaker: "sts",
        scrapedAt: new Date().toISOString(),
        totalMarkets: markets.length,
        totalLines,
        totalSelections,
      },
    };

    const jsonString = isPretty ? JSON.stringify(output, null, 2) : JSON.stringify(output);

    if (outputFile) {
      writeFileSync(outputFile, jsonString);
      console.error(`[STS] Saved to: ${outputFile}`);
    } else {
      console.log(jsonString);
    }

    console.error(`[STS] Done: ${markets.length} markets, ${totalLines} lines, ${totalSelections} selections`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
