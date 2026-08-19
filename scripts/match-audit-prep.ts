/**
 * Cross-bookmaker match audit — data prep (Audit Process v2, SPEC §4).
 *
 * Fetches the normalized-markets API response (the frontend's source of
 * truth), enriches it with raw selection names + scrapedAt from the DB, runs
 * the mechanical analysis (match-audit-core), annotates every flag with its
 * ledger fingerprint, applies suppression, and writes a prep JSON consumed by
 * the /audit-match orchestrator.
 *
 * Usage:
 *   npx tsx scripts/match-audit-prep.ts --home Algeria --away Austria --league world-cup-2026
 *   npx tsx scripts/match-audit-prep.ts --pick-richest [--league world-cup-2026]
 *
 * Options:
 *   --backend <url>     Backend base URL (default http://localhost:3001)
 *   --out <dir>         Output dir (default docs/match-audit/.tmp, repo-root relative)
 *   --panel <path>      Frozen judged-market panel (default docs/audit-ledger/panel.json if exists)
 *   --registry <path>   Issue ledger registry (default docs/audit-ledger/registry.json if exists)
 *   --coverage <path>   Coverage baseline (default docs/audit-ledger/coverage.json if exists)
 *   --min-fresh <ISO>   Stale gate: markets whose entries are ALL older get staleSkip: true
 *   --no-ledger         Bypass panel/registry/coverage/min-fresh entirely
 *   --raw <path>        Raw bookmaker offer bundle from scripts/match-audit-raw-capture.ts.
 *                       Attaches per-market ground truth (rawOffer) + a coverage
 *                       diff (rawUnclaimed) so judges can compare our normalized
 *                       markets against what the bookmaker actually publishes.
 *
 * The prep NEVER writes to the registry (read-only); ledger mutations happen
 * via scripts/audit-ledger-update.ts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getSupabase } from "../src/config/database.js";
import { getFullOfferByMatch } from "../src/repositories/full-offer-repository.js";
import { getMarketByCode } from "../src/data/market-catalog.js";
import { getRelatedCodes } from "../src/services/audit/family-codes.js";
import {
  analyzeMatchResponse,
  type CatalogLookup,
  type MatchAuditOpts,
  type NormalizedMarketsData,
  type ApiMarket,
} from "../src/services/audit/match-audit-core.js";
import {
  loadRegistry,
  type FingerprintId,
  type LedgerRegistry,
} from "../src/services/audit/fingerprint.js";
import {
  annotateMarket,
  computePendingVerify,
  type PendingVerify,
} from "../src/services/audit/ledger-annotate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

interface Args {
  home?: string;
  away?: string;
  league?: string;
  backend: string;
  out: string;
  pickRichest: boolean;
  panel?: string;
  registry?: string;
  coverage?: string;
  minFresh?: string;
  noLedger: boolean;
  raw?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    backend: "http://localhost:3001",
    out: path.join(REPO_ROOT, "docs", "match-audit", ".tmp"),
    pickRichest: false,
    noLedger: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--home") args.home = argv[++i];
    else if (a === "--away") args.away = argv[++i];
    else if (a === "--league") args.league = argv[++i];
    else if (a === "--backend") args.backend = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--pick-richest") args.pickRichest = true;
    else if (a === "--panel") args.panel = argv[++i];
    else if (a === "--registry") args.registry = argv[++i];
    else if (a === "--coverage") args.coverage = argv[++i];
    else if (a === "--min-fresh") args.minFresh = argv[++i];
    else if (a === "--no-ledger") args.noLedger = true;
    else if (a === "--raw") args.raw = argv[++i];
  }
  return args;
}

/**
 * Resolve a ledger-file path: explicit args must exist (hard error), default
 * paths are used only when present on disk.
 */
function resolveLedgerPath(explicit: string | undefined, defaultRel: string): string | null {
  if (explicit) {
    const p = path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);
    if (!fs.existsSync(p)) {
      console.error(`[match-audit-prep] File not found: ${p}`);
      process.exit(1);
    }
    return p;
  }
  const fallback = path.join(REPO_ROOT, defaultRel);
  return fs.existsSync(fallback) ? fallback : null;
}

