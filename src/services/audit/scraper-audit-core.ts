/**
 * Generic scraper-based audit core.
 *
 * Shared engine for the per-bookmaker audit flow of HTML/Playwright bookmakers
 * (fortuna, superbet, lvbet, fuksiarz, betcris, betfan, betters, etoto, forbet,
 * lebull, pzbuk, totalbet). STS (WebSocket) and Betclic (gRPC) keep their own
 * bespoke prep/discovery scripts because their raw-market capture differs.
 *
 * Every supported scraper exposes the base `scrapeFullOffer(league)` method,
 * which returns `FullMatchOffer[]` with rich `markets: ScrapedMarket[]` carrying
 * RAW bookmaker market names + selections. We scrape one league, pick the target
 * match by event URL, and re-run those raw markets through the bookmaker's
 * normalizer — mirroring production normalization — to produce the same
 * `PrepAuditOutput` the STS/Betclic prep scripts emit, plus a discovery view
 * (RAW vs FRONTEND JSON) used by the fixer's view_type verification.
 *
 * This module is bookmaker-agnostic: callers inject the scraper instance and the
 * normalizer. It performs no file I/O of its own beyond what the thin
 * per-bookmaker wrapper scripts ask for.
 */
import { getMarketByCode, type MarketCatalogEntry } from "../../data/market-catalog.js";
import { groupMarketsByTypeWithParameters } from "../market-type-grouper.js";
import { isSelectionOrphan, HANDICAP_CODES } from "./selection-checks.js";
import { getRelatedCodes } from "./family-codes.js";
import type {
  PrepAuditOutput,
  PrepMarketEntry,
  MechanicalFlags,
  MatchContextRow,
  CatalogEntrySnapshot,
} from "./types.js";
import type {
  BookmakerMarketNormalizer,
  NormalizationContext,
  RawBookmakerMarket,
} from "../normalization/types.js";
import type { ScrapedMarket, MarketSelection, FullMatchOffer } from "../../types/full-offer.js";

// ---------------------------------------------------------------------------
// Scraper interface (structural — avoids importing concrete scraper classes)
// ---------------------------------------------------------------------------

export interface FullOfferCapableScraper {
  bookmaker: string;
  scrapeFullOffer(league: string): Promise<{
    success: boolean;
    matches: FullMatchOffer[];
    error?: string;
  }>;
}

/** A raw market in the shape the normalizer + audit pass consume. */
export interface RawAuditMarket {
  name: string;
  groupName?: string;
  bookmakerMarketId?: string;
  paramValue?: string;
  selections: { name: string; odds: number }[];
}

// ---------------------------------------------------------------------------
// Match selection from a full-offer scrape
// ---------------------------------------------------------------------------

/** Last run of digits in a URL — used as a loose fixture identifier for matching. */
function extractIdFromUrl(url: string): string | null {
  const matches = url.match(/(\d{4,})/g);
  return matches && matches.length > 0 ? matches[matches.length - 1] : null;
}

/**
 * Slug tokens from a URL's final path segment (query stripped). E.g.
 * ".../fifa-world-cup/norwegia-francja?tab=offer" -> ["norwegia", "francja"].
 * Used to match a user-supplied URL (Polish slug) against a scraped eventUrl
 * whose team names may be canonicalized differently.
 */
function extractSlugTokens(url: string): string[] {
  const path = url.split("?")[0].replace(/\/+$/, "");
  const lastSegment = path.substring(path.lastIndexOf("/") + 1);
  return lastSegment
    .toLowerCase()
    .split(/[-_]/)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t));
}

function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Scrape one league's full offer and return the single match matching `eventUrl`.
 * Falls back to fixture-id substring, then to home/away team names.
 */
