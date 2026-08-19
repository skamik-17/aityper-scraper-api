#!/usr/bin/env npx tsx
/**
 * Selection-vocabulary scanner.
 *
 * The odds scanner (scripts/odds-outliers.ts) can only compare prices that land
 * in the same cell. This one asks the question that comes *before* that: do the
 * bookmakers inside a market even speak the same language?
 *
 * When they do not, the comparison table quietly lies. Two shapes of lie:
 *
 *   - a bookmaker's rows never line up with anyone else's, so its prices are
 *     invisible (fortuna publishing the player's name as the selection while
 *     everybody else keeps the player in the parameter and says "PLAYER");
 *   - two different bets share one row, so the table invites a comparison that
 *     does not exist ("3" meaning exactly three goals sitting next to "3+"
 *     meaning three or more; cumulative ranges 1-2/1-3/1-4 next to disjoint
 *     ranges 0-1/2-3/4-6).
 *
 * Six independent checks:
 *
 *  1. ISOLATED    — a bookmaker whose entire selection vocabulary in a market is
 *                   disjoint from the majority's. Its prices can never be
 *                   compared with anyone.
 *  2. PLAYER_AXIS — inside one market, some bookmakers put the player in the
 *                   parameter and others in the selection type. Same bet, two
 *                   incompatible layouts.
 *  3. MIXED_RANGE — the market mixes cumulative ranges with disjoint ranges, or
 *                   ranges with OVER/UNDER. Those are different products.
 *  4. TOP_BUCKET  — the top bucket disagrees: "3" (exactly) vs "3+" (or more).
 *  5. OFF_CATALOG — a selection type the catalog entry does not declare, in a
 *                   market whose catalog entry has a closed selection list.
 *  6. PRODUCT     — a bookmaker whose book sum (Σ 1/odds over the selections
 *                   everybody quotes) is far from the peer median. Same labels,
 *                   different event — the pzbuk "player (or his substitute)
 *                   scores" family had exactly this shape.
 *
 * Usage:
 *   npx tsx scripts/selection-vocab-scan.ts --home Arsenal --away "Coventry City" --league premier-league
 *   npx tsx scripts/selection-vocab-scan.ts --league premier-league --all-matches --fail-on broken
 *
 * Options:
 *   --backend <url>    default http://localhost:3001
 *   --book-dev <ratio> book-sum deviation that counts as a different product (default 0.25)
 *   --min-books <n>    minimum bookmakers in a market before it is judged (default 3)
 *   --top <n>          findings printed per section (default 25; the JSON keeps all)
 *   --out <path>       write the full JSON report here
 *   --fail-on <level>  none | major | broken — exit code 1 when hit (default none)
 *   --quiet            JSON summary only
 *
 * The last stdout line is always a JSON summary, so the orchestrator can read it
 * the same way as the other audit steps.
 */

import * as fs from "node:fs";
import * as path from "node:path";
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
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

type Severity = "BROKEN" | "MAJOR" | "MINOR";

export type VocabKind =
  | "isolated"
  | "player_axis"
  | "mixed_range"
  | "top_bucket"
  | "off_catalog"
  | "product";

export interface VocabFinding {
  kind: VocabKind;
  severity: Severity;
  marketRef: string;
  marketLabel: string;
  /** The bookmaker at fault, or null when the market itself is the problem. */
  bookmaker: string | null;
  bookmakerCount: number;
  detail: string;
}

interface Args {
  home?: string;
  away?: string;
  league?: string;
  allMatches: boolean;
  backend: string;
  bookDev: number;
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
    bookDev: Number(get("--book-dev") ?? 0.25),
    minBooks: Number(get("--min-books") ?? 3),
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

const implied = (odds: number): number => (odds > 0 ? 1 / odds : 0);

// ---------------------------------------------------------------------------
// Vocabulary primitives
// ---------------------------------------------------------------------------

/**
 * A selection type that is really a person's name rather than an outcome code.
 *
 * Our codes are SCREAMING_SNAKE or short tokens ("1+", "OVER", "0-1", "2:1").
 * A player row that leaked into the selection axis looks like prose: capitalised
 * words, possibly with an initial ("M Grimes", "V. Gyokeres", "Bukayo Saka").
 */
export function looksLikePlayerName(type: string): boolean {
  const trimmed = type.trim();
  if (trimmed.length < 3) return false;
  if (/^[A-Z0-9_]+$/.test(trimmed)) return false; // OVER, HOME_YES, UNKNOWN
  if (/^\d/.test(trimmed)) return false; // 1+, 0-1, 2:1
  return /^\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*)+$/u.test(trimmed);
}

