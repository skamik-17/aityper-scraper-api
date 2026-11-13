/**
 * Plan 10 Tasks 10-11: the dry-run and live report over a server log. It reads the
 * `[IncrementalPass] {json}` and `[FullPassCost] {json}` lines inside [from, to)
 * (by their `at` field; the log has no timestamps of its own) and checks the criteria
 * per (bookmaker, league).
 *
 * Dry run: plan-only passes estimate what incremental mode would have fetched, against
 * the hourly full passes' real cost. Live (`live: true`): incremental/forced passes,
 * pass counts and staleness only (there is no full-pass baseline).
 */
import { TIER_MAX_AGE_MS, type TierLabel } from "./due-plan.js";

export type ReportWindow = "quiet" | "matchday";

export interface BookmakerLeagueReport {
  bookmaker: string;
  league: string;
  warmPasses: number;
  coldPasses: number;
  fullPasses: number;
  fullBytes: number;
  fullRequests: number;
  /** Dry run: estimated incremental cost; live: the passes' real cost. */
  estBytes: number;
  estRequests: number;
  maxPreAgeMin: Partial<Record<TierLabel, number>>;
  failures: string[];
}

export interface IncrementalReport {
  window: ReportWindow;
  rows: BookmakerLeagueReport[];
  totalsOk: boolean;
  ok: boolean;
  failures: string[];
}

export const MIN_WARM_PASSES = 130;
export const MAX_COLD_PASSES = 2;
export const MIN_FULL_PASSES = 22;
/** Allowed pre-pass age above a tier's maximum (one pass gap plus jitter). */
export const STALENESS_SLACK_MIN = 12;

interface PassLine {
  bookmaker: string;
  league: string;
  mode: string;
  ledger: string;
  due: number;
  listingRequests: number;
  listingBytes: number;
  requests: number;
  bytes: number;
  preAgeMinByTier: Partial<Record<TierLabel, number>>;
}

interface FullLine {
  bookmaker: string;
  league: string;
  matches: number;
  requests: number;
  bytes: number;
}

