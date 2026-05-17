#!/usr/bin/env npx tsx
/**
 * Betclic audit data prep.
 *
 * Fetches raw markets via Betclic gRPC, runs them through the normalizer,
 * computes mechanical flags, expands catalog families, and writes a single
 * JSON file consumed by the /audit-betclic orchestrator.
 *
 * Output: docs/betclic-audit/.tmp/<matchId>.json (gitignored)
 *
 * Usage:
 *   npx tsx scripts/betclic-prep-audit.ts --match <id> --home "<team>" --away "<team>" --league <slug>
 */
import { fetchAllMarketGroups } from "../src/scrapers/bookmakers/betclic/navigation.js";
import {
  parseAllMarketsFromProto,
  parseAllMarketsFromMultipleResponses,
} from "../src/scrapers/bookmakers/betclic/parser.js";
import { betclicNormalizer } from "../src/services/normalization/bookmakers/betclic-normalizer.js";
import { MARKET_CATALOG, getMarketByCode } from "../src/data/market-catalog.js";
import { isSelectionOrphan } from "../src/services/audit/selection-checks.js";
import { getRelatedCodes } from "../src/services/audit/family-codes.js";
import type {
  PrepAuditOutput,
  PrepMarketEntry,
  MechanicalFlags,
  MatchContextRow,
  CatalogEntrySnapshot,
} from "../src/services/audit/types.js";
import type {
  NormalizationContext,
  RawBookmakerMarket,
} from "../src/services/normalization/types.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

interface Args {
  matchId: string;
  home: string;
  away: string;
  league: string;
  out: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i < 0 || i === argv.length - 1) return undefined;
    return argv[i + 1];
  };
  const matchId = get("--match");
  const home = get("--home");
  const away = get("--away");
  const league = get("--league") ?? "unknown";
  const out =
    get("--out") ??
    resolve(process.cwd(), `../docs/betclic-audit/.tmp/${matchId ?? "unknown"}.json`);
  if (!matchId || !home || !away) {
    console.error("Usage: --match <id> --home <team> --away <team> [--league <slug>] [--out <path>]");
    process.exit(1);
  }
  return { matchId, home, away, league, out };
}

const HANDICAP_CODES = new Set([
  "ASIAN_HANDICAP", "ASIAN_HANDICAP_3WAY", "ASIAN_HANDICAP_PUSH",
  "EUROPEAN_HANDICAP",
  "FIRST_HALF_ASIAN_HANDICAP", "FIRST_HALF_ASIAN_HANDICAP_PUSH",
  "SECOND_HALF_ASIAN_HANDICAP", "SECOND_HALF_ASIAN_HANDICAP_PUSH",
  "FIRST_HALF_EUROPEAN_HANDICAP", "SECOND_HALF_EUROPEAN_HANDICAP",
  "CORNERS_HANDICAP", "HALF_TIME_CORNERS_HANDICAP",
]);

function detectParamFormat(paramValue: string | null | undefined): MechanicalFlags["param_format"] {
  if (!paramValue) return "none";
  if (paramValue === "HOME" || paramValue === "AWAY" ||
      paramValue.startsWith("HOME:") || paramValue.startsWith("AWAY:")) return "team_side";
  if (/^-?\d+$/.test(paramValue)) return "signed_integer";
  if (paramValue.includes(",")) return "decimal_comma";
  if (paramValue.includes(".")) return "decimal_dot";
  return "none";
}

