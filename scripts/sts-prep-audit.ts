#!/usr/bin/env npx tsx
/**
 * STS audit data prep.
 *
 * Drives a Playwright WebSocket capture of one STS match, runs the raw markets
 * through the STS normalizer, computes mechanical flags, expands catalog
 * families, and writes the intermediate JSON consumed by /audit-sts:
 *   docs/sts-audit/.tmp/<fixtureId>.json  — PrepAuditOutput (gitignored)
 *
 * The stdout summary echoes the eventUrl so the orchestrator can pass it to the
 * fixer for online (re-scrape) verification.
 *
 * Usage:
 *   npx tsx scripts/sts-prep-audit.ts --url "<sts event url>" [--league <slug>] [--home "<team>"] [--away "<team>"]
 */
import { chromium } from "playwright";
import {
  navigateAndCaptureMatchData,
  extractFixtureIdFromUrl,
} from "../src/scrapers/bookmakers/sts/navigation.js";
import {
  parseWebSocketJson,
  parseFixtures,
  parseAllMarkets,
} from "../src/scrapers/bookmakers/sts/parser.js";
import { stsNormalizer } from "../src/services/normalization/bookmakers/sts-normalizer.js";
import { getMarketByCode } from "../src/data/market-catalog.js";
import { isSelectionOrphan, HANDICAP_CODES } from "../src/services/sts-audit/selection-checks.js";
import { getRelatedCodes } from "../src/services/sts-audit/family-codes.js";
import { detectParamFormatSts } from "../src/services/sts-audit/param-format.js";
import type {
  PrepAuditOutput,
  PrepMarketEntry,
  MechanicalFlags,
  MatchContextRow,
  CatalogEntrySnapshot,
} from "../src/services/sts-audit/types.js";
import type {
  NormalizationContext,
  RawBookmakerMarket,
} from "../src/services/normalization/types.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

interface Args {
  url: string;
  league: string;
  home?: string;
  away?: string;
  out?: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i < argv.length - 1 ? argv[i + 1] : undefined;
  };
  const url = get("--url");
  if (!url) {
    console.error(
      "Usage: --url <sts event url> [--league <slug>] [--home <team>] [--away <team>] [--out <path>]",
    );
    process.exit(1);
  }
  return { url, league: get("--league") ?? "unknown", home: get("--home"), away: get("--away"), out: get("--out") };
}

