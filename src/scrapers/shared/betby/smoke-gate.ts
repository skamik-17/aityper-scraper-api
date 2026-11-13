/**
 * Pure logic of `scripts/betby-smoke.ts`: its argument parsing and its acceptance gate (criteria
 * A1-A5 and A8 of docs/superpowers/plans/2026-11-06-scraper-recovery/betby-betters-lebull.md).
 * No I/O: the script scrapes, normalizes and reads the odds API; this module turns what it found
 * into numbers and a verdict.
 */
import type { ScrapedMarket } from "../../../types/full-offer.js";
import { MIN_VALID_ODDS } from "./parser.js";

const DAY_MS = 86_400_000;

/** Fewer peer prices than this give no median worth comparing against (A4). */
const MIN_PEERS = 3;

/** The MATCH_WINNER selection codes A4 checks. */
const ONE_X_TWO_CODES = ["HOME", "DRAW", "AWAY"] as const;

/** Flags of `scripts/betby-smoke.ts` that take a value. */
const SMOKE_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--bookmaker",
  "--league",
  "--compare-api",
  "--max-days",
  "--min-markets",
  "--max-listing-only",
  "--max-1x2-dev",
]);

/**
 * Never used as a peer for a Betby price. Both brands quote the same Sportradar price, so one
 * brand would hide the other's deviation.
 */
const NON_PEER_BOOKMAKERS: ReadonlySet<string> = new Set(["betters", "lebull"]);

/** One scraped Betby match, reduced to what the gate judges. */
export interface SmokeMatchRow {
  eventId: string;
  /** ISO 8601 kick-off. */
  startTime: string;
  /** The event endpoint gave a payload (false: the match fell back to its listing markets). */
  full: boolean;
  /** Normalized non-OTHER markets. */
  normalized: number;
  /** Selections with code UNKNOWN inside non-OTHER markets. */
  unknownInMapped: number;
  /** Lowest price over every selection of the match. */
  minOdds: number;
  /**
   * Scraped phase-1 pairs whose specifier key set changed (`18[total=2.5|type=x]`), from
   * findSpecifierKeyMismatches. The normalizer drops each of them, so a whole family can vanish
   * while the match still clears `minMarkets`.
   */
  keyMismatches: string[];
  /** Found in the odds API by canonical home/away; null without `--compare-api`. */
  apiFound: boolean | null;
  /** Largest MATCH_WINNER oneXTwoDeviation; null when no selection had enough peers. */
  max1x2Dev: number | null;
  /** HOME/DRAW/AWAY codes that at least 3 peers quote but Betby's MATCH_WINNER lacks (matchWinnerMissing). */
  oneXTwoMissing: string[];
}

export interface SmokeGateOptions {
  nowMs: number;
  /** Depth (A2) is gated only for matches kicking off within this many days. */
  maxDays: number;
  minMarkets: number;
  maxListingOnly: number;
  max1x2Dev: number;
  maxDurationMs: number;
}

