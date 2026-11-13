#!/usr/bin/env npx tsx
/**
 * PZBuk live smoke test.
 *
 * Scrapes one league's full offer with the picked PZBuk scraper (calls
 * pzbuk.pl over its WebSocket API, a browser only with
 * SCRAPER_TRANSPORT_PZBUK=browser; no DB and no running server needed), normalizes
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
 *   A5  0 non-OTHER marketKey collisions with overlapping selection codes, and
 *       0 vocabularyMisses: no selection code outside the catalog vocabulary
 *       of a non-OTHER, non-player market (UNKNOWN is A4's)
 *       0 invalidOdds: every normalized selection has a finite price above 1
 *   A6  every compared PZBuk MATCH_WINNER selection within 2.5 percentage
 *       points of the peer median's implied probability (controller ruling
 *       11: a relative band on decimal odds fails legitimate long shots,
 *       while a swap or a 10x leak is far outside the band; the peer
 *       [min, max] is not a pass criterion, as one swapped peer widens it).
 *       A match without a peer row or without peers is not
 *       compared and does not fail, but peers that were requested with
 *       --peers and could not be loaded fail the run ("A6 NOT CHECKED").
 *   A12 gatedNonOther = 0: no ordinal ("2. gol") or unrendered template
 *       ("{SpecialIntValue1}. gol") market outside OTHER
 * Reported only: droppedMarkets (the normalizer's fail-closed
 * "[pzbuk] Dropping …" warnings; inspect each one), the transport counters
 * invalidFrames / chunkedFrames / maxFrameBytes (A11), ordinalMarkets /
 * templateMarkets (A12) and durationMs (A8, wall clock of scrapeFullOffer;
 * < 3000 expected on the default WebSocket transport, <= 600000 on the browser).
 *
 * Usage:
 *   npx tsx scripts/pzbuk-smoke.ts --league premier-league
 *   npx tsx scripts/pzbuk-smoke.ts --league premier-league --peers http://localhost:3001
 *   npx tsx scripts/pzbuk-smoke.ts --help
 */
import { pzbukScraper } from "../src/scrapers/bookmakers/index.js";
import { hasFrameCounters, type PzbukFrameCounters } from "../src/scrapers/bookmakers/pzbuk/index.js";
import { getMarketMetadata } from "../src/data/market-catalog.js";
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
/**
 * A6: largest |1/odds - 1/median| (implied probability) of a PZBuk
 * MATCH_WINNER selection against the peer median (withinPeerBand). The peer
 * [min, max] is reported but never lets a price pass.
 */
const MAX_1X2_IMPLIED_PROBABILITY_GAP = 0.025;
/** Catalog view types whose selection list is a player placeholder, not a closed vocabulary. */
const PLAYER_VIEW_TYPES = new Set<string>(["PLAYER_DROPDOWN", "PLAYER_STAT_LINES", "PARAMETERIZED_COMBINATION"]);
/** Prefix of the normalizer's fail-closed drop warning (pzbuk-normalizer.ts normalizeMarket). */
const DROP_WARNING = "[pzbuk] Dropping";

/** The Task 4 ordinal gate (PZBUK_NAME_OVERRIDES in pzbuk-normalizer.ts). */
const ORDINAL_NAME = /(?:^|\s)(?:[2-9]|\d{2,})\.\s*(?:gol|strzelec|kartk)/i;
/** An unrendered {SpecialIntValue} template (blank market.name on the wire). */
const TEMPLATE_NAME = /\{SpecialIntValue\d*\}/i;

const BOOKMAKER = "pzbuk";
const PEERS_TIMEOUT_MS = 30_000;

const USAGE = `Usage: npx tsx scripts/pzbuk-smoke.ts --league <slug> [--peers <baseUrl>]

  --league <slug>    league to scrape, e.g. premier-league (required)
  --peers <baseUrl>  odds API to compare MATCH_WINNER with (median and range of
                     its other bookmakers), e.g. http://localhost:3001; one GET
                     /api/odds. If it cannot be loaded, A6 is NOT CHECKED and
                     pass is false
  --help, -h         print this help and exit

Calls pzbuk.pl over its WebSocket API (a browser only with SCRAPER_TRANSPORT_PZBUK=browser); never writes to the DB.
Prints one MATCH line per match and one SMOKE line; exit 0 when "pass" is true, 1 otherwise.`;