/** Pick the match with the most rows in market_comparison (optionally per league). */
async function pickRichestMatch(league?: string): Promise<{ home: string; away: string; league: string } | null> {
  const sb = getSupabase();
  let query = (sb as any)
    .from("market_comparison")
    .select("match_id, home_team, away_team, league_slug")
    .limit(10000);
  if (league) query = query.eq("league_slug", league);
  const { data, error } = await query;
  if (error || !data || data.length === 0) return null;

  const counts = new Map<string, { home: string; away: string; league: string; rows: number }>();
  for (const r of data as any[]) {
    const e = counts.get(r.match_id) ?? {
      home: r.home_team,
      away: r.away_team,
      league: r.league_slug,
      rows: 0,
    };
    e.rows++;
    counts.set(r.match_id, e);
  }
  const best = [...counts.values()].sort((a, b) => b.rows - a.rows)[0];
  return best ? { home: best.home, away: best.away, league: best.league } : null;
}

const catalogLookup: CatalogLookup = (code) => {
  const entry = getMarketByCode(code);
  if (!entry) return undefined;
  return {
    selections: entry.selections ?? [],
    viewType: String(entry.viewType),
    hasParameter: Boolean(entry.hasParameter),
    labelPl: entry.labels?.pl ?? code,
  };
};

/** coverage.json shape (SPEC §8): bookmaker → marketType → selection codes. */
type CoverageData = Record<string, Record<string, string[]>>;

/**
 * Build the §3.4 coverage gate. A bookmaker entirely absent from the baseline
 * has NO coverage data, so we fall back to today's behaviour (flag the gap)
 * rather than silencing every gap for not-yet-archived bookmakers.
 */
function buildCoverageLookup(data: CoverageData): NonNullable<MatchAuditOpts["coverage"]> {
  const sets = new Map<string, Set<string>>();
  const knownBookmakers = new Set<string>();
  for (const [bookmaker, byType] of Object.entries(data)) {
    knownBookmakers.add(bookmaker.toLowerCase());
    for (const [marketType, codes] of Object.entries(byType)) {
      sets.set(`${bookmaker.toLowerCase()}|${marketType}`, new Set(codes));
    }
  }
  return (bookmaker, marketType, selectionCode) => {
    const bm = bookmaker.toLowerCase();
    if (!knownBookmakers.has(bm)) return true; // no data for this bookmaker → behave as today
    return sets.get(`${bm}|${marketType}`)?.has(selectionCode) ?? false;
  };
}


// ---------------------------------------------------------------------------
// Raw bookmaker offer (ground truth) — see scripts/match-audit-raw-capture.ts
// ---------------------------------------------------------------------------

interface RawOfferMarket {
  name: string;
  groupName?: string;
  paramValue?: string;
  selections: { name: string; odds: number }[];
}

interface RawBundleFile {
  matchId: string;
  capturedAt: string;
  bookmakers: Record<
    string,
    { bookmaker: string; ok: boolean; error?: string; eventUrl?: string | null; markets: RawOfferMarket[] }
  >;
}

/** Loose key for matching an API rawMarketName against a raw offer market name. */
function rawNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Some bookmakers embed the line in the market name ("Liczba goli 2.5") while
 * our API reports the bare name plus a paramValue. Strip a trailing numeric
 * token so those still match, and expose the stripped number as the line.
 */
function splitTrailingLine(nameKey: string): { base: string; line: string } | null {
  const m = nameKey.match(/^(.*?)\s+(\d+(?:\s\d+)?|\d+ \d+)$/);
  if (!m) return null;
  return { base: m[1].trim(), line: m[2] };
}

/** "2.5" and "2 5" collapse to the same key (rawNameKey eats the dot). */
function lineKey(value: string): string {
  return value.replace(/[^0-9]+/g, ".").replace(/^\.|\.$/g, "");
}

interface RawIndex {
  /** bookmaker -> nameKey -> raw markets */
  byName: Map<string, Map<string, RawOfferMarket[]>>;
  /** bookmaker -> nameKey without trailing line -> raw markets (line embedded in name) */
  byNameNoLine: Map<string, Map<string, { market: RawOfferMarket; line: string }[]>>;
  /** bookmaker -> set of "nameKey|paramValue" already attached to some market */
  claimed: Map<string, Set<string>>;
  bookmakers: string[];
  failed: { bookmaker: string; error?: string }[];
  capturedAt: string;
}

