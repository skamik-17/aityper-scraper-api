/**
 * Analyze Market Patterns for All 14 Bookmakers
 *
 * This script scrapes full offers from each bookmaker and analyzes:
 * 1. What market names they use
 * 2. What selection names they use
 * 3. Current normalization coverage
 * 4. Patterns that could be used for bookmaker-specific normalizers
 *
 * Usage:
 *   npx tsx src/scripts/analyze-bookmaker-markets.ts [bookmaker] [league]
 *   npx tsx src/scripts/analyze-bookmaker-markets.ts all premier-league
 *   npx tsx src/scripts/analyze-bookmaker-markets.ts superbet ekstraklasa
 */

import type { PolishBookmaker } from "../config/index.js";
import type { ScrapedMarket } from "../types/full-offer.js";
import { normalizeMarketsForBookmaker } from "../services/normalization/index.js";
import { NormalizedMarketType, NormalizedSelection } from "../types/normalization.js";
import {
  superbetScraper,
  etotoScraper,
  forbetScraper,
  lebullScraper,
  fuksiarzScraper,
  betfanScraper,
  totalbetScraper,
  betclicScraper,
  lvbetScraper,
  fortunaScraper,
  bettersScraper,
  pzbukScraper,
  stsScraper,
  betcrisScraper,
} from "../scrapers/bookmakers/index.js";
import { PlaywrightScraper } from "../scrapers/base/playwright-base.js";
import * as fs from "fs";
import * as path from "path";

// All scrapers
const SCRAPERS: Record<PolishBookmaker, PlaywrightScraper> = {
  superbet: superbetScraper,
  etoto: etotoScraper,
  forbet: forbetScraper,
  lebull: lebullScraper,
  fuksiarz: fuksiarzScraper,
  betfan: betfanScraper,
  totalbet: totalbetScraper,
  betclic: betclicScraper,
  lvbet: lvbetScraper,
  fortuna: fortunaScraper,
  betters: bettersScraper,
  pzbuk: pzbukScraper,
  sts: stsScraper,
  betcris: betcrisScraper,
};

interface MarketPattern {
  name: string;
  groupName?: string;
  type?: string;
  selections: string[];
  normalizedType?: string;
  marketKey?: string;
  count: number;
}

interface BookmakerAnalysis {
  bookmaker: PolishBookmaker;
  league: string;
  success: boolean;
  error?: string;
  matchCount: number;
  totalMarkets: number;
  // Normalization stats
  withMarketKey: number;
  withNormalizedType: number;
  withNormalizedSelections: number;
  otherTypeCount: number;
  coveragePercent: number;
  // Type distribution
  typeDistribution: Record<string, number>;
  // Unique patterns
  uniqueMarketNames: string[];
  uniqueSelectionNames: string[];
  // Sample markets (top 20 most common patterns)
  topPatterns: MarketPattern[];
  // Markets that couldn't be normalized (OTHER type)
  otherMarkets: MarketPattern[];
}

