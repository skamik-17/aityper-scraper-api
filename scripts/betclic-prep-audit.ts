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
 *   npx tsx scripts/betclic-prep-audit.ts --match <id> [--home "<team>"] [--away "<team>"] [--league <slug>]
 *   When --home/--away are omitted, team names are auto-extracted from the first gRPC response.
 */
import { fetchAllMarketGroups } from "../src/scrapers/bookmakers/betclic/navigation.js";
import {
  parseAllMarketsFromProto,
  parseAllMarketsFromMultipleResponses,
} from "../src/scrapers/bookmakers/betclic/parser.js";
import { betclicNormalizer } from "../src/services/normalization/bookmakers/betclic-normalizer.js";
import { MARKET_CATALOG, getMarketByCode } from "../src/data/market-catalog.js";
import { isSelectionOrphan, HANDICAP_CODES } from "../src/services/audit/selection-checks.js";
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

// Inlined protobuf utilities (duplicated from betclic-market-discovery.ts; small refactor target).

interface RawField {
  fieldNumber: number;
  wireType: number;
  value: number | bigint | string | Buffer | RawField[];
}

function readVarint(buf: Buffer, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  while (offset + bytesRead < buf.length) {
    const b = buf[offset + bytesRead++];
    value |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return { value, bytesRead };
}

function readVarintBigInt(buf: Buffer, offset: number): { value: bigint; bytesRead: number } {
  let value = 0n;
  let shift = 0n;
  let bytesRead = 0;
  while (offset + bytesRead < buf.length) {
    const b = buf[offset + bytesRead++];
    value |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7n;
  }
  return { value, bytesRead };
}

function tryDecodeString(buf: Buffer): string | null {
  try {
    const str = buf.toString("utf8");
    if (/^[\x20-\x7E\xA0-\xFFĀ-￿\s]+$/.test(str) && str.length > 0) {
      return str;
    }
    return null;
  } catch {
    return null;
  }
}

function parseProtobuf(buf: Buffer, depth: number = 0): RawField[] {
  const fields: RawField[] = [];
  let offset = 0;
  const maxDepth = 15;
  while (offset < buf.length) {
    const tagResult = readVarint(buf, offset);
    if (tagResult.bytesRead === 0) break;
    offset += tagResult.bytesRead;
    const fieldNumber = tagResult.value >> 3;
    const wireType = tagResult.value & 0x07;
    if (fieldNumber === 0 || fieldNumber > 536870911) break;
    let value: number | bigint | string | Buffer | RawField[];
    if (wireType === 0) {
      const result = readVarintBigInt(buf, offset);
      offset += result.bytesRead;
      value = result.value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result.value) : result.value;
    } else if (wireType === 1) {
      if (offset + 8 > buf.length) break;
      value = buf.readDoubleLE(offset);
      offset += 8;
    } else if (wireType === 2) {
      const lenResult = readVarint(buf, offset);
      offset += lenResult.bytesRead;
      const len = lenResult.value;
      if (offset + len > buf.length) break;
      const data = buf.slice(offset, offset + len);
      offset += len;
      const str = tryDecodeString(data);
      if (str !== null) {
        value = str;
      } else if (depth < maxDepth) {
        const nested = parseProtobuf(data, depth + 1);
        value = nested.length > 0 ? nested : data;
      } else {
        value = data;
      }
    } else if (wireType === 5) {
      if (offset + 4 > buf.length) break;
      value = buf.readFloatLE(offset);
      offset += 4;
    } else {
      break;
    }
    fields.push({ fieldNumber, wireType, value });
  }
  return fields;
}

function getField(fields: RawField[], num: number): RawField | undefined {
  return fields.find((f) => f.fieldNumber === num);
}

function getAllFields(fields: RawField[], num: number): RawField[] {
  return fields.filter((f) => f.fieldNumber === num);
}

async function extractTeamsFromFirstResponse(
  responses: Buffer[],
): Promise<{ home: string; away: string } | null> {
  for (const buf of responses) {
    if (!buf || buf.length === 0) continue;
    try {
      const root = parseProtobuf(buf);
      const wrapper = root.find((f) => f.fieldNumber === 1);
      if (!wrapper || !Array.isArray(wrapper.value)) continue;
      const matchField = (wrapper.value as RawField[]).find((f) => f.fieldNumber === 1);
      if (!matchField || !Array.isArray(matchField.value)) continue;
      const nameField = (matchField.value as RawField[]).find((f) => f.fieldNumber === 2);
      if (nameField?.wireType !== 2 || typeof nameField.value !== "string") continue;
      const [home, away] = nameField.value.split(" - ").map((s) => s.trim());
      if (home && away) return { home, away };
    } catch {
      // Skip malformed buffers; try next response.
    }
  }
  return null;
}

// End of inlined protobuf utilities.

interface Args {
  matchId: string;
  home: string;
  away: string;
  league: string;
  out: string;
}

function parseArgs(): Omit<Args, "home" | "away"> & { home?: string; away?: string } {
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
  if (!matchId) {
    console.error("Usage: --match <id> [--home <team>] [--away <team>] [--league <slug>] [--out <path>]");
    process.exit(1);
  }
  return { matchId, home, away, league, out };
}


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
  const rawArgs = parseArgs();

  const responses = await fetchAllMarketGroups(rawArgs.matchId);

  // Resolve team names: use explicit args if provided, otherwise extract from gRPC response.
  let resolvedHome = rawArgs.home;
  let resolvedAway = rawArgs.away;
  if (!resolvedHome || !resolvedAway) {
    const extracted = await extractTeamsFromFirstResponse(responses);
    resolvedHome = resolvedHome ?? extracted?.home ?? "Unknown Home";
    resolvedAway = resolvedAway ?? extracted?.away ?? "Unknown Away";
  }

  const args: Args = {
    matchId: rawArgs.matchId,
    home: resolvedHome,
    away: resolvedAway,
    league: rawArgs.league,
    out: rawArgs.out,
  };

  console.error(`[prep-audit] match=${args.matchId} ${args.home} vs ${args.away} (${args.league})`);
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
