#!/usr/bin/env npx tsx
/**
 * STS Match JSON Exporter - CLI tool for extracting raw match data as JSON
 *
 * Usage:
 *   npx tsx scripts/sts-match-json.ts --match <url>
 *
 * Options:
 *   --match <url>    Match URL to scrape (required)
 *
 * Output:
 *   Saves to: docs/sts-sequence-executor/{home}-{away}-raw-websocket-json-serialized.json
 */

import { chromium } from "playwright";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  navigateAndCaptureMatchData,
  extractFixtureIdFromUrl,
} from "../src/scrapers/bookmakers/sts/navigation.js";
import { parseWebSocketJson } from "../src/scrapers/bookmakers/sts/parser.js";
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
  name: string | null;
  odds: number;
  status: string | null;
  externalId: number | null;
}



function extractStsIdFromData(
  fixtureJson: STSWebSocketData | null,
  initialJson: STSWebSocketData | null
): number {
  const sources = [fixtureJson, initialJson].filter(Boolean) as STSWebSocketData[];
  
  for (const source of sources) {
    if (!source.P) continue;
    for (const key of Object.keys(source.P)) {
      const match = key.match(/^1m(\d+)$/);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
  }
  return 0;
}

interface MatchInfo {
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  tournament: string;
  country: string;
}

function extractMatchInfoFromData(
  fixtureJson: STSWebSocketData | null,
  initialJson: STSWebSocketData | null,
  matchUrl: string
): MatchInfo {
  const urlMatch = matchUrl.match(/\/kursy\/([^/]+)\/f\d+/);
  const slugPart = urlMatch ? urlMatch[1] : "";
  const teams = slugPart.split("-").map(t => t.charAt(0).toUpperCase() + t.slice(1));
  
  const midIndex = Math.floor(teams.length / 2);
  const homeTeam = teams.slice(0, midIndex).join(" ") || "Unknown";
  const awayTeam = teams.slice(midIndex).join(" ") || "Unknown";

  return {
    homeTeam,
    awayTeam,
    startTime: new Date().toISOString(),
    tournament: "Unknown",
    country: "Unknown",
  };
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
            name: outcome.n || null,
            odds: outcome.O,
            status: outcome.s || null,
            externalId: outcome.id || null,
          });
        }

        if (selections.length > 0) {
          newLines.push({
            lineId: lineIdStr,
            lineName: line.n || null,
            selections,
          });
        }
      }

      if (newLines.length > 0) {
        const existingMarket = marketsMap.get(marketId);

        if (existingMarket) {
          for (const line of newLines) {
            const hasDuplicateById = existingMarket.lines.some((l) => l.lineId === line.lineId);
            if (!hasDuplicateById) {
              existingMarket.lines.push(line);
            }
          }
        } else {
          marketsMap.set(marketId, {
            marketId,
            marketName: marketNameFromLine,
            lines: newLines,
          });
        }
      }
    }
  }

  const markets = Array.from(marketsMap.values()).sort((a, b) => a.marketId - b.marketId);

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
  npx tsx scripts/sts-match-json.ts --match <url>

Options:
  --match <url>     Match URL to scrape (required)

Output:
  Saves to: docs/sts-sequence-executor/{home}-{away}-raw-websocket-json-serialized.json

Examples:
  npx tsx scripts/sts-match-json.ts --match "https://www.sts.pl/kursy/lech-poznan-legia-warszawa/f12345"
  npx tsx scripts/sts-match-json.ts --match "https://www.sts.pl/kursy/sunderland-burnley/f2107591"
`);
    process.exit(0);
  }

  const matchIndex = args.indexOf("--match");
  const matchUrl = matchIndex !== -1 ? args[matchIndex + 1] : null;

  if (!matchUrl) {
    console.error("Missing --match <url>");
    process.exit(1);
  }

  console.error(`[STS] Launching browser...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    const fixtureId = extractFixtureIdFromUrl(matchUrl);
    console.error(`[STS] Extracted fixture ID: ${fixtureId}`);

    const matchCaptureResult = await navigateAndCaptureMatchData(page, matchUrl);
    if (!matchCaptureResult) {
      console.error("[STS] No WebSocket data received for match");
      process.exit(1);
    }

    const fixtureJson = matchCaptureResult.fixtureData.get(fixtureId) || null;
    const initialJson = parseWebSocketJson(matchCaptureResult.initialData);

    if (!fixtureJson && !initialJson) {
      console.error("[STS] Failed to parse WebSocket data");
      process.exit(1);
    }

    const stsId = extractStsIdFromData(fixtureJson, initialJson);
    if (stsId === 0) {
      console.error("[STS] Warning: Could not extract stsId - this may be a live match");
    }

    const matchInfo = extractMatchInfoFromData(fixtureJson, initialJson, matchUrl);
    console.error(`[STS] Found match: ${matchInfo.homeTeam} vs ${matchInfo.awayTeam} (stsId: ${stsId})`);

    const { markets, totalLines, totalSelections } = parseRawMarkets(
      fixtureJson,
      initialJson,
      stsId
    );

    const output: MatchJson = {
      match: {
        id: fixtureId,
        stsId: stsId,
        homeTeam: matchInfo.homeTeam,
        awayTeam: matchInfo.awayTeam,
        startTime: matchInfo.startTime,
        tournament: matchInfo.tournament,
        country: matchInfo.country,
        eventUrl: matchUrl,
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

    const jsonString = JSON.stringify(output, null, 2);

    const outputDir = path.join(__dirname, "..", "..", "docs", "sts-sequence-executor");
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const safeName = (name: string) => name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const outputFile = path.join(outputDir, `${safeName(matchInfo.homeTeam)}-${safeName(matchInfo.awayTeam)}-raw-websocket-json-serialized.json`);
    
    writeFileSync(outputFile, jsonString);
    console.error(`[STS] Saved to: ${outputFile}`);
    console.error(`[STS] Done: ${markets.length} markets, ${totalLines} lines, ${totalSelections} selections`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
