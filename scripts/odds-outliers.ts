#!/usr/bin/env npx tsx
/**
 * Odds-consistency scanner.
 *
 * Reads the normalized-markets API (what the frontend actually renders) and
 * looks for prices that cannot all be right at the same time. It answers one
 * question per finding: "which bookmaker's number is out of line, and by how
 * much?" — so a reviewer can go straight to that market page instead of
 * eyeballing a 350-market response.
 *
 * Four independent checks:
 *
 *  1. OUTLIER   — a quote whose implied probability deviates from the
 *                 cross-bookmaker median of the same (market, line, selection)
 *                 by more than --dev. Ranked by deviation, so the worst offer
 *                 in the match is the first line of the report.
 *  2. LADDER    — a parameterised market whose prices are not monotone along
 *                 the line (OVER must get longer as the line rises, UNDER
 *                 shorter). Catches an inverted or misplaced line even when a
 *                 single bookmaker quotes it and no peer exists to compare
 *                 against — the pzbuk first-half 0.5 inversion was exactly
 *                 this shape.
 *  3. INTEGRITY — the shared detectors (decimal shift, placeholder value,
 *                 impossible price, swapped axis, broken overround) so this
 *                 script and /audit-match never disagree.
 *  4. ARBITRAGE — a selection set whose best prices sum to an implied
 *                 probability below 1: either a genuine arb or, far more
 *                 often, one price that belongs to a different market.
 *
 * Usage:
 *   npx tsx scripts/odds-outliers.ts --home Arsenal --away "Coventry City" --league premier-league
 *   npx tsx scripts/odds-outliers.ts --league premier-league --all-matches --fail-on major
 *
 * Options:
 *   --backend <url>    default http://localhost:3001
 *   --dev <ratio>      implied-probability deviation that counts as an outlier (default 0.35)
 *   --min-books <n>    minimum quotes in a pool before it is judged (default 4)
 *   --top <n>          findings printed per section (default 25; the JSON keeps all)
 *   --out <path>       write the full JSON report here
 *   --fail-on <level>  none | major | broken — exit code 1 when hit (default none)
 *   --quiet            JSON summary only
 *
 * The last stdout line is always a JSON summary, so the orchestrator can read
 * it the same way as the other audit steps.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  detectOddsIntegrity,
  type IntegrityMarketInput,
  type OddsIntegrityFlag,
} from "../src/services/audit/odds-integrity.js";
import { getMarketByCode } from "../src/data/market-catalog.js";

// ---------------------------------------------------------------------------
// API shape (mirrors the wire format, kept local on purpose)
// ---------------------------------------------------------------------------

interface ApiSelection {
  type: string;
  odds: number;
  label?: string;
}
interface ApiBookmakerEntry {
  bookmaker: string;
  rawMarketName?: string;
  selections: ApiSelection[];
}
interface ApiParameter {
  value: string;
  label: string;
  bookmakers: ApiBookmakerEntry[];
}
interface ApiMarket {
  marketKey: string;
  type: string;
  category: string;
  label: string;
  viewType?: string;
  parameters: ApiParameter[];
}
interface ApiCategory {
  name: string;
  markets: ApiMarket[];
}
interface NormalizedMarketsData {
  match: { homeTeam: string; awayTeam: string; league: string };
  categories: ApiCategory[];
  stats?: { bookmakersWithOdds?: string[] };
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

type Severity = "BROKEN" | "MAJOR" | "MINOR";

interface Finding {
  kind: "outlier" | "ladder" | "integrity" | "arbitrage";
  severity: Severity;
  marketRef: string;
  marketLabel: string;
  param: string;
  selection: string;
  bookmaker: string | null;
  odds: number | null;
  /** Median (outlier) or the value the check expected (ladder / integrity). */
  reference: number | null;
  /** Relative deviation of the implied probability, 0-… (outlier only). */
  deviation: number | null;
  detail: string;
}

