#!/usr/bin/env npx tsx
/**
 * PZBuk live smoke test.
 *
 * Scrapes one league's full offer with the real PZBuk scraper (opens a
 * browser and calls pzbuk.pl; no DB and no running server needed), normalizes
 * every market the way the service does before saving (scrape-helpers.ts), and
 * checks the acceptance thresholds of
 * docs/superpowers/plans/2026-11-06-scraper-recovery/pzbuk.md. With --peers it
 * also compares PZBuk MATCH_WINNER with the median of the other bookmakers
 * that a running odds API serves (one read-only GET /api/odds).
 *
 * Output: one "MATCH {...}" line per scraped match and one "SMOKE {...}"
 * summary line. Exit 0 when "pass" is true, 1 otherwise.
 *
 * "pass" requires:
 *   A1  success and >= 18 matches
 *   A2  >= 90 parsed markets on every match
 *   A3  >= 40 non-OTHER normalized markets on every match
 *   A4  <= 2% UNKNOWN among the selections of non-OTHER markets, every match
 *   A5  0 non-OTHER marketKey collisions with overlapping selection codes
 *   A6  every PZBuk MATCH_WINNER selection within 8% of the peer median, or
 *       within 1 percentage point of its implied probability (long shots
 *       spread more than 8% between bookmakers; a swap or a leaked market
 *       is far outside both). A match without a peer row or without peers
 *       reports null and does not fail.
 *   A12 gatedNonOther = 0: no ordinal ("2. gol") or unrendered template
 *       ("{SpecialIntValue1}. gol") market outside OTHER
 * Reported only: the transport counters invalidFrames / chunkedFrames /
 * maxFrameBytes (A11), ordinalMarkets / templateMarkets (A12) and durationMs
 * (A8, wall clock of scrapeFullOffer; <= 600000 expected).
 *
 * Usage:
 *   npx tsx scripts/pzbuk-smoke.ts --league premier-league
 *   npx tsx scripts/pzbuk-smoke.ts --league premier-league --peers http://localhost:3001
 *   npx tsx scripts/pzbuk-smoke.ts --help
 */
import { pzbukScraper } from "../src/scrapers/bookmakers/pzbuk/index.js";
import { normalizeMarketsForBookmaker } from "../src/services/normalization/index.js";
import type { FullMatchOffer, ScrapedMarket } from "../src/types/full-offer.js";

/** A1: matches scraped. */
const MIN_MATCHES = 18;
/** A2: parsed markets on every match (the 7-group estimate is 105). */
const MIN_PARSED = 90;
/** A3: non-OTHER normalized markets on every match. */
const MIN_NON_OTHER = 40;
/** A4: UNKNOWN share among the selections of non-OTHER markets, every match. */
const MAX_UNKNOWN_SHARE = 0.02;
/** A5: non-OTHER marketKey collisions with overlapping selection codes. */
const MAX_COLLISIONS = 0;
/** A6: PZBuk MATCH_WINNER against the peer median, every selection. */
const MAX_1X2_DEVIATION = 0.08;
/**
 * A6, long shots: an implied-probability gap this small to the peer median
 * passes whatever the relative odds gap (selectionDeviation).
 */
const MAX_1X2_PROBABILITY_GAP = 0.01;

/** The Task 4 ordinal gate (PZBUK_NAME_OVERRIDES in pzbuk-normalizer.ts). */
const ORDINAL_NAME = /(?:^|\s)(?:[2-9]|\d{2,})\.\s*(?:gol|strzelec|kartk)/i;
/** An unrendered {SpecialIntValue} template (blank market.name on the wire). */
const TEMPLATE_NAME = /\{SpecialIntValue\d*\}/i;

const BOOKMAKER = "pzbuk";
const PEERS_TIMEOUT_MS = 30_000;