/** "0-1", "2-3", "12-14" — a closed range of counts. */
function parseRange(type: string): [number, number] | null {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(type.trim());
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  return hi >= lo ? [lo, hi] : null;
}

/**
 * Ranges that all start at the same floor ("1-2", "1-3", "1-4") are cumulative:
 * each contains the previous one, so they are not alternatives to each other and
 * they mean something different from a partition like "0-1", "2-3", "4-6".
 */
export function isCumulativeRangeSet(types: string[]): boolean {
  const ranges = types.map(parseRange).filter((r): r is [number, number] => r !== null);
  if (ranges.length < 2) return false;
  const floors = new Set(ranges.map((r) => r[0]));
  const ceilings = new Set(ranges.map((r) => r[1]));
  return floors.size === 1 && ceilings.size === ranges.length;
}

/** Ranges that do not overlap — a genuine partition of the outcome space. */
export function isDisjointRangeSet(types: string[]): boolean {
  const ranges = types
    .map(parseRange)
    .filter((r): r is [number, number] => r !== null)
    .sort((a, b) => a[0] - b[0]);
  if (ranges.length < 2) return false;
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i][0] <= ranges[i - 1][1]) return false;
  }
  return true;
}

/** "3+" (three or more) — cumulative threshold. */
function parseThresholdPlus(type: string): number | null {
  const m = /^(\d+)\+$/.exec(type.trim());
  return m ? Number(m[1]) : null;
}

/** "3" (exactly three) — an exact count. */
function parseExactCount(type: string): number | null {
  const m = /^(\d+)$/.exec(type.trim());
  return m ? Number(m[1]) : null;
}

/** The selection types a bookmaker uses inside one market, across all parameters. */
function vocabularyByBookmaker(market: ApiMarket): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const param of market.parameters) {
    for (const entry of param.bookmakers) {
      const set = out.get(entry.bookmaker) ?? new Set<string>();
      for (const sel of entry.selections) {
        if (!(sel.odds > 1)) continue;
        set.add(sel.type);
      }
      out.set(entry.bookmaker, set);
    }
  }
  for (const [bm, set] of [...out]) if (set.size === 0) out.delete(bm);
  return out;
}

// ---------------------------------------------------------------------------
// 1. Isolated bookmakers
// ---------------------------------------------------------------------------