const PASS_PREFIX = "[IncrementalPass] {";
const FULL_PREFIX = "[FullPassCost] {";

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function parseJson(line: string, prefix: string): Record<string, unknown> | null {
  if (!line.startsWith(prefix)) return null;
  try {
    const v: unknown = JSON.parse(line.slice(prefix.length - 1));
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function inWindow(j: Record<string, unknown>, o: { from: number; to: number }): boolean {
  const at = typeof j.at === "string" ? Date.parse(j.at) : NaN;
  return Number.isFinite(at) && at >= o.from && at < o.to;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const keyOf = (bm: string, league: string) => `${bm}/${league}`;

export function buildIncrementalReport(
  lines: readonly string[],
  o: { from: number; to: number; window: ReportWindow; live?: boolean },
): IncrementalReport {
  const live = o.live === true;
  const passModes = live ? new Set(["incremental", "forced"]) : new Set(["plan-only"]);
  const passes = new Map<string, PassLine[]>();
  const fulls = new Map<string, FullLine[]>();

  for (const line of lines) {
    const p = parseJson(line, PASS_PREFIX);
    if (p && inWindow(p, o) && typeof p.bookmaker === "string" && typeof p.league === "string" && passModes.has(String(p.mode))) {
      const k = keyOf(p.bookmaker, p.league);
      const list = passes.get(k) ?? [];
      list.push({
        bookmaker: p.bookmaker,
        league: p.league,
        mode: String(p.mode),
        ledger: String(p.ledger),
        due: num(p.due),
        listingRequests: num(p.listingRequests),
        listingBytes: num(p.listingBytes),
        requests: num(p.requests),
        bytes: num(p.bytes),
        preAgeMinByTier: (typeof p.preAgeMinByTier === "object" && p.preAgeMinByTier !== null ? p.preAgeMinByTier : {}) as PassLine["preAgeMinByTier"],
      });
      passes.set(k, list);
      continue;
    }
    const f = live ? null : parseJson(line, FULL_PREFIX);
    if (f && inWindow(f, o) && typeof f.bookmaker === "string" && typeof f.league === "string") {
      const k = keyOf(f.bookmaker, f.league);
      const list = fulls.get(k) ?? [];
      list.push({ bookmaker: f.bookmaker, league: f.league, matches: num(f.matches), requests: num(f.requests), bytes: num(f.bytes) });
      fulls.set(k, list);
    }
  }

  const rows: BookmakerLeagueReport[] = [];
  for (const [k, list] of [...passes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const { bookmaker, league } = list[0];
    // Live passes plan against the DB, so every one of them is warm
    const warm = list.filter((p) => live || p.ledger !== "cold");
    const coldPasses = list.length - warm.length;
    const full = fulls.get(k) ?? [];
    const fullBytes = full.reduce((s, f) => s + f.bytes, 0);
    const fullRequests = full.reduce((s, f) => s + f.requests, 0);

    let estBytes: number;
    let estRequests: number;
    if (live) {
      estBytes = warm.reduce((s, p) => s + p.bytes, 0);
      estRequests = warm.reduce((s, p) => s + p.requests, 0);
    } else {
      // Detail cost per match from the full passes, minus their listing (the passes' median)
      const fullMatches = full.reduce((s, f) => s + f.matches, 0);
      const sumDue = warm.reduce((s, p) => s + p.due, 0);
      const detail = (total: number, listing: number) =>
        fullMatches > 0 ? Math.max(0, total - full.length * listing) / fullMatches : 0;
      const perMatchBytes = detail(fullBytes, median(warm.map((p) => p.listingBytes)));
      const perMatchRequests = detail(fullRequests, median(warm.map((p) => p.listingRequests)));
      estBytes = Math.round(warm.reduce((s, p) => s + p.listingBytes, 0) + sumDue * perMatchBytes);
      estRequests = Math.round(warm.reduce((s, p) => s + p.listingRequests, 0) + sumDue * perMatchRequests);
    }

    const maxPreAgeMin: Partial<Record<TierLabel, number>> = {};
    for (const p of warm) {
      for (const [tier, age] of Object.entries(p.preAgeMinByTier) as Array<[TierLabel, number]>) {
        if (typeof age === "number") maxPreAgeMin[tier] = Math.max(maxPreAgeMin[tier] ?? age, age);
      }
    }

    const failures: string[] = [];
    const fail = (text: string) => failures.push(`${k}: ${text}`);
    if (warm.length < MIN_WARM_PASSES) fail(`${warm.length} warm passes < ${MIN_WARM_PASSES}`);
    if (coldPasses > MAX_COLD_PASSES) fail(`${coldPasses} cold passes > ${MAX_COLD_PASSES}`);
    if (!live && full.length < MIN_FULL_PASSES) fail(`${full.length} full passes < ${MIN_FULL_PASSES}`);
    for (const [tier, age] of Object.entries(maxPreAgeMin) as Array<[TierLabel, number]>) {
      const limit = TIER_MAX_AGE_MS[tier] / 60_000 + STALENESS_SLACK_MIN;
      if (age > limit) fail(`${tier} max age ${age} min > ${limit}`);
    }
    if (!live) {
      const factor = o.window === "quiet" ? 1 : 2;
      if (estBytes > factor * fullBytes) fail(`est bytes ${estBytes} > ${factor} x full bytes ${fullBytes}`);
    }
    if (o.window === "matchday") {
      for (const tier of ["lt1h", "1to3h"] as const) if (maxPreAgeMin[tier] === undefined) fail(`no ${tier} observation`);
    }
    rows.push({ bookmaker, league, warmPasses: warm.length, coldPasses, fullPasses: full.length, fullBytes, fullRequests, estBytes, estRequests, maxPreAgeMin, failures });
  }

  const failures = rows.flatMap((r) => r.failures);
  let totalsOk = true;
  if (!live && o.window === "quiet" && rows.length > 0) {
    const sum = (f: (r: BookmakerLeagueReport) => number) => rows.reduce((s, r) => s + f(r), 0);
    if (sum((r) => r.estBytes) > 0.6 * sum((r) => r.fullBytes)) {
      totalsOk = false;
      failures.push(`totals: est bytes ${sum((r) => r.estBytes)} > 0.6 x full bytes ${sum((r) => r.fullBytes)}`);
    }
    if (sum((r) => r.estRequests) > 0.9 * sum((r) => r.fullRequests)) {
      totalsOk = false;
      failures.push(`totals: est requests ${sum((r) => r.estRequests)} > 0.9 x full requests ${sum((r) => r.fullRequests)}`);
    }
  }
  if (rows.length === 0) failures.push("no [IncrementalPass] lines in the window");
  return { window: o.window, rows, totalsOk, ok: rows.length > 0 && failures.length === 0, failures };
}

const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1);

export function formatIncrementalReport(r: IncrementalReport): string {
  const out: string[] = [`Incremental report (${r.window})`];
  for (const row of r.rows) {
    const ratio = row.fullBytes > 0 ? (row.estBytes / row.fullBytes).toFixed(2) : "-";
    const ages = Object.entries(row.maxPreAgeMin)
      .map(([t, a]) => `${t}=${a}`)
      .join(",");
    out.push(
      `${row.bookmaker}/${row.league} warm=${row.warmPasses} cold=${row.coldPasses} full=${row.fullPasses} ` +
        `fullMB=${mb(row.fullBytes)} estMB=${mb(row.estBytes)} ratio=${ratio} req=${row.estRequests}/${row.fullRequests} ` +
        `maxAge=[${ages}] ${row.failures.length === 0 ? "PASS" : "FAIL"}`,
    );
  }
  if (r.failures.length > 0) {
    out.push("Failures:");
    for (const f of r.failures) out.push(`  ${f}`);
  }
  out.push(`RESULT: ${r.ok ? "PASS" : "FAIL"}`);
  return out.join("\n");
}