export async function scrapeOneMatchFullOffer(
  scraper: FullOfferCapableScraper,
  league: string,
  eventUrl: string,
  hint?: { home?: string; away?: string },
): Promise<FullMatchOffer | null> {
  const result = await scraper.scrapeFullOffer(league);
  if (!result.success || result.matches.length === 0) {
    console.error(
      `[audit-core] scrapeFullOffer(${league}) failed or empty: ${result.error ?? "no matches"}`,
    );
    return null;
  }

  // 1. Exact event URL.
  let match = result.matches.find((m) => m.eventUrl === eventUrl);
  if (match) return match;

  // 2. Fixture id substring.
  const targetId = extractIdFromUrl(eventUrl);
  if (targetId) {
    match = result.matches.find(
      (m) => m.eventUrl.includes(targetId) || (m.matchId && String(m.matchId).includes(targetId)),
    );
    if (match) return match;
  }

  // 3. URL slug tokens (handles Polish slug vs canonicalized team names).
  const slugTokens = extractSlugTokens(eventUrl);
  if (slugTokens.length > 0) {
    match = result.matches.find((m) => {
      const hay = m.eventUrl.toLowerCase();
      return slugTokens.every((t) => hay.includes(t));
    });
    if (match) return match;
  }

  // 4. Home/away team names.
  const wantHome = hint?.home ? normalizeTeam(hint.home) : null;
  const wantAway = hint?.away ? normalizeTeam(hint.away) : null;
  if (wantHome && wantAway) {
    match = result.matches.find(
      (m) =>
        normalizeTeam(m.homeTeam).includes(wantHome) &&
        normalizeTeam(m.awayTeam).includes(wantAway),
    );
    if (match) return match;
  }

  console.error(
    `[audit-core] No match in ${league} offer matched url=${eventUrl} (${result.matches.length} candidates).`,
  );
  console.error(
    `[audit-core] Sample eventUrls: ${result.matches.slice(0, 5).map((m) => m.eventUrl).join("  |  ")}`,
  );
  return null;
}

/** Convert rich ScrapedMarket[] from a full-offer scrape into raw audit markets. */
export function scrapedMarketsToRaw(markets: ScrapedMarket[]): RawAuditMarket[] {
  return markets.map((m) => ({
    name: m.name,
    groupName: m.groupName,
    bookmakerMarketId: m.bookmakerMarketId ? String(m.bookmakerMarketId) : undefined,
    paramValue: m.paramValue,
    selections: m.selections.map((s) => ({ name: s.name, odds: s.odds })),
  }));
}