export interface SmokeVerdict {
  result: "PASS" | "FAIL" | "SKIP";
  reasons: string[];
  /** Rows kicking off within `maxDays`. */
  gated: number;
  /** Full rows further out with fewer than `minMarkets` normalized markets (reported, not failed). */
  shallow: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * True when the match kicks off within `maxDays` of `nowMs`, so the depth rules (A2) apply.
 * An unreadable kick-off cannot prove the match is far away, so it counts as gated.
 */
export function isGated(startTime: string, o: Pick<SmokeGateOptions, "nowMs" | "maxDays">): boolean {
  return !(Date.parse(startTime) - o.nowMs > o.maxDays * DAY_MS);
}

/** `0.0214` -> `"2.1%"`; null -> `"n/a"`. */
export function formatPct(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

/** `|odds / median(peers) - 1|`, or null with fewer than 3 peers. */
export function oneXTwoDeviation(odds: number, peers: number[]): number | null {
  if (peers.length < MIN_PEERS) return null;
  return Math.abs(odds / median(peers) - 1);
}

/** Normalized non-OTHER markets, UNKNOWN selections among them, and the lowest price of all selections. */
export function marketStats(normalized: ScrapedMarket[]): Pick<SmokeMatchRow, "normalized" | "unknownInMapped" | "minOdds"> {
  let mapped = 0;
  let unknownInMapped = 0;
  let minOdds = Number.POSITIVE_INFINITY;
  for (const m of normalized) {
    for (const s of m.selections) minOdds = Math.min(minOdds, s.odds);
    if (m.normalizedType === undefined || m.normalizedType === "OTHER") continue;
    mapped++;
    unknownInMapped += m.selections.filter((s) => s.normalizedName === "UNKNOWN").length;
  }
  return { normalized: mapped, unknownInMapped, minOdds };
}

/** One `data.matches[]` row of `GET /api/odds?league=`, reduced to what the smoke reads. */
export interface OddsListMatch {
  homeTeam: string;
  awayTeam: string;
  markets?: Record<
    string,
    { bookmakerOdds?: Record<string, { selections?: Array<{ normalizedName?: unknown; odds?: unknown } | null> } | null> } | null
  >;
}

/** Join key of a match: exact canonical names, home first (a swapped fixture is a different key). */
export const oddsListKey = (homeTeam: string, awayTeam: string): string => JSON.stringify([homeTeam, awayTeam]);

/** The `GET /api/odds?league=` body indexed by oddsListKey; empty for any other shape. */
export function indexOddsList(body: unknown): Map<string, OddsListMatch> {
  const index = new Map<string, OddsListMatch>();
  const rows = (body as { data?: { matches?: unknown } } | null)?.data?.matches;
  if (!Array.isArray(rows)) return index;
  for (const row of rows as Array<Partial<OddsListMatch> | null>) {
    if (typeof row?.homeTeam === "string" && typeof row.awayTeam === "string") {
      index.set(oddsListKey(row.homeTeam, row.awayTeam), row as OddsListMatch);
    }
  }
  return index;
}

/** MATCH_WINNER prices of the other bookmakers for one selection code; both Betby brands are left out. */
export function matchWinnerPeers(match: OddsListMatch, code: string): number[] {
  const peers: number[] = [];
  for (const [bookmaker, quote] of Object.entries(match.markets?.MATCH_WINNER?.bookmakerOdds ?? {})) {
    if (NON_PEER_BOOKMAKERS.has(bookmaker)) continue;
    for (const s of quote?.selections ?? []) {
      if (s?.normalizedName === code && typeof s.odds === "number" && Number.isFinite(s.odds) && s.odds > 1) {
        peers.push(s.odds);
      }
    }
  }
  return peers;
}

/**
 * Largest oneXTwoDeviation over every normalized MATCH_WINNER selection; null when none has 3
 * peers. An unreadable price gives no deviation (A3 fails it), so it cannot hide the others.
 */
export function matchWinnerDeviation(normalized: ScrapedMarket[], match: OddsListMatch): number | null {
  let max: number | null = null;
  for (const m of normalized) {
    if (m.normalizedType !== "MATCH_WINNER") continue;
    for (const s of m.selections) {
      const dev = oneXTwoDeviation(s.odds, matchWinnerPeers(match, String(s.normalizedName)));
      if (dev !== null && Number.isFinite(dev) && (max === null || dev > max)) max = dev;
    }
  }
  return max;
}

/**
 * HOME/DRAW/AWAY codes that at least 3 other bookmakers quote for the match but no normalized
 * MATCH_WINNER selection carries with a usable price, in that order. A4 has nothing to compare
 * for such a code, so without this a dropped or half-dropped 1X2 would pass.
 */
export function matchWinnerMissing(normalized: ScrapedMarket[], match: OddsListMatch): string[] {
  const priced = new Set<string>();
  for (const m of normalized) {
    if (m.normalizedType !== "MATCH_WINNER") continue;
    for (const s of m.selections) if (Number.isFinite(s.odds)) priced.add(String(s.normalizedName));
  }
  return ONE_X_TWO_CODES.filter((code) => !priced.has(code) && matchWinnerPeers(match, code).length >= MIN_PEERS);
}

/**
 * The flags of `scripts/betby-smoke.ts`: `help` when `--help` or `-h` is given, otherwise every
 * value flag with its value. Throws on an unknown or repeated flag, a value flag that is last or
 * followed by another flag, and any other stray argument, so a typo such as `--compare_api` or a
 * trailing `--compare-api` cannot switch A4/A5 off while the run still passes.
 */
export function parseSmokeFlags(argv: string[]): { help: boolean; values: Map<string, string> } {
  const values = new Map<string, string>();
  if (argv.includes("--help") || argv.includes("-h")) return { help: true, values };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!SMOKE_VALUE_FLAGS.has(flag)) {
      throw new Error(flag.startsWith("-") ? `unknown option "${flag}"` : `unexpected argument "${flag}"`);
    }
    if (values.has(flag)) throw new Error(`${flag} is given twice`);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (value.startsWith("--")) throw new Error(`${flag} needs a value (got "${value}")`);
    values.set(flag, value);
    i++;
  }
  return { help: false, values };
}