interface Args {
  home?: string;
  away?: string;
  league?: string;
  allMatches: boolean;
  backend: string;
  dev: number;
  minBooks: number;
  top: number;
  out?: string;
  failOn: "none" | "major" | "broken";
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i < argv.length - 1 ? argv[i + 1] : undefined;
  };
  const failOn = (get("--fail-on") ?? "none") as Args["failOn"];
  if (!["none", "major", "broken"].includes(failOn)) {
    console.error(`--fail-on must be none | major | broken (got "${failOn}")`);
    process.exit(2);
  }
  return {
    home: get("--home"),
    away: get("--away"),
    league: get("--league"),
    allMatches: argv.includes("--all-matches"),
    backend: get("--backend") ?? "http://localhost:3001",
    dev: Number(get("--dev") ?? 0.35),
    minBooks: Number(get("--min-books") ?? 4),
    top: Number(get("--top") ?? 25),
    out: get("--out"),
    failOn,
    quiet: argv.includes("--quiet"),
  };
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/** Odds are compared as implied probabilities: 1.05 vs 1.10 matters far more than 41 vs 46. */
const implied = (odds: number): number => (odds > 0 ? 1 / odds : 0);

// ---------------------------------------------------------------------------
// 1. Cross-bookmaker outliers
// ---------------------------------------------------------------------------