export function findIsolated(market: ApiMarket, marketRef: string, args: Args): VocabFinding[] {
  const vocab = vocabularyByBookmaker(market);
  if (vocab.size < args.minBooks) return [];

  // A selection type is "shared" once at least two bookmakers use it. A
  // bookmaker with no shared type at all stands alone in the table.
  const users = new Map<string, number>();
  for (const set of vocab.values()) {
    for (const type of set) users.set(type, (users.get(type) ?? 0) + 1);
  }

  const out: VocabFinding[] = [];
  for (const [bookmaker, set] of vocab) {
    const shared = [...set].filter((type) => (users.get(type) ?? 0) > 1);
    if (shared.length > 0) continue;
    out.push({
      kind: "isolated",
      severity: vocab.size >= 4 ? "BROKEN" : "MAJOR",
      marketRef,
      marketLabel: market.label,
      bookmaker,
      bookmakerCount: vocab.size,
      detail:
        `${bookmaker} używa selekcji [${[...set].slice(0, 6).join(", ")}], ` +
        `których nie używa żaden z pozostałych ${vocab.size - 1} bukmacherów — ` +
        `jego kursy nigdy nie stają w jednym wierszu z resztą`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Player on two different axes
// ---------------------------------------------------------------------------

export function findPlayerAxisSplit(market: ApiMarket, marketRef: string): VocabFinding[] {
  const vocab = vocabularyByBookmaker(market);
  if (vocab.size < 2) return [];

  const nameAxis: string[] = [];
  const codeAxis: string[] = [];
  for (const [bookmaker, set] of vocab) {
    const names = [...set].filter(looksLikePlayerName).length;
    if (names > 0 && names === set.size) nameAxis.push(bookmaker);
    else if (names === 0) codeAxis.push(bookmaker);
  }
  if (nameAxis.length === 0 || codeAxis.length === 0) return [];

  return [
    {
      kind: "player_axis",
      severity: "BROKEN",
      marketRef,
      marketLabel: market.label,
      bookmaker: nameAxis.join(", "),
      bookmakerCount: vocab.size,
      detail:
        `${nameAxis.join(", ")} trzyma zawodnika w SELEKCJI, a ` +
        `${codeAxis.join(", ")} w PARAMETRZE — ten sam zakład w dwóch ` +
        `niekompatybilnych układach, więc kursy się nie zestawiają`,
    },
  ];
}

// ---------------------------------------------------------------------------
// 3. Ranges of two different kinds under one code
// ---------------------------------------------------------------------------

export function findMixedRangeVocabulary(market: ApiMarket, marketRef: string): VocabFinding[] {
  const vocab = vocabularyByBookmaker(market);
  if (vocab.size < 2) return [];

  const cumulative: string[] = [];
  const disjoint: string[] = [];
  const overUnder: string[] = [];
  for (const [bookmaker, set] of vocab) {
    const types = [...set];
    if (types.some((t) => t === "OVER" || t === "UNDER")) overUnder.push(bookmaker);
    if (isCumulativeRangeSet(types)) cumulative.push(bookmaker);
    else if (isDisjointRangeSet(types)) disjoint.push(bookmaker);
  }

  const families = [
    ["skumulowane przedziały", cumulative] as const,
    ["rozłączne przedziały", disjoint] as const,
    ["OVER/UNDER", overUnder] as const,
  ].filter(([, list]) => list.length > 0);
  if (families.length < 2) return [];

  return [
    {
      kind: "mixed_range",
      severity: "BROKEN",
      marketRef,
      marketLabel: market.label,
      bookmaker: null,
      bookmakerCount: vocab.size,
      detail:
        `pod jednym kodem stoją różne produkty: ` +
        families.map(([name, list]) => `${name} (${list.join(", ")})`).join(" vs "),
    },
  ];
}

// ---------------------------------------------------------------------------
// 4. "3" next to "3+"
// ---------------------------------------------------------------------------

export function findTopBucketMismatch(market: ApiMarket, marketRef: string): VocabFinding[] {
  const vocab = vocabularyByBookmaker(market);
  if (vocab.size < 2) return [];

  // Only the HIGHEST bucket matters: "0, 1, 2, 3" against "0, 1, 2, 3+" is the
  // classic shape — the lower buckets agree and the top one silently changes
  // meaning from "exactly" to "or more".
  const exactTop = new Map<number, string[]>();
  const plusTop = new Map<number, string[]>();
  for (const [bookmaker, set] of vocab) {
    const types = [...set];
    const exacts = types.map(parseExactCount).filter((n): n is number => n !== null);
    const pluses = types.map(parseThresholdPlus).filter((n): n is number => n !== null);
    if (exacts.length === 0 && pluses.length === 0) continue;
    if (pluses.length > 0) {
      const top = Math.max(...pluses);
      if (exacts.every((n) => n < top)) plusTop.set(top, [...(plusTop.get(top) ?? []), bookmaker]);
    } else {
      const top = Math.max(...exacts);
      exactTop.set(top, [...(exactTop.get(top) ?? []), bookmaker]);
    }
  }

  const out: VocabFinding[] = [];
  for (const [value, exactBms] of exactTop) {
    const plusBms = plusTop.get(value);
    if (!plusBms) continue;
    out.push({
      kind: "top_bucket",
      severity: "MAJOR",
      marketRef,
      marketLabel: market.label,
      bookmaker: exactBms.join(", "),
      bookmakerCount: vocab.size,
      detail:
        `górny kubełek znaczy co innego u różnych bukmacherów: ` +
        `"${value}" (dokładnie) u ${exactBms.join(", ")} vs ` +
        `"${value}+" (lub więcej) u ${plusBms.join(", ")}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. Selections the catalog does not declare
// ---------------------------------------------------------------------------

export function findOffCatalogSelections(
  market: ApiMarket,
  marketRef: string,
  catalogSelections: string[] | undefined,
  parameterType: string | undefined,
): VocabFinding[] {
  if (!catalogSelections || catalogSelections.length === 0) return [];
  // A player-parameterised market legitimately carries free text in the
  // parameter, never in the selection — so the selection list still applies.
  const declared = new Set(catalogSelections);
  const vocab = vocabularyByBookmaker(market);

  const offenders = new Map<string, string[]>();
  for (const [bookmaker, set] of vocab) {
    const extra = [...set].filter((t) => t !== "UNKNOWN" && !declared.has(t));
    if (extra.length > 0) offenders.set(bookmaker, extra);
  }
  if (offenders.size === 0) return [];

  const allExtra = new Set([...offenders.values()].flat());
  // Every bookmaker off-catalog means the catalog entry is stale, not that one
  // bookmaker misbehaves — that is a catalog fix, and a louder one.
  const everyone = offenders.size === vocab.size && vocab.size > 1;

  return [
    {
      kind: "off_catalog",
      severity: everyone ? "MAJOR" : "MINOR",
      marketRef,
      marketLabel: market.label,
      bookmaker: everyone ? null : [...offenders.keys()].join(", "),
      bookmakerCount: vocab.size,
      detail:
        (everyone
          ? `katalog nie deklaruje żadnej z używanych selekcji`
          : `${[...offenders.keys()].join(", ")} emituje selekcje spoza katalogu`) +
        `: [${[...allExtra].slice(0, 8).join(", ")}] ` +
        `(katalog: [${catalogSelections.slice(0, 8).join(", ")}]` +
        `${parameterType ? `, parameterType=${parameterType}` : ""})`,
    },
  ];
}

// ---------------------------------------------------------------------------
// 6. Same labels, different event
// ---------------------------------------------------------------------------

export function findProductDivergence(
  market: ApiMarket,
  marketRef: string,
  args: Args,
): VocabFinding[] {
  const vocab = vocabularyByBookmaker(market);
  if (vocab.size < args.minBooks) return [];

  // Compare book sums over the SAME cells only — otherwise a bookmaker that
  // simply lists fewer players looks like a different product.
  const cellUsers = new Map<string, Set<string>>();
  const price = new Map<string, Map<string, number>>(); // bookmaker -> cell -> odds
  for (const param of market.parameters) {
    for (const entry of param.bookmakers) {
      for (const sel of entry.selections) {
        if (!(sel.odds > 1) || sel.type === "UNKNOWN") continue;
        const cell = `${param.value || "base"}|${sel.type}`;
        const users = cellUsers.get(cell) ?? new Set<string>();
        users.add(entry.bookmaker);
        cellUsers.set(cell, users);
        const row = price.get(entry.bookmaker) ?? new Map<string, number>();
        // Keep the first price for a cell; duplicates inside one bookmaker are a
        // different defect and the odds scanner already reports them.
        if (!row.has(cell)) row.set(cell, sel.odds);
        price.set(entry.bookmaker, row);
      }
    }
  }

  const common = [...cellUsers.entries()]
    .filter(([, users]) => users.size === vocab.size)
    .map(([cell]) => cell);
  // Fewer than four shared cells and a book sum says nothing.
  if (common.length < 4) return [];

  const sums = new Map<string, number>();
  for (const [bookmaker, row] of price) {
    let sum = 0;
    for (const cell of common) sum += implied(row.get(cell) ?? 0);
    sums.set(bookmaker, sum);
  }
  const med = median([...sums.values()]);
  if (med <= 0) return [];

  const out: VocabFinding[] = [];
  for (const [bookmaker, sum] of sums) {
    const deviation = Math.abs(sum - med) / med;
    if (deviation < args.bookDev) continue;
    out.push({
      kind: "product",
      severity: deviation >= 0.4 ? "BROKEN" : "MAJOR",
      marketRef,
      marketLabel: market.label,
      bookmaker,
      bookmakerCount: vocab.size,
      detail:
        `suma 1/kurs na ${common.length} wspólnych selekcjach: ${bookmaker} ${sum.toFixed(2)} ` +
        `vs mediana ${med.toFixed(2)} (${(deviation * 100).toFixed(0)}% różnicy) — ` +
        `te same etykiety, ale najpewniej inne zdarzenie`,
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

function scanMatch(data: NormalizedMarketsData, args: Args): VocabFinding[] {
  const findings: VocabFinding[] = [];
  for (const category of data.categories) {
    for (const market of category.markets) {
      const marketRef = `${category.name}/${market.marketKey}`;
      const entry = getMarketByCode(market.type) as
        | { selections?: string[]; parameterType?: string }
        | undefined;
      findings.push(...findIsolated(market, marketRef, args));
      findings.push(...findPlayerAxisSplit(market, marketRef));
      findings.push(...findMixedRangeVocabulary(market, marketRef));
      findings.push(...findTopBucketMismatch(market, marketRef));
      findings.push(
        ...findOffCatalogSelections(market, marketRef, entry?.selections, entry?.parameterType),
      );
      findings.push(...findProductDivergence(market, marketRef, args));
    }
  }
  findings.sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (s !== 0) return s;
    return b.bookmakerCount - a.bookmakerCount;
  });
  return findings;
}

function printSection(title: string, findings: VocabFinding[], top: number): void {
  if (findings.length === 0) return;
  console.error(`\n${title} (${findings.length})`);
  for (const f of findings.slice(0, top)) {
    console.error(`  [${f.severity}] ${f.marketRef} — ${f.detail}`);
  }
  if (findings.length > top) {
    console.error(`  … i ${findings.length - top} więcej (pełna lista w JSON)`);
  }
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
    findings: VocabFinding[];
  }[] = [];

  for (const target of targets) {
    let fetched;
    try {
      fetched = await fetchMatch(args, target.home, target.away, args.league);
    } catch (err) {
      console.error(`[selection-vocab] ${target.home} vs ${target.away}: ${err}`);
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
      printSection("BUKMACHER ODIZOLOWANY", findings.filter((f) => f.kind === "isolated"), args.top);
      printSection("ZAWODNIK NA DWÓCH OSIACH", findings.filter((f) => f.kind === "player_axis"), args.top);
      printSection("MIESZANE PRZEDZIAŁY", findings.filter((f) => f.kind === "mixed_range"), args.top);
      printSection("NIEZGODNY GÓRNY KUBEŁEK", findings.filter((f) => f.kind === "top_bucket"), args.top);
      printSection("SELEKCJE SPOZA KATALOGU", findings.filter((f) => f.kind === "off_catalog"), args.top);
      printSection("INNY PRODUKT POD TYMI SAMYMI ETYKIETAMI", findings.filter((f) => f.kind === "product"), args.top);
    }
  }

  const all = perMatch.flatMap((m) => m.findings);
  const bySeverity = { BROKEN: 0, MAJOR: 0, MINOR: 0 };
  const byKind: Record<string, number> = {};
  const byBookmaker: Record<string, number> = {};
  for (const f of all) {
    bySeverity[f.severity]++;
    byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
    if (f.bookmaker) {
      for (const bm of f.bookmaker.split(", ")) {
        byBookmaker[bm] = (byBookmaker[bm] ?? 0) + 1;
      }
    }
  }

  const report = {
    schemaVersion: 1,
    league: args.league,
    scannedAt: new Date().toISOString(),
    thresholds: { bookDev: args.bookDev, minBooks: args.minBooks },
    summary: {
      matches: perMatch.length,
      markets: perMatch.reduce((n, m) => n + m.markets, 0),
      findings: all.length,
      bySeverity,
      byKind,
      byBookmaker: Object.fromEntries(Object.entries(byBookmaker).sort((a, b) => b[1] - a[1])),
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
  process.argv[1] !== undefined && process.argv[1].endsWith("selection-vocab-scan.ts");
if (executedDirectly) {
  main().catch((err) => {
    console.error("[selection-vocab] fatal:", err);
    process.exit(2);
  });
}