/**
 * The smoke verdict. An empty snapshot (off-season) is SKIP. Otherwise every rule that breaks
 * adds a reason, and any reason makes it FAIL:
 * A1 a match was dropped; A2 a match within `maxDays` with a full payload is thin, or too many
 * of them fell back to listing markets; A3 an UNKNOWN selection in a mapped market, a price
 * below 1.01, or a phase-1 market whose specifier keys changed (any match, gated or far);
 * A4 a MATCH_WINNER price strays from the peer median, or a side that peers quote is missing;
 * A5 a match is missing from the odds API; A8 the run took too long.
 */
export function evaluateSmoke(
  snapshotCount: number,
  rows: SmokeMatchRow[],
  durationMs: number,
  o: SmokeGateOptions,
): SmokeVerdict {
  if (snapshotCount === 0) return { result: "SKIP", reasons: [], gated: 0, shallow: 0 };

  const reasons: string[] = [];
  if (rows.length !== snapshotCount) reasons.push(`matches=${rows.length} != snapshot=${snapshotCount}`);

  let gated = 0;
  let shallow = 0;
  const listingOnly: string[] = [];
  for (const r of rows) {
    const near = isGated(r.startTime, o);
    if (near) gated++;
    if (r.full && r.normalized < o.minMarkets) {
      if (near) reasons.push(`${r.eventId} normalized=${r.normalized} < ${o.minMarkets}`);
      else shallow++;
    }
    if (near && !r.full) listingOnly.push(r.eventId);
  }
  if (listingOnly.length > o.maxListingOnly) {
    reasons.push(`listingOnlyGated=${listingOnly.length} > ${o.maxListingOnly} (${listingOnly.join(", ")})`);
  }

  for (const r of rows) {
    if (r.unknownInMapped > 0) reasons.push(`${r.eventId} unknownInMapped=${r.unknownInMapped}`);
    // Negated so that a NaN price fails too.
    if (!(r.minOdds >= MIN_VALID_ODDS)) reasons.push(`${r.eventId} minOdds=${r.minOdds} < ${MIN_VALID_ODDS}`);
    if (r.keyMismatches.length > 0) reasons.push(`${r.eventId} keyMismatch=${r.keyMismatches.join(",")}`);
  }
  for (const r of rows) {
    if (r.max1x2Dev !== null && r.max1x2Dev > o.max1x2Dev) {
      reasons.push(`${r.eventId} max1x2Dev=${formatPct(r.max1x2Dev)} > ${formatPct(o.max1x2Dev)}`);
    }
    if (r.oneXTwoMissing.length > 0) reasons.push(`${r.eventId} 1x2Missing=${r.oneXTwoMissing.join(",")}`);
  }
  for (const r of rows) {
    if (r.apiFound === false) reasons.push(`${r.eventId} api=missing`);
  }
  if (durationMs >= o.maxDurationMs) reasons.push(`durationMs=${durationMs} >= ${o.maxDurationMs}`);

  return { result: reasons.length > 0 ? "FAIL" : "PASS", reasons, gated, shallow };
}