export function findOutliers(market: ApiMarket, marketRef: string, args: Args): Finding[] {
  const out: Finding[] = [];
  for (const param of market.parameters) {
    // pool key = selection type; every bookmaker quoting it belongs to one pool
    const pools = new Map<string, { bookmaker: string; odds: number }[]>();
    for (const entry of param.bookmakers) {
      for (const sel of entry.selections) {
        if (!(sel.odds > 1)) continue;
        if (sel.type === "UNKNOWN") continue;
        const pool = pools.get(sel.type) ?? [];
        pool.push({ bookmaker: entry.bookmaker, odds: sel.odds });
        pools.set(sel.type, pool);
      }
    }

    for (const [selection, quotes] of pools) {
      if (quotes.length < args.minBooks) continue;
      const med = median(quotes.map((q) => implied(q.odds)));
      if (med <= 0) continue;
      for (const q of quotes) {
        const deviation = Math.abs(implied(q.odds) - med) / med;
        if (deviation < args.dev) continue;
        // A price shorter than the field means the bookmaker thinks the event
        // is likelier — that is the dangerous direction for a +EV screen,
        // because it silently caps the best price. Longer prices are graded
        // one notch lower unless they are extreme.
        const shorter = implied(q.odds) > med;
        const severity: Severity =
          deviation >= 1.5 ? "BROKEN" : deviation >= 0.7 || shorter ? "MAJOR" : "MINOR";
        out.push({
          kind: "outlier",
          severity,
          marketRef,
          marketLabel: market.label,
          param: param.value || "base",
          selection,
          bookmaker: q.bookmaker,
          odds: q.odds,
          reference: Number((1 / med).toFixed(2)),
          deviation: Number(deviation.toFixed(3)),
          detail:
            `${q.bookmaker} ${q.odds} vs mediana ${(1 / med).toFixed(2)} ` +
            `(${quotes.length} bukmacherów, odchylenie ${(deviation * 100).toFixed(0)}% ` +
            `implikowanego prawdopodobieństwa, kurs ${shorter ? "krótszy" : "dłuższy"} niż rynek)`,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Ladder monotonicity
// ---------------------------------------------------------------------------

/** Selections whose price must fall / rise as the numeric line rises. */
const LADDER_DIRECTION: Record<string, "rises" | "falls"> = {
  OVER: "rises",
  UNDER: "falls",
  HOME_OVER: "rises",
  AWAY_OVER: "rises",
  HOME_UNDER: "falls",
  AWAY_UNDER: "falls",
  YES: "rises",
};

export function findLadderBreaks(market: ApiMarket, marketRef: string): Finding[] {
  const out: Finding[] = [];
  const numericParams = market.parameters
    .map((p) => ({ param: p, line: Number.parseFloat(p.value) }))
    .filter((p) => Number.isFinite(p.line))
    .sort((a, b) => a.line - b.line);
  if (numericParams.length < 2) return out;

  // bookmaker -> selection -> [{ line, odds }]
  const byBookmaker = new Map<string, Map<string, { line: number; odds: number }[]>>();
  for (const { param, line } of numericParams) {
    for (const entry of param.bookmakers) {
      const bySelection = byBookmaker.get(entry.bookmaker) ?? new Map();
      for (const sel of entry.selections) {
        if (!(sel.odds > 1) || !LADDER_DIRECTION[sel.type]) continue;
        const series = bySelection.get(sel.type) ?? [];
        series.push({ line, odds: sel.odds });
        bySelection.set(sel.type, series);
      }
      byBookmaker.set(entry.bookmaker, bySelection);
    }
  }

  for (const [bookmaker, bySelection] of byBookmaker) {
    for (const [selection, series] of bySelection) {
      if (series.length < 2) continue;
      series.sort((a, b) => a.line - b.line);
      const direction = LADDER_DIRECTION[selection];
      for (let i = 1; i < series.length; i++) {
        const prev = series[i - 1];
        const curr = series[i];
        const broken =
          direction === "rises" ? curr.odds < prev.odds : curr.odds > prev.odds;
        if (!broken) continue;
        // A price that moves the wrong way along the line means one of the two
        // lines carries another market's number. Size the severity by how far
        // the move goes, since neighbouring lines can legitimately tie.
        const ratio = Math.abs(curr.odds - prev.odds) / Math.min(curr.odds, prev.odds);
        if (ratio < 0.02) continue;
        out.push({
          kind: "ladder",
          // A wrong-direction move is qualitatively wrong at any size, but
          // neighbouring lines can carry slightly different margins, so only a
          // clear move counts as broken.
          severity: ratio >= 0.35 ? "BROKEN" : ratio >= 0.1 ? "MAJOR" : "MINOR",
          marketRef,
          marketLabel: market.label,
          param: `${prev.line} → ${curr.line}`,
          selection,
          bookmaker,
          odds: curr.odds,
          reference: prev.odds,
          deviation: Number(ratio.toFixed(3)),
          detail:
            `${bookmaker} ${selection}: linia ${prev.line} = ${prev.odds}, ` +
            `linia ${curr.line} = ${curr.odds} — kurs ${direction === "rises" ? "spadł" : "wzrósł"}, ` +
            `a powinien iść w drugą stronę`,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. Shared integrity detectors
// ---------------------------------------------------------------------------

function findIntegrity(market: ApiMarket, marketRef: string): Finding[] {
  const catalog = getMarketByCode(market.type);
  const catalogSelections = catalog?.selections ?? null;
  const vocabExempt =
    catalog?.parameterType === "player" ||
    market.viewType === "SCORE_GRID" ||
    market.viewType === "PLAYER_DROPDOWN";

  const input: IntegrityMarketInput = {
    catalogSelections: catalogSelections ? [...catalogSelections] : null,
    vocabExempt,
    marketType: market.type,
    params: market.parameters.map((param) => ({
      param: param.value || "base",
      bookmakers: param.bookmakers.map((entry) => ({
        bookmaker: entry.bookmaker,
        quotes: entry.selections.map((sel) => ({
          selectionType: sel.type,
          odds: sel.odds,
          canonical: catalogSelections ? catalogSelections.includes(sel.type) : false,
        })),
      })),
    })),
  };

  const severityOf = (flag: OddsIntegrityFlag): Severity => {
    if (flag.detector === "impossible_odds" || flag.detector === "axis_swap") return "BROKEN";
    if (flag.detector === "decimal_shift") return "BROKEN";
    if (flag.detector === "overround") return "MAJOR";
    return "MINOR";
  };

  return detectOddsIntegrity(input).map((flag) => ({
    kind: "integrity" as const,
    severity: severityOf(flag),
    marketRef,
    marketLabel: market.label,
    param: flag.param,
    selection: flag.selectionType,
    bookmaker: flag.bookmaker,
    odds: flag.odds,
    reference: flag.expected,
    deviation: null,
    detail: `${flag.detector}: ${flag.evidence}`,
  }));
}

// ---------------------------------------------------------------------------
// 4. Best-price arbitrage
// ---------------------------------------------------------------------------

/**
 * Summing prices only means something for MUTUALLY EXCLUSIVE outcomes. Ladder
 * codes ("1+", "2+", "3+") and nested ranges ("0-1", "0-2") describe the same
 * event at growing thresholds — "2+ goals" is contained in "1+ goals" — so
 * adding them up always lands far below 1 and says nothing about the prices.
 */
export function isExclusiveSelectionSet(selections: readonly string[]): boolean {
  return !selections.some((code) => /^\d+\+$/.test(code) || /^\d+-\d+$/.test(code));
}

export function findArbitrage(market: ApiMarket, marketRef: string): Finding[] {
  const catalog = getMarketByCode(market.type);
  // Only closed selection sets can be summed. Player dropdowns, score grids and
  // "wins several ways" combos legitimately sum to anything.
  if (!catalog?.selections || catalog.parameterType === "player") return [];
  if (market.type.includes("_OR_")) return [];
  if (!isExclusiveSelectionSet(catalog.selections)) return [];
  const expected = new Set(catalog.selections);
  if (expected.size < 2 || expected.size > 4) return [];

  const out: Finding[] = [];
  for (const param of market.parameters) {
    const best = new Map<string, { odds: number; bookmaker: string }>();
    for (const entry of param.bookmakers) {
      for (const sel of entry.selections) {
        if (!expected.has(sel.type) || !(sel.odds > 1)) continue;
        const cur = best.get(sel.type);
        if (!cur || sel.odds > cur.odds) best.set(sel.type, { odds: sel.odds, bookmaker: entry.bookmaker });
      }
    }
    if (best.size !== expected.size) continue;
    const sum = [...best.values()].reduce((acc, b) => acc + implied(b.odds), 0);
    if (sum >= 0.995) continue;
    const worst = [...best.entries()].sort((a, b) => b[1].odds - a[1].odds)[0];
    out.push({
      kind: "arbitrage",
      severity: sum < 0.9 ? "BROKEN" : "MAJOR",
      marketRef,
      marketLabel: market.label,
      param: param.value || "base",
      selection: worst[0],
      bookmaker: worst[1].bookmaker,
      odds: worst[1].odds,
      reference: null,
      deviation: Number((1 - sum).toFixed(3)),
      detail:
        `najlepsze kursy sumują się do ${(sum * 100).toFixed(1)}% prawdopodobieństwa ` +
        `(${[...best.entries()].map(([s, b]) => `${s} ${b.odds}@${b.bookmaker}`).join(", ")}) — ` +
        `albo realny arbitraż, albo jeden kurs pochodzi z innego rynku`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function fetchMatch(args: Args, home: string, away: string, league: string) {
  const url =
    `${args.backend}/api/matches/${encodeURIComponent(home)}/${encodeURIComponent(away)}` +
    `/normalized-markets?league=${encodeURIComponent(league)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status} for ${url}`);
  const body = (await res.json()) as { success: boolean; data: NormalizedMarketsData };
  if (!body.success || !body.data) throw new Error(`API returned success=false for ${url}`);
  return { url, data: body.data };
}

/** Distinct (home, away) pairs of a league, read from the same API the frontend uses. */
async function listMatches(args: Args, league: string): Promise<{ home: string; away: string }[]> {
  const res = await fetch(`${args.backend}/api/odds/match?league=${encodeURIComponent(league)}`);
  if (res.ok) {
    const body = (await res.json()) as { success: boolean; data?: { matches?: unknown[] } };
    const matches = (body.data?.matches ?? []) as { homeTeam?: string; awayTeam?: string }[];
    const pairs = matches
      .filter((m) => m.homeTeam && m.awayTeam)
      .map((m) => ({ home: m.homeTeam!, away: m.awayTeam! }));
    if (pairs.length > 0) return pairs;
  }
  throw new Error(
    "Could not list matches from the API — pass --home/--away for a single match instead.",
  );
}

const SEVERITY_ORDER: Record<Severity, number> = { BROKEN: 0, MAJOR: 1, MINOR: 2 };

function scanMatch(data: NormalizedMarketsData, args: Args): Finding[] {
  const findings: Finding[] = [];
  for (const category of data.categories) {
    for (const market of category.markets) {
      const marketRef = `${category.name}/${market.marketKey}`;
      findings.push(...findOutliers(market, marketRef, args));
      findings.push(...findLadderBreaks(market, marketRef));
      findings.push(...findIntegrity(market, marketRef));
      findings.push(...findArbitrage(market, marketRef));
    }
  }
  findings.sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (s !== 0) return s;
    return (b.deviation ?? 0) - (a.deviation ?? 0);
  });
  return findings;
}

function printSection(title: string, findings: Finding[], top: number): void {
  if (findings.length === 0) return;
  console.error(`\n${title} (${findings.length})`);
  for (const f of findings.slice(0, top)) {
    console.error(
      `  [${f.severity}] ${f.marketRef} · param=${f.param} · ${f.selection} — ${f.detail}`,
    );
  }
  if (findings.length > top) console.error(`  … i ${findings.length - top} więcej (pełna lista w JSON)`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.league) {
    console.error("Missing --league. Use --home/--away for one match, or --all-matches.");
    process.exit(2);
  }
  if (!args.allMatches && (!args.home || !args.away)) {
    console.error("Missing --home/--away. Use --all-matches to scan the whole league.");
    process.exit(2);
  }

  const targets = args.allMatches
    ? await listMatches(args, args.league)
    : [{ home: args.home!, away: args.away! }];

  const perMatch: {
    matchId: string;
    home: string;
    away: string;
    markets: number;
    findings: Finding[];
  }[] = [];

  for (const target of targets) {
    let fetched;
    try {
      fetched = await fetchMatch(args, target.home, target.away, args.league);
    } catch (err) {
      console.error(`[odds-outliers] ${target.home} vs ${target.away}: ${err}`);
      continue;
    }
    const markets = fetched.data.categories.reduce((n, c) => n + c.markets.length, 0);
    const findings = scanMatch(fetched.data, args);
    perMatch.push({
      matchId: `${args.league}:${fetched.data.match.homeTeam}:${fetched.data.match.awayTeam}`,
      home: fetched.data.match.homeTeam,
      away: fetched.data.match.awayTeam,
      markets,
      findings,
    });

    if (!args.quiet) {
      console.error(
        `\n=== ${fetched.data.match.homeTeam} vs ${fetched.data.match.awayTeam} ` +
          `(${markets} rynków, ${findings.length} zgłoszeń) ===`,
      );
      printSection("KURSY ODSTAJĄCE", findings.filter((f) => f.kind === "outlier"), args.top);
      printSection("NIEMONOTONICZNA DRABINKA", findings.filter((f) => f.kind === "ladder"), args.top);
      printSection("INTEGRALNOŚĆ KURSU", findings.filter((f) => f.kind === "integrity"), args.top);
      printSection("SUMA NAJLEPSZYCH KURSÓW < 100%", findings.filter((f) => f.kind === "arbitrage"), args.top);
    }
  }

  const all = perMatch.flatMap((m) => m.findings);
  const bySeverity = { BROKEN: 0, MAJOR: 0, MINOR: 0 };
  const byKind: Record<string, number> = {};
  const byBookmaker: Record<string, number> = {};
  for (const f of all) {
    bySeverity[f.severity]++;
    byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
    if (f.bookmaker) byBookmaker[f.bookmaker] = (byBookmaker[f.bookmaker] ?? 0) + 1;
  }

  const report = {
    schemaVersion: 1,
    league: args.league,
    scannedAt: new Date().toISOString(),
    thresholds: { dev: args.dev, minBooks: args.minBooks },
    summary: {
      matches: perMatch.length,
      markets: perMatch.reduce((n, m) => n + m.markets, 0),
      findings: all.length,
      bySeverity,
      byKind,
      byBookmaker: Object.fromEntries(
        Object.entries(byBookmaker).sort((a, b) => b[1] - a[1]),
      ),
    },
    matches: perMatch,
  };

  let outputPath: string | null = null;
  if (args.out) {
    outputPath = path.isAbsolute(args.out) ? args.out : path.resolve(process.cwd(), args.out);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 1));
  }

  console.log(JSON.stringify({ ...report.summary, outputPath }));

  const shouldFail =
    (args.failOn === "broken" && bySeverity.BROKEN > 0) ||
    (args.failOn === "major" && bySeverity.BROKEN + bySeverity.MAJOR > 0);
  process.exit(shouldFail ? 1 : 0);
}

const executedDirectly =
  process.argv[1] !== undefined && process.argv[1].endsWith("odds-outliers.ts");
if (executedDirectly) {
  main().catch((err) => {
    console.error("[odds-outliers] fatal:", err);
    process.exit(2);
  });
}