function buildRawIndex(bundle: RawBundleFile): RawIndex {
  const byName = new Map<string, Map<string, RawOfferMarket[]>>();
  const byNameNoLine = new Map<string, Map<string, { market: RawOfferMarket; line: string }[]>>();
  const claimed = new Map<string, Set<string>>();
  const bookmakers: string[] = [];
  const failed: { bookmaker: string; error?: string }[] = [];
  for (const [bm, cap] of Object.entries(bundle.bookmakers ?? {})) {
    if (!cap.ok) {
      failed.push({ bookmaker: bm, error: cap.error });
      continue;
    }
    bookmakers.push(bm);
    const idx = new Map<string, RawOfferMarket[]>();
    const idxNoLine = new Map<string, { market: RawOfferMarket; line: string }[]>();
    for (const m of cap.markets ?? []) {
      const key = rawNameKey(m.name ?? "");
      const list = idx.get(key);
      if (list) list.push(m);
      else idx.set(key, [m]);
      const split = splitTrailingLine(key);
      if (split) {
        const l = idxNoLine.get(split.base);
        const item = { market: m, line: split.line };
        if (l) l.push(item);
        else idxNoLine.set(split.base, [item]);
      }
    }
    byName.set(bm, idx);
    byNameNoLine.set(bm, idxNoLine);
    claimed.set(bm, new Set());
  }
  return { byName, byNameNoLine, claimed, bookmakers, failed, capturedAt: bundle.capturedAt };
}

const RAW_MARKETS_PER_BOOKMAKER = 6;

/**
 * Ground truth for one audited market: for every bookmaker entry in the API
 * response, the raw market(s) whose name matches its rawMarketName, preferring
 * the one whose paramValue matches the parameter under audit.
 */