async function main() {
  const args = parseArgs();
  const fixtureId = extractFixtureIdFromUrl(args.url);
  if (!fixtureId) {
    console.error(`[sts-prep] Could not extract fixtureId from URL: ${args.url}`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const capture = await navigateAndCaptureMatchData(page, args.url);
    if (!capture) {
      console.error("[sts-prep] WebSocket capture returned null");
      process.exit(1);
    }

    const initialJson = parseWebSocketJson(capture.initialData);
    const fixtureJson = capture.fixtureData.get(fixtureId) ?? null;
    if (!initialJson && !fixtureJson) {
      console.error("[sts-prep] No parseable WebSocket data");
      process.exit(1);
    }

    // Resolve the fixture object (needed by parseAllMarkets) from the initial list.
    const fixtures = initialJson ? parseFixtures(initialJson, args.league) : [];
    const fixture = fixtures.find((f) => f.id === fixtureId) ?? fixtures[0];
    if (!fixture) {
      console.error(`[sts-prep] Fixture ${fixtureId} not found in league ${args.league} list`);
      process.exit(1);
    }

    const homeTeam = args.home ?? fixture.home;
    const awayTeam = args.away ?? fixture.away;

    const scraped = parseAllMarkets(fixture, fixtureJson, initialJson);
    console.error(`[sts-prep] fixture=${fixtureId} ${homeTeam} vs ${awayTeam} (${args.league}) markets=${scraped.length}`);

    const ctx: NormalizationContext = {
      homeTeam,
      awayTeam,
      leagueName: args.league,
      // Mirror production: the selection mapper reads ctx.league for Polish->canonical resolution.
      league: args.league,
    };

    // First pass: normalize everything so we can detect collisions and build match context.
    type Pass1 = {
      raw: (typeof scraped)[number];
      normalized: ReturnType<typeof stsNormalizer.normalizeMarket>;
    };
    const pass1: Pass1[] = scraped.map((raw) => {
      const forNorm: RawBookmakerMarket = {
        bookmakerMarketId: raw.bookmakerMarketId,
        name: raw.name,
        groupName: raw.groupName,
        paramValue: raw.paramValue,
        selections: raw.selections.map((s) => ({ name: s.name, odds: s.odds })),
      };
      return { raw, normalized: stsNormalizer.normalizeMarket(forNorm, ctx) };
    });

    const keyCounts = new Map<string, number>();
    for (const { normalized } of pass1) {
      if (!normalized || normalized.marketCode === "OTHER") continue;
      keyCounts.set(normalized.marketKey, (keyCounts.get(normalized.marketKey) ?? 0) + 1);
    }

    let recognized = 0;
    let unrecognized = 0;
    const matchContext: MatchContextRow[] = [];
    const markets: PrepMarketEntry[] = [];

    pass1.forEach(({ raw, normalized }, index) => {
      if (!normalized || normalized.marketCode === "OTHER") {
        unrecognized++;
      } else {
        recognized++;
      }

      matchContext.push({
        raw_name: raw.name,
        marketCode: normalized?.marketCode ?? "OTHER",
        selection_count: raw.selections.length,
        paramValue: normalized?.paramValue ?? null,
      });

      const catalogEntry =
        normalized && normalized.marketCode !== "OTHER" ? getMarketByCode(normalized.marketCode) : undefined;

      const catalogSnapshot: CatalogEntrySnapshot | null = catalogEntry
        ? {
            code: catalogEntry.code,
            labels: { pl: catalogEntry.labels.pl },
            selections: catalogEntry.selections,
            viewType: catalogEntry.viewType,
            hasParameter: catalogEntry.hasParameter,
          }
        : null;

      // Mechanical flags
      const unknownSelections = normalized?.selections.filter((s) => s.code === "UNKNOWN") ?? [];
      const orphanCodes: string[] = [];
      for (const sel of normalized?.selections ?? []) {
        if (sel.code !== "UNKNOWN" && isSelectionOrphan(sel.code as string, catalogEntry)) {
          orphanCodes.push(sel.code as string);
        }
      }

      const codeOccurrences = new Map<string, number>();
      for (const sel of normalized?.selections ?? []) {
        codeOccurrences.set(sel.code as string, (codeOccurrences.get(sel.code as string) ?? 0) + 1);
      }
      const hasMultipleParams = (normalized?.parameters?.length ?? 0) > 1;
      const isHandicap = normalized ? HANDICAP_CODES.has(normalized.marketCode) : false;
      let duplicateCodes = false;
      for (const [code, count] of codeOccurrences) {
        if (count <= 1) continue;
        if (code === "UNKNOWN") continue;
        if (code === "PLAYER_PAIR" || code === "PLAYER_TRIO") continue;
        if (hasMultipleParams) continue;
        if (isHandicap) continue;
        duplicateCodes = true;
        break;
      }

      const countMismatch = (normalized?.selections.length ?? 0) !== raw.selections.length;

      const hasTeamParam =
        normalized?.paramValue === "HOME" ||
        normalized?.paramValue === "AWAY" ||
        normalized?.paramValue?.startsWith("HOME:") ||
        normalized?.paramValue?.startsWith("AWAY:");
      let missingExpected = false;
      if (
        catalogEntry &&
        catalogEntry.selections.length > 0 &&
        catalogEntry.selections.length <= 4 &&
        catalogEntry.parameterType !== "player" &&
        !hasMultipleParams &&
        !hasTeamParam
      ) {
        const receivedCodes = new Set(
          (normalized?.selections ?? []).map((s) => s.code as string).filter((c) => c !== "UNKNOWN"),
        );
        const missing = catalogEntry.selections.filter((c) => !receivedCodes.has(c));
        if (missing.length > 0 && missing.length >= catalogEntry.selections.length) {
          missingExpected = true;
        }
      }

      const collisionFlag =
        normalized && normalized.marketCode !== "OTHER" ? (keyCounts.get(normalized.marketKey) ?? 0) > 1 : false;

      const labelSet = new Set(raw.selections.map((s) => s.name));
      const oddsValues = raw.selections.map((s) => s.odds);

      const mechanicalFlags: MechanicalFlags = {
        recognized: !!normalized && normalized.marketCode !== "OTHER",
        collision: collisionFlag,
        unknown_count: unknownSelections.length,
        orphan_codes: orphanCodes,
        duplicate_codes: duplicateCodes,
        count_mismatch: countMismatch,
        missing_expected: missingExpected,
        selection_label_count: labelSet.size,
        selection_odds_range: {
          min: oddsValues.length > 0 ? Math.min(...oddsValues) : 0,
          max: oddsValues.length > 0 ? Math.max(...oddsValues) : 0,
        },
        param_format: detectParamFormatSts(normalized?.paramValue),
      };

      const relatedCodes =
        normalized && normalized.marketCode !== "OTHER" ? getRelatedCodes(normalized.marketCode) : [];

      markets.push({
        index,
        raw: {
          name: raw.name,
          groupName: raw.groupName ?? "",
          groupId: "",
          bookmakerMarketId: String(raw.bookmakerMarketId ?? ""),
          selections: raw.selections.map((s) => ({ name: s.name, odds: s.odds })),
        },
        normalized: {
          marketCode: normalized?.marketCode ?? "OTHER",
          marketKey: normalized?.marketKey ?? "OTHER",
          paramValue: normalized?.paramValue ?? null,
          matchedBy: normalized?.debug?.matchedBy ?? null,
          selections:
            normalized?.selections.map((s) => ({
              label: s.label,
              code: s.code as string,
              odds: s.odds,
            })) ?? [],
        },
        catalogEntry: catalogSnapshot,
        relatedCodes,
        mechanicalFlags,
      });
    });

    const outPath = args.out ?? resolve(process.cwd(), `../docs/sts-audit/.tmp/${fixtureId}.json`);
    const output: PrepAuditOutput = {
      meta: {
        matchId: fixtureId,
        homeTeam,
        awayTeam,
        league: args.league,
        fetchedAt: new Date().toISOString(),
        rawAllTabs: scraped.length,
        rawDeduped: scraped.length,
        recognized,
        unrecognized,
      },
      matchContext,
      markets,
    };
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");

    console.error(`[sts-prep] Wrote ${outPath}`);
    console.log(
      JSON.stringify(
        {
          fixtureId,
          eventUrl: args.url,
          outputPath: outPath,
          rawDeduped: scraped.length,
          recognized,
          unrecognized,
          homeTeam,
          awayTeam,
          league: args.league,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[sts-prep] FAILED:", err);
  process.exit(1);
});