type FrameCounters = PzbukFrameCounters;

/** The picked scraper's cumulative frame counters (zeros if it has none). */
function frameCountersOf(scraper: typeof pzbukScraper): FrameCounters {
  return hasFrameCounters(scraper) ? scraper.frameCounters() : { invalidFrames: 0, chunkedFrames: 0, maxFrameBytes: 0 };
}

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

/** One match normalized like the service does, plus the normalizer's fail-closed drops. */
export interface QuietNormalization {
  markets: ScrapedMarket[];
  /** The "[pzbuk] Dropping …" warnings logged while normalizing this match. */
  dropped: string[];
}

/**
 * Normalizes one match like the service does before saving, with the
 * per-market "Unknown market" / "mapped to OTHER" console noise muted. The
 * fail-closed "[pzbuk] Dropping …" warnings are kept and returned.
 */
export function normalizeQuietly(match: FullMatchOffer, league: string): QuietNormalization {
  const { log, warn } = console;
  const dropped: string[] = [];
  console.log = () => {};
  console.warn = (...args: unknown[]) => {
    const message = args.map(String).join(" ");
    if (message.startsWith(DROP_WARNING)) dropped.push(message);
  };
  try {
    const markets = normalizeMarketsForBookmaker(match.markets, BOOKMAKER, match.homeTeam, match.awayTeam, league);
    return { markets, dropped };
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

/** A price the service may store: a finite number above 1. */
const isPrice = (odds: unknown): odds is number => typeof odds === "number" && Number.isFinite(odds) && odds > 1;

const describeOdds = (odds: unknown): string => (typeof odds === "number" ? String(odds) : JSON.stringify(odds));

/** Closed selection vocabulary of a non-OTHER, non-player catalog market; null when there is none. */
function closedVocabulary(code: string | undefined): Set<string> | null {
  if (code === undefined || code === "OTHER") return null;
  const entry = getMarketMetadata(code);
  if (!entry || entry.selections.length === 0 || PLAYER_VIEW_TYPES.has(entry.viewType)) return null;
  return new Set(entry.selections);
}

export interface MarketCounts {
  nonOther: number;
  unknownShareNonOther: number;
  /** "marketKey:code <- market name" for every overlapping selection code. */
  collisions: string[];
  /** "marketKey:code <- market name" for every code outside its market's closed catalog vocabulary. */
  vocabularyMisses: string[];
  /** "marketKey:code <- market name (odds)" for every selection, OTHER included, without a valid price. */
  invalidOdds: string[];
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
  const vocabularyMisses: string[] = [];
  const invalidOdds: string[] = [];
  const gated: string[] = [];
  // Same rule as pzbuk-real-names.test.ts "has no non-OTHER marketKey collision
  // with overlapping selection codes": storage resolves such a pair first-seen.
  const seen = new Map<string, Set<string>>();

  for (const m of normalized) {
    const ordinal = ORDINAL_NAME.test(m.name.trim());
    const template = TEMPLATE_NAME.test(m.name);
    if (ordinal) ordinalMarkets++;
    if (template) templateMarkets++;
    const key = String(m.marketKey);
    for (const s of m.selections) {
      if (!isPrice(s.odds)) invalidOdds.push(`${key}:${s.normalizedName} <- ${m.name} (${describeOdds(s.odds)})`);
    }
    if (m.normalizedType === "OTHER") continue;

    nonOther++;
    if (ordinal || template) gated.push(m.name);
    // A unique wrong code (e.g. "Brighton & Hove Albion/remis & tak" read as
    // DRAW_YES) is invisible to the collision rule; the catalog vocabulary is not.
    const vocabulary = closedVocabulary(m.normalizedType);
    const codes = seen.get(key) ?? new Set<string>();
    for (const s of m.selections) {
      const code = String(s.normalizedName);
      nonOtherSelections++;
      if (code === "UNKNOWN") unknown++;
      else if (vocabulary !== null && !vocabulary.has(code)) vocabularyMisses.push(`${key}:${code} <- ${m.name}`);
      if (codes.has(code)) collisions.push(`${key}:${code} <- ${m.name}`);
      codes.add(code);
    }
    seen.set(key, codes);
  }

  return {
    nonOther,
    unknownShareNonOther: nonOtherSelections > 0 ? unknown / nonOtherSelections : 0,
    collisions,
    vocabularyMisses,
    invalidOdds,
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

/** One PZBuk MATCH_WINNER selection next to the median and range of the same code across the peers. */
export interface X12Quote {
  code: string;
  odds: number;
  median: number;
  min: number;
  max: number;
}

/**
 * Every PZBuk MATCH_WINNER selection that has peer quotes for its code, with
 * the median, min and max of the other bookmakers of the peer row. Every
 * PZBuk MATCH_WINNER market is compared, so a second, leaked one counts too.
 * A PZBuk price that is not a valid price is kept, so it fails withinPeerBand.
 */
export function matchWinnerQuotes(normalized: ScrapedMarket[], peer: PeerRow): X12Quote[] {
  const others = Object.entries(peer.markets?.MATCH_WINNER?.bookmakerOdds ?? {})
    .filter(([bookmaker]) => bookmaker !== BOOKMAKER)
    .flatMap(([, quote]) => quote?.selections ?? []);
  const quotes: X12Quote[] = [];
  for (const m of normalized) {
    if (m.normalizedType !== "MATCH_WINNER") continue;
    for (const s of m.selections) {
      const peerOdds = others
        .filter((p) => p?.normalizedName === s.normalizedName)
        .map((p) => p.odds)
        .filter(isPrice);
      const reference = median(peerOdds);
      if (reference === null) continue;
      quotes.push({
        code: String(s.normalizedName),
        odds: s.odds,
        median: reference,
        min: Math.min(...peerOdds),
        max: Math.max(...peerOdds),
      });
    }
  }
  return quotes;
}

/** |1/odds - 1/median|: the implied-probability gap of a quote to the peer median. */
const impliedProbabilityGap = (q: X12Quote): number => Math.abs(1 / q.odds - 1 / q.median);

/**
 * A6 for one selection (controller ruling 11): a valid PZBuk price within
 * MAX_1X2_IMPLIED_PROBABILITY_GAP of the peer median's implied probability.
 */
export function withinPeerBand(q: X12Quote): boolean {
  if (!isPrice(q.odds)) return false;
  return impliedProbabilityGap(q) <= MAX_1X2_IMPLIED_PROBABILITY_GAP;
}

/** Largest implied-probability gap over the valid quotes; null when none could be compared. */
function maxProbabilityGap(quotes: X12Quote[]): number | null {
  const gaps = quotes.filter((q) => isPrice(q.odds)).map(impliedProbabilityGap);
  return gaps.length > 0 ? Math.max(...gaps) : null;
}

export interface MatchReport extends MarketCounts {
  homeTeam: string;
  awayTeam: string;
  parsed: number;
  /** The normalizer's fail-closed "[pzbuk] Dropping …" warnings for this match. */
  droppedMarkets: string[];
  /** The match joined a peer row. */
  peerMatched: boolean;
  /** At least one PZBuk MATCH_WINNER selection was compared with peers (A6 coverage). */
  compared: boolean;
  /** Largest implied-probability gap of the compared selections; reported only. */
  x12ProbabilityGap: number | null;
  /** Compared selections that fail withinPeerBand (A6). */
  x12Outliers: X12Quote[];
  /** The compared selections, so A6 can be checked by hand. */
  x12Quotes: X12Quote[];
}

export function evaluateMatch(
  match: FullMatchOffer,
  normalized: QuietNormalization,
  peers: Map<string, PeerRow> | null,
): MatchReport {
  const peer = peers?.get(peerKey(match.homeTeam, match.awayTeam));
  const x12Quotes = peer ? matchWinnerQuotes(normalized.markets, peer) : [];
  return {
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    parsed: match.markets.length,
    ...countMarkets(normalized.markets),
    droppedMarkets: normalized.dropped,
    peerMatched: peer !== undefined,
    compared: x12Quotes.length > 0,
    x12ProbabilityGap: maxProbabilityGap(x12Quotes),
    x12Outliers: x12Quotes.filter((q) => !withinPeerBand(q)),
    x12Quotes,
  };
}

/** "off": --peers not given; "unavailable": requested but not loaded (A6 not checked); "loaded". */
export type PeersStatus = "off" | "unavailable" | "loaded";

export interface SmokeSummary {
  success: boolean;
  matches: number;
  minParsedMarkets: number;
  minNonOther: number;
  maxUnknownShareNonOther: number;
  collisions: number;
  vocabularyMisses: number;
  invalidOdds: number;
  droppedMarkets: number;
  peers: PeersStatus;
  peerMatched: number;
  compared: number;
  x12Outliers: number;
  max1x2ProbabilityGap: number | null;
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
  transport: FrameCounters;
  durationMs: number;
  peers: PeersStatus;
}): SmokeSummary {
  const { success, reports, transport, durationMs, peers } = input;
  const values = (pick: (r: MatchReport) => number) => reports.map(pick);
  const min = (pick: (r: MatchReport) => number) => (reports.length > 0 ? Math.min(...values(pick)) : 0);
  const max = (pick: (r: MatchReport) => number) => (reports.length > 0 ? Math.max(...values(pick)) : 0);
  const sum = (pick: (r: MatchReport) => number) => values(pick).reduce((a, b) => a + b, 0);
  const gaps = reports.map((r) => r.x12ProbabilityGap).filter((g): g is number => g !== null);

  const minParsedMarkets = min((r) => r.parsed);
  const minNonOther = min((r) => r.nonOther);
  const maxUnknownShareNonOther = max((r) => r.unknownShareNonOther);
  const collisions = sum((r) => r.collisions.length);
  const vocabularyMisses = sum((r) => r.vocabularyMisses.length);
  const invalidOdds = sum((r) => r.invalidOdds.length);
  const x12Outliers = sum((r) => r.x12Outliers.length);
  const gatedNonOther = sum((r) => r.gated.length);

  // droppedMarkets, the transport counters and ordinalMarkets/templateMarkets
  // never affect the verdict (A11, A12); peers requested but unavailable do.
  const pass =
    success &&
    reports.length >= MIN_MATCHES &&
    minParsedMarkets >= MIN_PARSED &&
    minNonOther >= MIN_NON_OTHER &&
    maxUnknownShareNonOther <= MAX_UNKNOWN_SHARE &&
    collisions <= MAX_COLLISIONS &&
    vocabularyMisses === 0 &&
    invalidOdds === 0 &&
    peers !== "unavailable" &&
    x12Outliers === 0 &&
    gatedNonOther === 0;

  return {
    success,
    matches: reports.length,
    minParsedMarkets,
    minNonOther,
    maxUnknownShareNonOther,
    collisions,
    vocabularyMisses,
    invalidOdds,
    droppedMarkets: sum((r) => r.droppedMarkets.length),
    peers,
    peerMatched: reports.filter((r) => r.peerMatched).length,
    compared: reports.filter((r) => r.compared).length,
    x12Outliers,
    max1x2ProbabilityGap: gaps.length > 0 ? Math.max(...gaps) : null,
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
    console.warn(`[pzbuk-smoke] peers unavailable (${url}): ${reason}`);
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
    const before = frameCountersOf(pzbukScraper);
    const startedAt = Date.now();
    const result = await pzbukScraper.scrapeFullOffer(league);
    const durationMs = Date.now() - startedAt;
    const after = frameCountersOf(pzbukScraper);
    // Counters are cumulative: diff around the one call. One call per process,
    // so the max frame size is this call's.
    const transport: FrameCounters = {
      invalidFrames: after.invalidFrames - before.invalidFrames,
      chunkedFrames: after.chunkedFrames - before.chunkedFrames,
      maxFrameBytes: after.maxFrameBytes,
    };
    if (!result.success) {
      console.log(`[pzbuk-smoke] scrapeFullOffer failed: ${result.error ?? "(no error message)"}`);
    }

    const peers = args.peers ? await fetchPeers(args.peers, league) : null;
    const peersStatus: PeersStatus = !args.peers ? "off" : peers === null ? "unavailable" : "loaded";
    if (peersStatus === "unavailable") {
      console.log("[pzbuk-smoke] A6 NOT CHECKED: --peers was given but the peers could not be loaded; pass is false");
    }
    const reports = result.matches.map((m) => evaluateMatch(m, normalizeQuietly(m, league), peers));
    for (const report of reports) console.log(`MATCH ${JSON.stringify(report)}`);

    const smoke = summarize({ success: result.success, reports, transport, durationMs, peers: peersStatus });
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