function attachRawOffer(
  market: ApiMarket | null,
  index: RawIndex,
): Record<string, RawOfferMarket[]> | null {
  if (!market) return null;
  const out: Record<string, RawOfferMarket[]> = {};
  for (const param of market.parameters) {
    for (const entry of param.bookmakers) {
      const idx = index.byName.get(entry.bookmaker);
      if (!idx) continue;
      const rawName = entry.rawMarketName ?? market.label;
      const nameKey = rawNameKey(rawName);
      const wanted = param.value ? String(param.value) : null;
      let candidates = idx.get(nameKey) ?? [];
      if (candidates.length === 0) {
        // Bookmaker embeds the line in the market name — match on the base name
        // and, when we have a parameter, on the line it carries.
        const embedded = index.byNameNoLine.get(entry.bookmaker)?.get(nameKey) ?? [];
        const byLine = wanted
          ? embedded.filter((e) => lineKey(e.line) === lineKey(wanted))
          : embedded;
        candidates = (byLine.length > 0 ? byLine : embedded).map((e) => e.market);
      }
      if (candidates.length === 0) continue;
      const picked = wanted
        ? candidates.filter((c) => (c.paramValue ?? "") === wanted)
        : candidates;
      const chosen = picked.length > 0 ? picked : candidates;
      const bucket = (out[entry.bookmaker] ??= []);
      const claimedSet = index.claimed.get(entry.bookmaker)!;
      for (const c of chosen) {
        claimedSet.add(`${rawNameKey(c.name)}|${c.paramValue ?? ""}`);
        if (bucket.length >= RAW_MARKETS_PER_BOOKMAKER) continue;
        const dupe = bucket.some(
          (b) => b.name === c.name && (b.paramValue ?? "") === (c.paramValue ?? ""),
        );
        if (!dupe) bucket.push(c);
      }
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Raw markets no audited market ever referenced — candidates for lost coverage. */
function computeRawUnclaimed(
  bundle: RawBundleFile,
  index: RawIndex,
): Record<string, { name: string; paramValue?: string; selections: number }[]> {
  const out: Record<string, { name: string; paramValue?: string; selections: number }[]> = {};
  for (const bm of index.bookmakers) {
    const claimedSet = index.claimed.get(bm)!;
    const seen = new Set<string>();
    const missing: { name: string; paramValue?: string; selections: number }[] = [];
    for (const m of bundle.bookmakers[bm].markets ?? []) {
      const key = `${rawNameKey(m.name)}|${m.paramValue ?? ""}`;
      if (claimedSet.has(key) || seen.has(key)) continue;
      seen.add(key);
      missing.push({ name: m.name, paramValue: m.paramValue, selections: m.selections.length });
    }
    if (missing.length > 0) out[bm] = missing;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);

  let { home, away, league } = args;
  if (args.pickRichest && (!home || !away)) {
    const picked = await pickRichestMatch(league);
    if (!picked) {
      console.error("[match-audit-prep] --pick-richest found no matches in market_comparison");
      process.exit(1);
    }
    home = picked.home;
    away = picked.away;
    league = picked.league;
  }
  if (!home || !away || !league) {
    console.error(
      "[match-audit-prep] Missing args. Use --home <t> --away <t> --league <slug>, or --pick-richest.",
    );
    process.exit(1);
  }

  // Ledger inputs (SPEC §4): defaults apply only when the files exist.
  const panelPath = args.noLedger ? null : resolveLedgerPath(args.panel, "docs/audit-ledger/panel.json");
  const registryPath = args.noLedger
    ? null
    : resolveLedgerPath(args.registry, "docs/audit-ledger/registry.json");
  const coveragePath = args.noLedger
    ? null
    : resolveLedgerPath(args.coverage, "docs/audit-ledger/coverage.json");
  const minFreshMs = args.noLedger || !args.minFresh ? NaN : Date.parse(args.minFresh);
  if (!args.noLedger && args.minFresh && Number.isNaN(minFreshMs)) {
    console.error(`[match-audit-prep] --min-fresh is not a valid ISO timestamp: ${args.minFresh}`);
    process.exit(1);
  }

  const registry: LedgerRegistry | null = registryPath ? loadRegistry(registryPath) : null;
  const panelMarkets: string[] | null = panelPath
    ? ((JSON.parse(fs.readFileSync(panelPath, "utf8")) as { markets: string[] }).markets ?? null)
    : null;
  const coverage = coveragePath
    ? buildCoverageLookup(JSON.parse(fs.readFileSync(coveragePath, "utf8")) as CoverageData)
    : undefined;

  // Raw bookmaker offer bundle (ground truth). Optional: absent → prep behaves
  // exactly as before, judges just lose the per-market ground-truth block.
  let rawIndex: RawIndex | null = null;
  let rawBundle: RawBundleFile | null = null;
  if (args.raw) {
    const rawPath = path.isAbsolute(args.raw) ? args.raw : path.resolve(process.cwd(), args.raw);
    if (!fs.existsSync(rawPath)) {
      console.error(`[match-audit-prep] --raw file not found: ${rawPath}`);
      process.exit(1);
    }
    rawBundle = JSON.parse(fs.readFileSync(rawPath, "utf8")) as RawBundleFile;
    rawIndex = buildRawIndex(rawBundle);
  }

  // 1. Fetch the API response — the exact bytes the frontend consumes.
  const url = `${args.backend}/api/matches/${encodeURIComponent(home)}/${encodeURIComponent(away)}/normalized-markets?league=${encodeURIComponent(league)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[match-audit-prep] API ${res.status} for ${url}`);
    process.exit(1);
  }
  const body = (await res.json()) as { success: boolean; data: NormalizedMarketsData };
  if (!body.success || !body.data) {
    console.error(`[match-audit-prep] API returned success=false for ${url}`);
    process.exit(1);
  }
  const data = body.data;
  const fetchedAt = new Date();

  // 2. Enrich with raw selection names + scrapedAt from the DB (the API drops
  //    them). rawSelections: marketKey -> bookmaker -> [{name, normalizedName, odds}]
  const rawSelections: Record<string, Record<string, { name: string; normalizedName?: string; odds: number }[]>> = {};
  // (marketType, bookmaker) -> newest scrapedAt ISO across the full offer.
  const scrapedAtByTypeBm = new Map<string, string>();
  let matchId = `${league}:${home.toLowerCase()}:${away.toLowerCase()}`;
  try {
    const fullOffer = await getFullOfferByMatch(home, away, league);
    if (fullOffer) {
      matchId = fullOffer.matchId;
      for (const [marketKey, market] of Object.entries(fullOffer.markets)) {
        rawSelections[marketKey] = {};
        for (const [bookmaker, bmData] of Object.entries(market.bookmakerOdds)) {
          rawSelections[marketKey][bookmaker] = (bmData.selections ?? []).map((s: any) => ({
            name: s.name ?? "",
            normalizedName: s.normalizedName,
            odds: s.odds,
          }));
          // The grouped API market's marketKey equals the market_code (type);
          // keep the NEWEST scrape per (type, bookmaker) across param rows.
          const scrapedAt = (bmData as any).scrapedAt as string | undefined;
          if (scrapedAt) {
            const key = `${market.type}|${bookmaker}`;
            const prev = scrapedAtByTypeBm.get(key);
            if (!prev || Date.parse(scrapedAt) > Date.parse(prev)) {
              scrapedAtByTypeBm.set(key, scrapedAt);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error(`[match-audit-prep] DB enrichment failed (continuing without): ${err}`);
  }

  // 3. Inject scrapedAt into the API market JSON BEFORE analysis (SPEC §4.1)
  //    so the core's freshness windowing (§3.1) operates on real timestamps.
  for (const cat of data.categories) {
    for (const market of cat.markets) {
      for (const param of market.parameters) {
        for (const entry of param.bookmakers) {
          const scrapedAt = scrapedAtByTypeBm.get(`${market.type}|${entry.bookmaker}`);
          if (scrapedAt) entry.scrapedAt = scrapedAt;
        }
      }
    }
  }

  // 4. Mechanical analysis (coverage gate wired per SPEC §4.2).
  const analysis = analyzeMatchResponse(data, catalogLookup, { coverage });

  const marketByRef = new Map<string, ApiMarket>();
  for (const cat of data.categories) {
    for (const m of cat.markets) marketByRef.set(`${cat.name}/${m.marketKey}`, m);
  }

  // 5. Stale gate (SPEC §4.3): markets where ALL bookmaker entries are older
  //    than --min-fresh get staleSkip: true; per-bookmaker counts reported.
  const staleEntriesByBookmaker: Record<string, number> = {};
  const staleSkipRefs = new Set<string>();
  if (!Number.isNaN(minFreshMs)) {
    for (const [ref, market] of marketByRef) {
      let total = 0;
      let stale = 0;
      for (const param of market.parameters) {
        for (const entry of param.bookmakers) {
          total++;
          // Entries without scrapedAt are treated as fresh (never exclude on missing data).
          const ms = entry.scrapedAt ? Date.parse(entry.scrapedAt) : NaN;
          if (!Number.isNaN(ms) && ms < minFreshMs) {
            stale++;
            staleEntriesByBookmaker[entry.bookmaker] = (staleEntriesByBookmaker[entry.bookmaker] ?? 0) + 1;
          }
        }
      }
      if (total > 0 && stale === total) staleSkipRefs.add(ref);
    }
  }

  // 6. Fingerprint annotation + suppression + severity recompute (SPEC §4.4-4.5).
  const panelSet = panelMarkets ? new Set(panelMarkets) : null;
  const seenIds = new Set<FingerprintId>();
  const auditedRefs = new Set<string>();
  let suppressedCount = 0;

  const markets = analysis.markets.map((entry) => {
    const annotated = annotateMarket(entry.marketRef, entry.flags, registry, fetchedAt);
    const staleSkip = staleSkipRefs.has(entry.marketRef);
    if (!staleSkip) {
      auditedRefs.add(entry.marketRef);
      for (const fp of annotated.fingerprints) seenIds.add(fp.id);
    }
    suppressedCount += annotated.suppressed.length;
    return {
      ...entry,
      flags: annotated.flags,
      severity: annotated.severity,
      fingerprints: annotated.fingerprints,
      suppressed: annotated.suppressed,
      staleSkip,
      inPanel: panelSet ? panelSet.has(entry.marketRef) : false,
      catalogEntry: catalogLookup(entry.type) ?? null,
      relatedCodes: getRelatedCodes(entry.type).slice(0, 25),
      market: marketByRef.get(entry.marketRef) ?? null,
      rawSelections: rawSelections[entry.marketKey] ?? null,
      rawOffer: rawIndex ? attachRawOffer(marketByRef.get(entry.marketRef) ?? null, rawIndex) : null,
    };
  });
  // Suppression may change severities → re-sort like the core does.
  markets.sort((a, b) => b.severity - a.severity);

  // 7. Panel completeness (SPEC §4.6): panel markets absent from this match's
  //    response are emitted as explicit stubs so the orchestrator sees them.
  const presentRefs = new Set(markets.map((m) => m.marketRef));
  const panelStubs = (panelMarkets ?? [])
    .filter((ref) => !presentRefs.has(ref))
    .map((ref) => {
      const [category, marketKey] = ref.split("/", 2);
      return {
        marketRef: ref,
        marketKey: marketKey ?? ref,
        type: marketKey ?? ref,
        category: category ?? "",
        label: marketKey ?? ref,
        viewType: undefined as string | undefined,
        paramCount: 0,
        bookmakerCount: 0,
        flags: null,
        severity: 0,
        fingerprints: [],
        suppressed: [],
        staleSkip: false,
        inPanel: true,
        missingFromResponse: true,
        catalogEntry: catalogLookup(marketKey ?? ref) ?? null,
        relatedCodes: [],
        market: null,
        rawSelections: null,
        rawOffer: null,
      };
    });

  // 8. Summary additions (SPEC §4.7).
  const newFingerprints = [...seenIds].filter((id) => !registry?.entries[id]).sort();
  const pendingVerify: PendingVerify = registry
    ? computePendingVerify(registry, seenIds, auditedRefs)
    : { stillPresent: [], nowAbsent: [] };
  const staleBookmakers: Record<string, number> = {};
  for (const m of markets) {
    if (!m.flags) continue;
    for (const f of m.flags.stale_bookmakers) {
      staleBookmakers[f.bookmaker] = (staleBookmakers[f.bookmaker] ?? 0) + 1;
    }
  }

  // Raw coverage diff must run AFTER every market attached its ground truth,
  // so `claimed` is complete.
  const rawUnclaimed =
    rawBundle && rawIndex ? computeRawUnclaimed(rawBundle, rawIndex) : null;
  const rawCoverage = rawIndex
    ? {
        capturedAt: rawIndex.capturedAt,
        bookmakers: rawIndex.bookmakers,
        failed: rawIndex.failed,
        unclaimedCounts: Object.fromEntries(
          Object.entries(rawUnclaimed ?? {}).map(([bm, list]) => [bm, list.length]),
        ),
      }
    : null;

  const summary = {
    ...analysis.summary,
    // Recomputed after suppression (severities may have dropped to 0).
    totalFlagged: markets.filter((m) => m.severity > 0).length,
    suppressedCount,
    newFingerprints,
    pendingVerify,
    integrityViolations: analysis.summary.integrityViolations,
    staleBookmakers,
    staleGate: Number.isNaN(minFreshMs)
      ? null
      : {
          minFresh: args.minFresh ?? null,
          staleEntriesByBookmaker,
          staleSkippedMarkets: staleSkipRefs.size,
        },
    rawCoverage,
  };

  const prep = {
    meta: {
      schemaVersion: 2,
      matchId,
      homeTeam: data.match.homeTeam,
      awayTeam: data.match.awayTeam,
      league,
      apiUrl: url,
      frontendUrl: `http://localhost:3000/leagues/${league}/match/${encodeURIComponent(matchId)}`,
      fetchedAt: fetchedAt.toISOString(),
      apiStats: data.stats,
      ledger: {
        panel: panelPath,
        registry: registryPath,
        coverage: coveragePath,
        minFresh: args.minFresh ?? null,
        noLedger: args.noLedger,
      },
      rawBundle: args.raw ?? null,
    },
    summary,
    rawUnclaimed,
    markets: [...markets, ...panelStubs],
  };

  fs.mkdirSync(args.out, { recursive: true });
  const outputPath = path.join(args.out, `${matchId.replace(/[^a-z0-9_-]+/gi, "_")}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(prep, null, 1));

  console.log(
    JSON.stringify({
      outputPath,
      matchId,
      homeTeam: data.match.homeTeam,
      awayTeam: data.match.awayTeam,
      league,
      totalMarkets: analysis.summary.totalMarkets,
      totalFlagged: summary.totalFlagged,
      flagTotals: analysis.summary.flagTotals,
      bookmakers: data.stats.bookmakersWithOdds,
      // SPEC §4.8: stdout gains the same summary additions.
      suppressedCount: summary.suppressedCount,
      newFingerprints: summary.newFingerprints,
      pendingVerify: summary.pendingVerify,
      integrityViolations: summary.integrityViolations,
      staleBookmakers: summary.staleBookmakers,
      staleGate: summary.staleGate,
      panelMarkets: panelMarkets ? panelMarkets.length : null,
      panelMissingFromResponse: panelStubs.length,
      rawCoverage,
    }),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[match-audit-prep] FATAL:", err);
    process.exit(1);
  });