async function main() {
  const args = parseArgs();
  console.error(`[prep-audit] match=${args.matchId} ${args.home} vs ${args.away} (${args.league})`);

  const responses = await fetchAllMarketGroups(args.matchId);
  console.error(`[prep-audit] Fetched ${responses.length} tab responses`);

  // Raw all-tabs count (no dedup) — for reporting only.
  let rawAllTabs = 0;
  for (const buf of responses) {
    if (!buf || buf.length === 0) continue;
    try {
      rawAllTabs += parseAllMarketsFromProto(buf).length;
    } catch (e) {
      console.warn(`[prep-audit] Error parsing tab:`, e);
    }
  }

  const rawDeduped = parseAllMarketsFromMultipleResponses(responses);
  console.error(`[prep-audit] rawAllTabs=${rawAllTabs} rawDeduped=${rawDeduped.length}`);

  const ctx: NormalizationContext = {
    homeTeam: args.home,
    awayTeam: args.away,
    leagueName: args.league,
  };

  // First pass: normalize everything so we can detect collisions and build match context.
  type Pass1 = {
    raw: typeof rawDeduped[number];
    normalized: ReturnType<typeof betclicNormalizer.normalizeMarket>;
  };
  const pass1: Pass1[] = rawDeduped.map((raw) => {
    const forNorm: RawBookmakerMarket = {
      bookmakerMarketId: raw.bookmakerMarketId,
      name: raw.name,
      groupName: raw.groupName,
      paramValue: raw.paramValue,
      selections: raw.selections.map((s) => ({ name: s.name, odds: s.odds })),
    };
    return { raw, normalized: betclicNormalizer.normalizeMarket(forNorm, ctx) };
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

    const catalogEntry = normalized && normalized.marketCode !== "OTHER"
      ? getMarketByCode(normalized.marketCode)
      : undefined;

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

    // Duplicate detection with same exemptions as betclic-selections-audit.ts
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

    // Missing expected — same exemptions as betclic-selections-audit.ts
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
        (normalized?.selections ?? [])
          .map((s) => s.code as string)
          .filter((c) => c !== "UNKNOWN"),
      );
      const missing = catalogEntry.selections.filter((c) => !receivedCodes.has(c));
      if (missing.length > 0 && missing.length >= catalogEntry.selections.length) {
        missingExpected = true;
      }
    }

    const collisionFlag =
      normalized && normalized.marketCode !== "OTHER"
        ? (keyCounts.get(normalized.marketKey) ?? 0) > 1
        : false;

    const labelSet = new Set(raw.selections.map((s) => s.name));
    const oddsValues = raw.selections.map((s) => s.odds);
    const oddsMin = oddsValues.length > 0 ? Math.min(...oddsValues) : 0;
    const oddsMax = oddsValues.length > 0 ? Math.max(...oddsValues) : 0;

    const mechanicalFlags: MechanicalFlags = {
      recognized: !!normalized && normalized.marketCode !== "OTHER",
      collision: collisionFlag,
      unknown_count: unknownSelections.length,
      orphan_codes: orphanCodes,
      duplicate_codes: duplicateCodes,
      count_mismatch: countMismatch,
      missing_expected: missingExpected,
      selection_label_count: labelSet.size,
      selection_odds_range: { min: oddsMin, max: oddsMax },
      param_format: detectParamFormat(normalized?.paramValue),
    };

    const relatedCodes = normalized && normalized.marketCode !== "OTHER"
      ? getRelatedCodes(normalized.marketCode)
      : [];

    markets.push({
      index,
      raw: {
        name: raw.name,
        groupName: raw.groupName ?? "",
        groupId: (raw as { groupId?: string }).groupId ?? "",
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

  const output: PrepAuditOutput = {
    meta: {
      matchId: args.matchId,
      homeTeam: args.home,
      awayTeam: args.away,
      league: args.league,
      fetchedAt: new Date().toISOString(),
      rawAllTabs,
      rawDeduped: rawDeduped.length,
      recognized,
      unrecognized,
    },
    matchContext,
    markets,
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(output, null, 2), "utf8");

  console.error(`[prep-audit] Wrote ${args.out}`);
  console.log(JSON.stringify({
    matchId: args.matchId,
    outputPath: args.out,
    rawAllTabs,
    rawDeduped: rawDeduped.length,
    recognized,
    unrecognized,
  }, null, 2));
}

main().catch((err) => {
  console.error("[prep-audit] FAILED:", err);
  process.exit(1);
});