/** Collapse duplicate raw markets by (name, paramValue, sorted selection names). */
export function dedupeRawMarkets(markets: RawAuditMarket[]): RawAuditMarket[] {
  const seen = new Set<string>();
  const out: RawAuditMarket[] = [];
  for (const mkt of markets) {
    const sels = mkt.selections.map((s) => s.name).sort().join("|");
    const key = `${mkt.name} ${mkt.paramValue ?? ""} ${sels}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mkt);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mechanical flags (shared with betclic-prep-audit.ts logic)
// ---------------------------------------------------------------------------

export function detectParamFormat(
  paramValue: string | null | undefined,
): MechanicalFlags["param_format"] {
  if (!paramValue) return "none";
  if (
    paramValue === "HOME" ||
    paramValue === "AWAY" ||
    paramValue.startsWith("HOME:") ||
    paramValue.startsWith("AWAY:")
  )
    return "team_side";
  if (/^-?\d+$/.test(paramValue)) return "signed_integer";
  if (paramValue.includes(",")) return "decimal_comma";
  if (paramValue.includes(".")) return "decimal_dot";
  return "none";
}

// ---------------------------------------------------------------------------
// Prep-audit output builder (bookmaker-agnostic)
// ---------------------------------------------------------------------------

export interface BuildPrepOptions {
  normalizer: BookmakerMarketNormalizer;
  ctx: NormalizationContext;
  rawMarkets: RawAuditMarket[];
  meta: {
    matchId: string;
    homeTeam: string;
    awayTeam: string;
    league: string;
  };
}

export function buildPrepAuditOutput(opts: BuildPrepOptions): PrepAuditOutput {
  const { normalizer, ctx, rawMarkets, meta } = opts;

  type Pass1 = {
    raw: RawAuditMarket;
    normalized: ReturnType<BookmakerMarketNormalizer["normalizeMarket"]>;
  };
  const pass1: Pass1[] = rawMarkets.map((raw) => {
    const forNorm: RawBookmakerMarket = {
      bookmakerMarketId: raw.bookmakerMarketId,
      name: raw.name,
      groupName: raw.groupName,
      paramValue: raw.paramValue,
      selections: raw.selections.map((s) => ({ name: s.name, odds: s.odds })),
    };
    return { raw, normalized: normalizer.normalizeMarket(forNorm, ctx) };
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
      normalized && normalized.marketCode !== "OTHER"
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

    const relatedCodes =
      normalized && normalized.marketCode !== "OTHER"
        ? getRelatedCodes(normalized.marketCode)
        : [];

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

  return {
    meta: {
      matchId: meta.matchId,
      homeTeam: meta.homeTeam,
      awayTeam: meta.awayTeam,
      league: meta.league,
      fetchedAt: new Date().toISOString(),
      rawAllTabs: rawMarkets.length,
      rawDeduped: rawMarkets.length,
      recognized,
      unrecognized,
    },
    matchContext,
    markets,
  };
}

// ---------------------------------------------------------------------------
// Discovery analysis (RAW vs FRONTEND JSON) — used by the fixer's verify step
// ---------------------------------------------------------------------------

interface MarketAnalysis {
  name: string;
  bookmakerMarketId: string;
  groupName: string;
  rawSelections: { name: string; odds: number }[];
  normalized: ReturnType<BookmakerMarketNormalizer["normalizeMarket"]>;
  catalogEntry?: MarketCatalogEntry;
  issues: string[];
}

const OVER_UNDER_SELECTION_PATTERN = /^(Powyżej|Poniżej)\s+(\d+[,\.]\d+)$/i;

function splitSelectionsByLine(
  selections: { name: string; odds: number }[],
): Map<string, { name: string; odds: number }[]> {
  const lineGroups = new Map<string, { name: string; odds: number }[]>();
  for (const selection of selections) {
    const m = selection.name.match(OVER_UNDER_SELECTION_PATTERN);
    if (m) {
      const line = m[2].replace(",", ".");
      if (!lineGroups.has(line)) lineGroups.set(line, []);
      lineGroups.get(line)!.push(selection);
    }
  }
  return lineGroups;
}

function analyzeMarket(
  bookmaker: string,
  raw: RawAuditMarket,
  normalizer: BookmakerMarketNormalizer,
  ctx: NormalizationContext,
): MarketAnalysis {
  const issues: string[] = [];
  const normalized = normalizer.normalizeMarket(
    {
      name: raw.name,
      bookmakerMarketId: raw.bookmakerMarketId,
      groupName: raw.groupName,
      paramValue: raw.paramValue,
      selections: raw.selections.map((s) => ({ name: s.name, odds: s.odds })),
    },
    ctx,
  );

  let catalogEntry: MarketCatalogEntry | undefined;
  if (normalized?.marketCode && normalized.marketCode !== "OTHER") {
    catalogEntry = getMarketByCode(normalized.marketCode);
  }

  if (!normalized) {
    issues.push("NORMALIZATION_FAILED: Market could not be normalized");
  } else if (normalized.marketCode === "OTHER") {
    issues.push("UNMAPPED: Market normalized to OTHER");
  }
  if (normalized?.selections) {
    const unknown = normalized.selections.filter(
      (s) => s.code === "UNKNOWN" || /^\d+$/.test(s.code as string),
    );
    if (unknown.length > 0) {
      const list = unknown.map((s) => `"${s.label}" -> ${s.code}`).slice(0, 3);
      issues.push(
        `UNKNOWN_SELECTIONS: ${list.join(", ")}${unknown.length > 3 ? ` (+${unknown.length - 3} more)` : ""}`,
      );
    }
  }

  return {
    name: raw.name,
    bookmakerMarketId: String(raw.bookmakerMarketId ?? ""),
    groupName: raw.groupName ?? "",
    rawSelections: raw.selections,
    normalized,
    catalogEntry,
    issues,
  };
}

interface FrontendMarketJson {
  marketKey: string;
  type: string;
  category: string;
  label: string;
  viewType: string;
  parameters: { value: string; label: string }[];
  hasParameters: boolean;
}

function buildFrontendJson(
  bookmaker: string,
  analysis: MarketAnalysis,
): FrontendMarketJson | null {
  if (!analysis.normalized) return null;

  const lineGroups = splitSelectionsByLine(analysis.rawSelections);
  const marketsToGroup: Array<{ market: ScrapedMarket; bookmaker: string }> = [];

  const toScraped = (
    selections: { name: string; odds: number }[],
    marketKey: string,
    paramValue?: string,
  ): ScrapedMarket => ({
    name: analysis.name,
    bookmakerMarketId: analysis.bookmakerMarketId,
    groupName: analysis.groupName,
    type: bookmaker,
    selections: selections.map((s) => ({
      name: s.name,
      odds: s.odds,
      normalizedName: (analysis.normalized?.selections.find((ns) => ns.label === s.name)?.code ||
        undefined) as MarketSelection["normalizedName"],
    })),
    normalizedType: analysis.normalized!.marketCode,
    marketKey,
    paramValue,
  });

  if (lineGroups.size > 1) {
    for (const [line, selections] of lineGroups) {
      const hasOver = selections.some((s) => s.name.toLowerCase().includes("powyżej"));
      const hasUnder = selections.some((s) => s.name.toLowerCase().includes("poniżej"));
      if (hasOver && hasUnder) {
        marketsToGroup.push({
          market: toScraped(selections, `${analysis.normalized.marketCode}:${line}`, line),
          bookmaker,
        });
      }
    }
  } else if (analysis.normalized.parameters && analysis.normalized.parameters.length > 0) {
    const paramGroups = new Map<string, { name: string; odds: number }[]>();
    for (const selection of analysis.rawSelections) {
      const m = selection.name.match(/([+-]?\d+[.,]?\d*)/);
      if (m) {
        const param = m[1].replace(",", ".");
        if (!paramGroups.has(param)) paramGroups.set(param, []);
        paramGroups.get(param)!.push(selection);
      }
    }
    for (const [param, selections] of paramGroups.entries()) {
      marketsToGroup.push({
        market: toScraped(selections, `${analysis.normalized.marketCode}:${param}`, param),
        bookmaker,
      });
    }
  } else {
    marketsToGroup.push({
      market: toScraped(
        analysis.rawSelections,
        analysis.normalized.marketKey,
        analysis.normalized.paramValue,
      ),
      bookmaker,
    });
  }

  if (marketsToGroup.length === 0) return null;
  const grouped = groupMarketsByTypeWithParameters(marketsToGroup);
  if (grouped.length === 0) return null;
  const result = grouped[0];

  return {
    marketKey: result.marketKey,
    type: result.type,
    category: result.category || "INNE",
    label: analysis.catalogEntry?.labels.pl || analysis.name,
    viewType: result.viewType || "UNKNOWN",
    parameters: result.hasParameters
      ? result.parameters.map((p) => ({ value: p.value, label: p.label }))
      : [],
    hasParameters: result.hasParameters || false,
  };
}

function printMarketDetail(
  bookmaker: string,
  analysis: MarketAnalysis,
): void {
  console.log(`\n${"─".repeat(100)}`);
  console.log(`📦 MARKET: ${analysis.name}`);
  console.log(`${"─".repeat(100)}`);
  console.log(`   Group: ${analysis.groupName}`);
  if (analysis.normalized) {
    console.log(`\n✅ NORMALIZED: ${analysis.normalized.marketCode}`);
    console.log(`   Market Key: ${analysis.normalized.marketKey || "N/A"}`);
    console.log(`   Param Value: ${analysis.normalized.paramValue || "none"}`);
    console.log(`   Matched By: ${analysis.normalized.debug?.matchedBy || "unknown"}`);
  } else {
    console.log(`\n❌ NOT NORMALIZED`);
  }
  if (analysis.catalogEntry) {
    console.log(`\n📚 CATALOG INFO:`);
    console.log(`   Code: ${analysis.catalogEntry.code}`);
    console.log(`   Polish: ${analysis.catalogEntry.labels.pl}`);
    console.log(`   ViewType: ${analysis.catalogEntry.viewType}`);
    console.log(`   Has Parameter: ${analysis.catalogEntry.hasParameter}`);
    console.log(`   Expected Selections: [${analysis.catalogEntry.selections.join(", ")}]`);
  }
  if (analysis.issues.length > 0) {
    console.log(`\n⚠️  ISSUES:`);
    for (const issue of analysis.issues) console.log(`   - ${issue}`);
  }
  console.log(`\n📊 RAW SELECTIONS (${analysis.rawSelections.length}):`);
  for (const sel of analysis.rawSelections) {
    const code = analysis.normalized?.selections.find((s) => s.label === sel.name)?.code || "?";
    console.log(`   ${sel.name.substring(0, 34).padEnd(35)} ${sel.odds.toFixed(2).padEnd(8)} ${code}`);
  }
  const frontendJson = buildFrontendJson(bookmaker, analysis);
  if (frontendJson) {
    console.log(`\n📱 FRONTEND JSON (MarketWithParams format):`);
    console.log(JSON.stringify(frontendJson, null, 2));
  }
  console.log(`\n🔧 RAW JSON:`);
  console.log(
    JSON.stringify(
      { name: analysis.name, groupName: analysis.groupName, selections: analysis.rawSelections },
      null,
      2,
    ),
  );
}

function printSummary(analyses: MarketAnalysis[]): void {
  const mapped = analyses.filter((a) => a.normalized && a.normalized.marketCode !== "OTHER");
  const unmapped = analyses.filter((a) => !a.normalized || a.normalized.marketCode === "OTHER");
  const withIssues = analyses.filter((a) => a.issues.length > 0);
  console.log("\n" + "=".repeat(100));
  console.log(`📊 SUMMARY`);
  console.log("=".repeat(100));
  console.log(`Total markets: ${analyses.length}`);
  console.log(`✅ Mapped: ${mapped.length}`);
  console.log(`❌ Unmapped/OTHER: ${unmapped.length}`);
  console.log(`⚠️  With issues: ${withIssues.length}`);
  for (const a of mapped) {
    const viewType = a.catalogEntry?.viewType || "N/A";
    const flag = a.issues.length > 0 ? `⚠️ ${a.issues.length}` : "";
    console.log(
      `${a.name.substring(0, 39).padEnd(40)} → ${(a.normalized?.marketCode || "").padEnd(25)} ${String(viewType).substring(0, 17).padEnd(18)} ${flag}`,
    );
  }
  if (unmapped.length > 0) {
    console.log("\n❌ UNMAPPED MARKETS:");
    for (const a of unmapped) {
      const sample = a.rawSelections.slice(0, 3).map((s) => s.name).join(", ");
      console.log(`   ${a.name.padEnd(40)} [${sample}]`);
    }
  }
}

// ---------------------------------------------------------------------------
// Entrypoints for thin per-bookmaker wrapper scripts
// ---------------------------------------------------------------------------

export interface PrepRunOptions {
  scraper: FullOfferCapableScraper;
  normalizer: BookmakerMarketNormalizer;
  eventUrl: string;
  league: string;
  home?: string;
  away?: string;
}

export interface PrepRunResult {
  output: PrepAuditOutput;
  matchId: string;
  rawDeduped: number;
  recognized: number;
  unrecognized: number;
}

/** Drive a full-offer scrape of one match and build the PrepAuditOutput. */
export async function runScraperPrepAudit(opts: PrepRunOptions): Promise<PrepRunResult | null> {
  const match = await scrapeOneMatchFullOffer(opts.scraper, opts.league, opts.eventUrl, {
    home: opts.home,
    away: opts.away,
  });
  if (!match) return null;

  const home = opts.home ?? match.homeTeam;
  const away = opts.away ?? match.awayTeam;
  const ctx: NormalizationContext = {
    homeTeam: home,
    awayTeam: away,
    leagueName: opts.league,
    league: opts.league,
  };

  const rawMarkets = dedupeRawMarkets(scrapedMarketsToRaw(match.markets));
  const output = buildPrepAuditOutput({
    normalizer: opts.normalizer,
    ctx,
    rawMarkets,
    meta: {
      matchId: String(match.matchId ?? extractIdFromUrl(opts.eventUrl) ?? "unknown"),
      homeTeam: home,
      awayTeam: away,
      league: opts.league,
    },
  });

  return {
    output,
    matchId: output.meta.matchId,
    rawDeduped: output.meta.rawDeduped,
    recognized: output.meta.recognized,
    unrecognized: output.meta.unrecognized,
  };
}

export interface DiscoveryRunOptions extends PrepRunOptions {
  /** Only analyze markets whose raw name contains this substring (case-insensitive). */
  marketFilter?: string;
  /** Show full per-market detail (RAW + FRONTEND JSON) instead of just the summary. */
  showAll?: boolean;
}

/** Re-scrape one match and print discovery analysis (used by the fixer to verify). */
export async function runScraperDiscovery(opts: DiscoveryRunOptions): Promise<void> {
  const match = await scrapeOneMatchFullOffer(opts.scraper, opts.league, opts.eventUrl, {
    home: opts.home,
    away: opts.away,
  });
  if (!match) {
    console.error("[discovery] No match found");
    process.exitCode = 1;
    return;
  }

  const ctx: NormalizationContext = {
    homeTeam: opts.home ?? match.homeTeam,
    awayTeam: opts.away ?? match.awayTeam,
    leagueName: opts.league,
    league: opts.league,
  };

  const rawMarkets = scrapedMarketsToRaw(match.markets);
  const filtered = opts.marketFilter
    ? rawMarkets.filter((m) => m.name.toLowerCase().includes(opts.marketFilter!.toLowerCase()))
    : rawMarkets;

  console.log("=".repeat(100));
  console.log(`🔍 ${opts.scraper.bookmaker.toUpperCase()} MARKET DISCOVERY`);
  console.log(`🏆 MATCH: ${match.homeTeam} vs ${match.awayTeam} (${opts.league})`);
  console.log("=".repeat(100));

  const analyses = filtered.map((raw) => analyzeMarket(opts.scraper.bookmaker, raw, opts.normalizer, ctx));

  if (opts.marketFilter || opts.showAll) {
    for (const a of analyses) printMarketDetail(opts.scraper.bookmaker, a);
  }
  printSummary(analyses);
}