async function analyzeBookmaker(
  bookmaker: PolishBookmaker,
  league: string
): Promise<BookmakerAnalysis> {
  const scraper = SCRAPERS[bookmaker];

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Analyzing: ${bookmaker.toUpperCase()}`);
  console.log(`League: ${league}`);
  console.log(`${"=".repeat(60)}`);

  const analysis: BookmakerAnalysis = {
    bookmaker,
    league,
    success: false,
    matchCount: 0,
    totalMarkets: 0,
    withMarketKey: 0,
    withNormalizedType: 0,
    withNormalizedSelections: 0,
    otherTypeCount: 0,
    coveragePercent: 0,
    typeDistribution: {},
    uniqueMarketNames: [],
    uniqueSelectionNames: [],
    topPatterns: [],
    otherMarkets: [],
  };

  try {
    const result = await scraper.scrapeFullOffer(league);

    if (!result.success || result.matches.length === 0) {
      analysis.error = result.error || "No matches found";
      console.log(`❌ Failed: ${analysis.error}`);
      return analysis;
    }

    analysis.success = true;
    analysis.matchCount = result.matches.length;

    // Collect all markets from all matches
    const allMarkets: ScrapedMarket[] = [];
    for (const match of result.matches) {
      allMarkets.push(...match.markets);
    }
    analysis.totalMarkets = allMarkets.length;

    // Apply bookmaker-specific normalization
    const normalizedMarkets = normalizeMarketsForBookmaker(allMarkets, bookmaker);

    // Analyze patterns
    const marketNameCounts = new Map<string, MarketPattern>();
    const selectionNames = new Set<string>();

    for (const market of normalizedMarkets) {
      // Count market key
      if (market.marketKey) analysis.withMarketKey++;

      // Count normalized type
      if (market.normalizedType) {
        analysis.withNormalizedType++;
        analysis.typeDistribution[market.normalizedType] =
          (analysis.typeDistribution[market.normalizedType] || 0) + 1;
      }

      // Count normalized selections
      const normalizedSelCount = market.selections.filter(
        (s) => s.normalizedName && s.normalizedName !== NormalizedSelection.UNKNOWN
      ).length;
      if (normalizedSelCount > 0) analysis.withNormalizedSelections++;

      // Track unique patterns
      const patternKey = market.name;
      const existing = marketNameCounts.get(patternKey);
      if (existing) {
        existing.count++;
      } else {
        marketNameCounts.set(patternKey, {
          name: market.name,
          groupName: market.groupName,
          type: market.type,
          selections: market.selections.map((s) => s.name),
          normalizedType: market.normalizedType,
          marketKey: market.marketKey,
          count: 1,
        });
      }

      // Track selection names
      for (const sel of market.selections) {
        selectionNames.add(sel.name);
      }
    }

    // Calculate coverage
    analysis.otherTypeCount =
      analysis.typeDistribution[NormalizedMarketType.OTHER] || 0;
    analysis.coveragePercent =
      normalizedMarkets.length > 0
        ? ((normalizedMarkets.length - analysis.otherTypeCount) /
            normalizedMarkets.length) *
          100
        : 0;

    // Get unique names
    analysis.uniqueMarketNames = Array.from(marketNameCounts.keys()).sort();
    analysis.uniqueSelectionNames = Array.from(selectionNames).sort();

    // Get top patterns
    const sortedPatterns = Array.from(marketNameCounts.values()).sort(
      (a, b) => b.count - a.count
    );
    analysis.topPatterns = sortedPatterns.slice(0, 20);

    // Get OTHER markets (uncategorized)
    analysis.otherMarkets = sortedPatterns
      .filter((p) => p.normalizedType === NormalizedMarketType.OTHER)
      .slice(0, 15);

    // Print summary
    console.log(`✅ Success`);
    console.log(`   Matches: ${analysis.matchCount}`);
    console.log(`   Total markets: ${analysis.totalMarkets}`);
    console.log(
      `   With marketKey: ${analysis.withMarketKey} (${((analysis.withMarketKey / analysis.totalMarkets) * 100).toFixed(1)}%)`
    );
    console.log(
      `   Coverage (non-OTHER): ${analysis.coveragePercent.toFixed(1)}%`
    );
    console.log(`   Unique market names: ${analysis.uniqueMarketNames.length}`);
    console.log(`   Unique selection names: ${analysis.uniqueSelectionNames.length}`);

    // Print type distribution
    console.log(`\n   Type Distribution:`);
    const sortedTypes = Object.entries(analysis.typeDistribution).sort(
      (a, b) => b[1] - a[1]
    );
    for (const [type, count] of sortedTypes.slice(0, 10)) {
      const pct = ((count / analysis.totalMarkets) * 100).toFixed(1);
      console.log(`     ${type}: ${count} (${pct}%)`);
    }

    // Print sample OTHER markets (need to be normalized)
    if (analysis.otherMarkets.length > 0) {
      console.log(`\n   ⚠️ Uncategorized markets (OTHER) - Total unique: ${analysis.otherMarkets.length}:`);
      for (const pattern of analysis.otherMarkets.slice(0, 50)) {
        console.log(`     - "${pattern.name}" (${pattern.count}x)`);
      }
    }
  } catch (error) {
    analysis.error = error instanceof Error ? error.message : String(error);
    console.log(`❌ Error: ${analysis.error}`);
  } finally {
    await scraper.cleanup();
  }

  return analysis;
}

async function analyzeAllBookmakers(league: string): Promise<void> {
  const bookmakers = Object.keys(SCRAPERS) as PolishBookmaker[];
  const results: BookmakerAnalysis[] = [];

  console.log(`\n${"#".repeat(60)}`);
  console.log(`# BOOKMAKER MARKET ANALYSIS`);
  console.log(`# League: ${league}`);
  console.log(`# Bookmakers: ${bookmakers.length}`);
  console.log(`${"#".repeat(60)}`);

  for (const bookmaker of bookmakers) {
    const analysis = await analyzeBookmaker(bookmaker, league);
    results.push(analysis);
  }

  // Print summary table
  console.log(`\n${"#".repeat(60)}`);
  console.log(`# SUMMARY`);
  console.log(`${"#".repeat(60)}\n`);

  console.log(
    `${"Bookmaker".padEnd(12)} | ${"Status".padEnd(8)} | ${"Markets".padEnd(8)} | ${"Coverage".padEnd(10)} | ${"OTHER".padEnd(6)} | Unique Names`
  );
  console.log(`${"─".repeat(80)}`);

  for (const r of results) {
    const status = r.success ? "✅ OK" : "❌ FAIL";
    const markets = r.success ? String(r.totalMarkets) : "-";
    const coverage = r.success ? `${r.coveragePercent.toFixed(1)}%` : "-";
    const other = r.success ? String(r.otherTypeCount) : "-";
    const unique = r.success ? String(r.uniqueMarketNames.length) : "-";

    console.log(
      `${r.bookmaker.padEnd(12)} | ${status.padEnd(8)} | ${markets.padEnd(8)} | ${coverage.padEnd(10)} | ${other.padEnd(6)} | ${unique}`
    );
  }
  console.log(`${"─".repeat(80)}`);

  // Save detailed results to JSON
  const outputPath = path.join(
    process.cwd(),
    "data",
    `bookmaker-analysis-${league}-${Date.now()}.json`
  );

  try {
    // Ensure data directory exists
    const dataDir = path.dirname(outputPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n📊 Detailed results saved to: ${outputPath}`);
  } catch (error) {
    console.log(`\n⚠️ Could not save results: ${error}`);
  }

  // Print recommendations
  console.log(`\n${"#".repeat(60)}`);
  console.log(`# RECOMMENDATIONS`);
  console.log(`${"#".repeat(60)}\n`);

  const lowCoverage = results.filter((r) => r.success && r.coveragePercent < 70);
  if (lowCoverage.length > 0) {
    console.log(`⚠️ Bookmakers with low coverage (< 70%):`);
    for (const r of lowCoverage) {
      console.log(`   - ${r.bookmaker}: ${r.coveragePercent.toFixed(1)}%`);
      console.log(`     Top OTHER markets to normalize:`);
      for (const pattern of r.otherMarkets.slice(0, 3)) {
        console.log(`       "${pattern.name}" (${pattern.count}x)`);
      }
    }
  } else {
    console.log(`✅ All bookmakers have good coverage (≥70%)`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const bookmakerArg = args[0];
  const league = args[1] || "premier-league";

  if (bookmakerArg && bookmakerArg !== "all" && SCRAPERS[bookmakerArg as PolishBookmaker]) {
    // Single bookmaker
    await analyzeBookmaker(bookmakerArg as PolishBookmaker, league);
  } else if (bookmakerArg === "all" || !bookmakerArg) {
    // All bookmakers
    await analyzeAllBookmakers(league);
  } else {
    console.log(`Unknown bookmaker: ${bookmakerArg}`);
    console.log(`Available: ${Object.keys(SCRAPERS).join(", ")}, all`);
    console.log(`\nUsage: npx tsx src/scripts/analyze-bookmaker-markets.ts [bookmaker] [league]`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("Analysis failed:", error);
  process.exit(1);
});