const USAGE = `Usage: npx tsx scripts/pzbuk-smoke.ts --league <slug> [--peers <baseUrl>]

  --league <slug>    league to scrape, e.g. premier-league (required)
  --peers <baseUrl>  odds API to compare MATCH_WINNER with (median of its other
                     bookmakers), e.g. http://localhost:3001; one GET /api/odds
  --help, -h         print this help and exit

Opens a browser and calls pzbuk.pl; never writes to the DB.
Prints one MATCH line per match and one SMOKE line; exit 0 when "pass" is true, 1 otherwise.`;

type TransportStats = typeof pzbukScraper.lastTransportStats;

export interface Args {
  league?: string;
  peers?: string;
  help: boolean;
}

export function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i < argv.length - 1 ? argv[i + 1] : undefined;
  };
  return {
    league: get("--league"),
    peers: get("--peers"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

/**
 * Normalizes one match like the service does before saving, with the
 * per-market "Unknown market" / "mapped to OTHER" console noise muted.
 */
export function normalizeQuietly(match: FullMatchOffer, league: string): ScrapedMarket[] {
  const { log, warn } = console;
  console.log = console.warn = () => {};
  try {
    return normalizeMarketsForBookmaker(match.markets, BOOKMAKER, match.homeTeam, match.awayTeam, league);
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

export interface MarketCounts {
  nonOther: number;
  unknownShareNonOther: number;
  /** "marketKey:code <- market name" for every overlapping selection code. */
  collisions: string[];
  ordinalMarkets: number;
  templateMarkets: number;
  /** Names of ordinal or template markets that left OTHER. */
  gated: string[];
}

export function countMarkets(normalized: ScrapedMarket[]): MarketCounts {
  let nonOther = 0;
  let nonOtherSelections = 0;
  let unknown = 0;
  let ordinalMarkets = 0;
  let templateMarkets = 0;
  const collisions: string[] = [];
  const gated: string[] = [];
  // Same rule as pzbuk-real-names.test.ts "has no non-OTHER marketKey collision
  // with overlapping selection codes": storage resolves such a pair first-seen.
  const seen = new Map<string, Set<string>>();

  for (const m of normalized) {
    const ordinal = ORDINAL_NAME.test(m.name.trim());
    const template = TEMPLATE_NAME.test(m.name);
    if (ordinal) ordinalMarkets++;
    if (template) templateMarkets++;
    if (m.normalizedType === "OTHER") continue;

    nonOther++;
    if (ordinal || template) gated.push(m.name);
    const key = String(m.marketKey);
    const codes = seen.get(key) ?? new Set<string>();
    for (const s of m.selections) {
      nonOtherSelections++;
      if (s.normalizedName === "UNKNOWN") unknown++;
      if (codes.has(String(s.normalizedName))) collisions.push(`${key}:${s.normalizedName} <- ${m.name}`);
      codes.add(String(s.normalizedName));
    }
    seen.set(key, codes);
  }

  return {
    nonOther,
    unknownShareNonOther: nonOtherSelections > 0 ? unknown / nonOtherSelections : 0,
    collisions,
    ordinalMarkets,
    templateMarkets,
    gated,
  };
}

/** One `data.matches[]` row of GET /api/odds, reduced to what the 1X2 check reads. */
export interface PeerRow {
  homeTeam: string;
  awayTeam: string;
  markets?: Record<
    string,
    { bookmakerOdds?: Record<string, { selections?: Array<{ normalizedName?: unknown; odds?: unknown }> }> } | undefined
  >;
}

/** Join key: exact canonical names on both sides (getCanonicalTeamName / stored names). */
export const peerKey = (homeTeam: string, awayTeam: string): string => JSON.stringify([homeTeam, awayTeam]);

export function indexPeerRows(body: unknown): Map<string, PeerRow> {
  const index = new Map<string, PeerRow>();
  const rows = (body as { data?: { matches?: unknown } } | null)?.data?.matches;
  if (!Array.isArray(rows)) return index;
  for (const row of rows as Array<Partial<PeerRow> | null>) {
    if (typeof row?.homeTeam === "string" && typeof row.awayTeam === "string") {
      index.set(peerKey(row.homeTeam, row.awayTeam), row as PeerRow);
    }
  }
  return index;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One PZBuk MATCH_WINNER selection next to the median of the same code across the peers. */
export interface X12Quote {
  code: string;
  odds: number;
  median: number;
}

/**
 * Every PZBuk MATCH_WINNER selection that has peer quotes for its code, with
 * the median of the other bookmakers of the peer row. Every PZBuk
 * MATCH_WINNER market is compared, so a second, leaked one counts too.
 */
export function matchWinnerQuotes(normalized: ScrapedMarket[], peer: PeerRow): X12Quote[] {
  const others = Object.entries(peer.markets?.MATCH_WINNER?.bookmakerOdds ?? {})
    .filter(([bookmaker]) => bookmaker !== BOOKMAKER)
    .flatMap(([, quote]) => quote?.selections ?? []);
  const quotes: X12Quote[] = [];
  for (const m of normalized) {
    if (m.normalizedType !== "MATCH_WINNER") continue;
    for (const s of m.selections) {
      const reference = median(
        others
          .filter((p) => p?.normalizedName === s.normalizedName)
          .map((p) => p.odds)
          .filter((odds): odds is number => typeof odds === "number" && Number.isFinite(odds) && odds > 1),
      );
      if (reference !== null) quotes.push({ code: String(s.normalizedName), odds: s.odds, median: reference });
    }
  }
  return quotes;
}

/**
 * A6 deviation of one selection: the relative odds gap, or the
 * implied-probability gap rescaled so that MAX_1X2_PROBABILITY_GAP equals
 * MAX_1X2_DEVIATION, whichever is smaller. It exceeds MAX_1X2_DEVIATION only
 * when both gaps exceed their limits. The probability gap equals the relative
 * gap divided by the PZBuk price, so for prices up to 8 (MAX_1X2_DEVIATION /
 * MAX_1X2_PROBABILITY_GAP) this is the plain relative check.
 */
export function selectionDeviation(odds: number, reference: number): number {
  const relative = Math.abs(odds / reference - 1);
  const probabilityGap = Math.abs(1 / odds - 1 / reference);
  return Math.min(relative, probabilityGap * (MAX_1X2_DEVIATION / MAX_1X2_PROBABILITY_GAP));
}

/** Largest selectionDeviation over the quotes; null when nothing could be compared. */
const maxDeviation = (quotes: X12Quote[]): number | null =>
  quotes.length > 0 ? Math.max(...quotes.map((q) => selectionDeviation(q.odds, q.median))) : null;

export interface MatchReport extends MarketCounts {
  homeTeam: string;
  awayTeam: string;
  parsed: number;
  peerMatched: boolean;
  x12Deviation: number | null;
  /** The compared selections, so x12Deviation can be checked by hand. */
  x12Quotes: X12Quote[];
}

export function evaluateMatch(
  match: FullMatchOffer,
  normalized: ScrapedMarket[],
  peers: Map<string, PeerRow> | null,
): MatchReport {
  const peer = peers?.get(peerKey(match.homeTeam, match.awayTeam));
  const x12Quotes = peer ? matchWinnerQuotes(normalized, peer) : [];
  return {
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    parsed: match.markets.length,
    ...countMarkets(normalized),
    peerMatched: peer !== undefined,
    x12Deviation: maxDeviation(x12Quotes),
    x12Quotes,
  };
}

export interface SmokeSummary {
  success: boolean;
  matches: number;
  minParsedMarkets: number;
  minNonOther: number;
  maxUnknownShareNonOther: number;
  collisions: number;
  peerMatched: number;
  max1x2Deviation: number | null;
  invalidFrames: number;
  chunkedFrames: number;
  maxFrameBytes: number;
  ordinalMarkets: number;
  templateMarkets: number;
  gatedNonOther: number;
  durationMs: number;
  pass: boolean;
}

export function summarize(input: {
  success: boolean;
  reports: MatchReport[];
  transport: TransportStats;
  durationMs: number;
}): SmokeSummary {
  const { success, reports, transport, durationMs } = input;
  const values = (pick: (r: MatchReport) => number) => reports.map(pick);
  const min = (pick: (r: MatchReport) => number) => (reports.length > 0 ? Math.min(...values(pick)) : 0);
  const max = (pick: (r: MatchReport) => number) => (reports.length > 0 ? Math.max(...values(pick)) : 0);
  const sum = (pick: (r: MatchReport) => number) => values(pick).reduce((a, b) => a + b, 0);
  const deviations = reports.map((r) => r.x12Deviation).filter((d): d is number => d !== null);

  const minParsedMarkets = min((r) => r.parsed);
  const minNonOther = min((r) => r.nonOther);
  const maxUnknownShareNonOther = max((r) => r.unknownShareNonOther);
  const collisions = sum((r) => r.collisions.length);
  const max1x2Deviation = deviations.length > 0 ? Math.max(...deviations) : null;
  const gatedNonOther = sum((r) => r.gated.length);

  // The transport counters and ordinalMarkets/templateMarkets never affect the verdict (A11, A12).
  const pass =
    success &&
    reports.length >= MIN_MATCHES &&
    minParsedMarkets >= MIN_PARSED &&
    minNonOther >= MIN_NON_OTHER &&
    maxUnknownShareNonOther <= MAX_UNKNOWN_SHARE &&
    collisions <= MAX_COLLISIONS &&
    (max1x2Deviation === null || max1x2Deviation <= MAX_1X2_DEVIATION) &&
    gatedNonOther === 0;

  return {
    success,
    matches: reports.length,
    minParsedMarkets,
    minNonOther,
    maxUnknownShareNonOther,
    collisions,
    peerMatched: reports.filter((r) => r.peerMatched).length,
    max1x2Deviation,
    invalidFrames: transport.invalidFrames,
    chunkedFrames: transport.chunkedFrames,
    maxFrameBytes: transport.maxFrameBytes,
    ordinalMarkets: sum((r) => r.ordinalMarkets),
    templateMarkets: sum((r) => r.templateMarkets),
    gatedNonOther,
    durationMs,
    pass,
  };
}

async function fetchPeers(baseUrl: string, league: string): Promise<Map<string, PeerRow> | null> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/odds?league=${encodeURIComponent(league)}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PEERS_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const index = indexPeerRows(await response.json());
    console.log(`[pzbuk-smoke] peers: ${index.size} fixtures from ${url}`);
    return index;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[pzbuk-smoke] peers unavailable (${url}): ${reason}; max1x2Deviation stays null`);
    return null;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (!args.league) {
    console.error(USAGE);
    process.exit(1);
  }
  const league = args.league;

  let pass = false;
  try {
    const startedAt = Date.now();
    const result = await pzbukScraper.scrapeFullOffer(league);
    const durationMs = Date.now() - startedAt;
    const transport = { ...pzbukScraper.lastTransportStats };
    if (!result.success) {
      console.log(`[pzbuk-smoke] scrapeFullOffer failed: ${result.error ?? "(no error message)"}`);
    }

    const peers = args.peers ? await fetchPeers(args.peers, league) : null;
    const reports = result.matches.map((m) => evaluateMatch(m, normalizeQuietly(m, league), peers));
    for (const report of reports) console.log(`MATCH ${JSON.stringify(report)}`);

    const smoke = summarize({ success: result.success, reports, transport, durationMs });
    console.log(`SMOKE ${JSON.stringify(smoke)}`);
    pass = smoke.pass;
  } finally {
    await pzbukScraper.cleanup();
  }
  process.exit(pass ? 0 : 1);
}

const executedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith("pzbuk-smoke.ts");
if (executedDirectly) {
  main().catch((err) => {
    console.error("[pzbuk-smoke] FAILED:", err);
    process.exit(1);
  });
}
