/**
 * One incremental pass of one bookmaker over one league (plan 10): list the
 * events, fetch only the due details, then stamp the fetched events and confirm
 * the unchanged ones (finalizeIncrementalPass, after the aggregator's save).
 *
 * Outcomes stay in hourly units: only the hourly tick turns a pass into a
 * scraper_runs outcome (classifyIncrementalOutcome); passes on the ticks in
 * between are noted in the IncrementalHourLedger and carried into that outcome.
 */
import type { PolishBookmaker } from "../../config/index.js";
import { generateMatchId } from "../../repositories/full-offer-repository.js";
import {
  getIncrementalState,
  recordIncrementalPass,
  type PassKey,
  type RecordPassResult,
} from "../../repositories/incremental-state-repository.js";
import type { ScrapeBudget } from "../../scrapers/shared/budget.js";
import { fetchDetailsSkippingFailures, MAX_SKIPPED_DETAIL_RATIO } from "../../scrapers/shared/detail-fetch.js";
import {
  transportTotals,
  type EventRef,
  type IncrementalScraper,
} from "../../scrapers/shared/incremental/incremental-scraper.js";
import type { FullMatchOffer, FullOfferScraperResult } from "../../types/full-offer.js";
import { classifyBookmakerRun, type BookmakerRunStatus } from "../run-outcome.js";
import type { NormalizeAndSaveResult } from "../scrape-helpers.js";
import {
  planDetailFetches,
  type DueReason,
  type EventFetchState,
  type NotDueReason,
  type TierLabel,
} from "./due-plan.js";

/** Below this many due details a failure never fails the pass (one transient error is not an outage). */
export const MIN_DUE_FOR_FAILURE_RATIO = 4;

export type PassMode = "incremental" | "forced" | "plan-only";

export interface IncrementalPassStats {
  mode: PassMode;
  ledger: "db" | "warm" | "cold";
  listed: number;
  dropped: number;
  started: number;
  due: number;
  /** Offers returned by fetchEvent (non-null). */
  fetched: number;
  skipped: number;
  /** fetchEvent returned null: the detail maps to no markets. */
  noMarkets: number;
  /** Fresh events sent for confirmation. */
  confirmed: number;
  nameMismatch: number;
  byReason: Partial<Record<DueReason | NotDueReason, number>>;
  listingRequests: number;
  listingBytes: number;
  requests: number;
  bytes: number;
  durationMs: number;
  /** Max whole minutes since the last detail, measured BEFORE fetching, non-started events with a known lastDetailAt. */
  preAgeMinByTier: Partial<Record<TierLabel, number>>;
}

export interface IncrementalPassResult extends FullOfferScraperResult {
  incremental: IncrementalPassStats;
  pending: { fetched: PassKey[]; confirmed: PassKey[] };
}

export interface IncrementalPassDeps {
  loadState(league: string, bookmaker: PolishBookmaker): Promise<Map<string, EventFetchState>>;
  recordPass(runId: string, bookmaker: PolishBookmaker, fetched: PassKey[], confirmed: PassKey[]): Promise<RecordPassResult>;
  matchKey(home: string, away: string, league: string): string;
  now(): number;
  log(line: string): void;
}

const DEFAULT_DEPS: IncrementalPassDeps = {
  loadState: getIncrementalState,
  recordPass: recordIncrementalPass,
  matchKey: generateMatchId,
  now: () => Date.now(),
  log: (line) => console.log(line),
};

const withDefaults = (deps?: Partial<IncrementalPassDeps>): IncrementalPassDeps => ({ ...DEFAULT_DEPS, ...deps });

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * In-memory detail state for dry-run (plan-only) passes: what the incremental
 * mode WOULD have fetched, so the next pass plans against it. Lost on restart,
 * which the report sees as a `cold` pass.
 */
export class DryRunLedger {
  private readonly states = new Map<string, EventFetchState>();
  private readonly leagues = new Set<string>();

  stateOf(bookmaker: PolishBookmaker, matchKey: string): EventFetchState | undefined {
    return this.states.get(`${bookmaker}|${matchKey}`);
  }

  hasLeague(bookmaker: PolishBookmaker, league: string): boolean {
    return this.leagues.has(`${bookmaker}|${league}`);
  }

  /** Registers a pass over (bookmaker, league), so the next one is `warm` even when nothing was due. */
  noteLeague(bookmaker: PolishBookmaker, league: string): void {
    this.leagues.add(`${bookmaker}|${league}`);
  }

  markFetched(bookmaker: PolishBookmaker, league: string, key: PassKey, at: number): void {
    this.noteLeague(bookmaker, league);
    this.states.set(`${bookmaker}|${key.matchKey}`, { lastDetailAt: at, fingerprint: key.fingerprint, status: "ok" });
  }
}

export const dryRunLedger = new DryRunLedger();

/** Same test as the save path's degenerate-match drop (full-offer-repository.ts). */
function isDegenerateKey(matchKey: string): boolean {
  const parts = matchKey.split(":");
  return parts[1] === parts[2];
}

function emptyStats(mode: PassMode, ledger: IncrementalPassStats["ledger"]): IncrementalPassStats {
  return {
    mode,
    ledger,
    listed: 0,
    dropped: 0,
    started: 0,
    due: 0,
    fetched: 0,
    skipped: 0,
    noMarkets: 0,
    confirmed: 0,
    nameMismatch: 0,
    byReason: {},
    listingRequests: 0,
    listingBytes: 0,
    requests: 0,
    bytes: 0,
    durationMs: 0,
    preAgeMinByTier: {},
  };
}

/** Never throws: a failure of any stage becomes `success: false` with the cause. */
export async function runIncrementalPass(
  scraper: IncrementalScraper,
  league: string,
  opts: { runId: string; budget: ScrapeBudget; mode: PassMode; ledger?: DryRunLedger },
  deps?: Partial<IncrementalPassDeps>,
): Promise<IncrementalPassResult> {
  const d = withDefaults(deps);
  const { mode, budget } = opts;
  const bookmaker = scraper.bookmaker;
  const ledger = opts.ledger ?? dryRunLedger;
  const started = d.now();
  const ledgerKind: IncrementalPassStats["ledger"] =
    mode === "plan-only" ? (ledger.hasLeague(bookmaker, league) ? "warm" : "cold") : "db";
  const stats = emptyStats(mode, ledgerKind);
  const t0 = transportTotals(scraper.transportStats());

  const finish = (
    part: { success: boolean; matches: FullMatchOffer[]; error?: string },
    pending: IncrementalPassResult["pending"],
  ): IncrementalPassResult => {
    const t = transportTotals(scraper.transportStats());
    stats.requests = t.requests - t0.requests;
    stats.bytes = t.bytes - t0.bytes;
    stats.durationMs = d.now() - started;
    return {
      bookmaker,
      league,
      ...part,
      ...(part.error === undefined ? {} : { error: part.error }),
      duration: stats.durationMs,
      incremental: stats,
      pending,
    };
  };

  // 1. Listing
  let refs: EventRef[];
  try {
    budget.checkpoint();
    refs = await scraper.listEvents(league, budget);
  } catch (e) {
    return finish({ success: false, matches: [], error: errorText(e) }, { fetched: [], confirmed: [] });
  }

  try {
    const t1 = transportTotals(scraper.transportStats());
    stats.listingRequests = t1.requests - t0.requests;
    stats.listingBytes = t1.bytes - t0.bytes;
    stats.listed = refs.length;

    // 2. Keys; degenerate keys (both teams resolve to one club) are never saved, so never planned
    const keyOf = new Map<EventRef, string>();
    const kept: EventRef[] = [];
    for (const ref of refs) {
      const k = d.matchKey(ref.homeTeam, ref.awayTeam, league);
      if (isDegenerateKey(k)) {
        stats.dropped++;
        continue;
      }
      keyOf.set(ref, k);
      kept.push(ref);
    }

    // 3. State
    let stateOf: (ref: EventRef) => EventFetchState | undefined;
    if (mode === "plan-only") {
      stateOf = (ref) => ledger.stateOf(bookmaker, keyOf.get(ref)!);
    } else {
      let state: Map<string, EventFetchState>;
      try {
        state = await d.loadState(league, bookmaker);
      } catch (e) {
        if (mode !== "forced") {
          // Unknown state must not turn every 10-minute tick into a full scrape (e.g. migration 16
          // missing): fetch nothing; the hourly forced pass still fetches everything.
          d.log(`[IncrementalPass] state unavailable for ${bookmaker}/${league}: ${errorText(e)}; fetching nothing until the hourly pass`);
          return finish({ success: false, matches: [], error: `state unavailable: ${errorText(e)}` }, { fetched: [], confirmed: [] });
        }
        state = new Map();
        d.log(`[IncrementalPass] state unavailable for ${bookmaker}/${league}: ${errorText(e)}; fetching all`);
      }
      stateOf = (ref) => state.get(keyOf.get(ref)!);
    }

    // 4. Plan
    const now = d.now();
    const decisions = planDetailFetches(kept, stateOf, now, { forceAll: mode === "forced" });
    const dueRefs: EventRef[] = [];
    const confirmed: PassKey[] = [];
    for (const dec of decisions) {
      stats.byReason[dec.reason] = (stats.byReason[dec.reason] ?? 0) + 1;
      if (dec.reason === "started") {
        stats.started++;
        continue;
      }
      if (dec.ageMs !== null) {
        const ageMin = Math.floor(dec.ageMs / 60_000);
        stats.preAgeMinByTier[dec.tier] = Math.max(stats.preAgeMinByTier[dec.tier] ?? ageMin, ageMin);
      }
      if (dec.due) dueRefs.push(dec.ref);
      else confirmed.push({ matchKey: keyOf.get(dec.ref)!, fingerprint: dec.ref.fingerprint });
    }
    stats.due = dueRefs.length;
    stats.confirmed = confirmed.length;

    // 8. Dry run: record what would have been fetched, fetch nothing
    if (mode === "plan-only") {
      ledger.noteLeague(bookmaker, league);
      for (const ref of dueRefs) {
        ledger.markFetched(bookmaker, league, { matchKey: keyOf.get(ref)!, fingerprint: ref.fingerprint }, now);
      }
      return finish({ success: true, matches: [] }, { fetched: [], confirmed });
    }

    // 5. Fetch the due details
    const { fetched, skipped } = await fetchDetailsSkippingFailures(
      dueRefs,
      (r) => r.eventId,
      (r) => scraper.fetchEvent(league, r, budget),
      { concurrency: scraper.detailConcurrency, budget },
    );

    // 6. Stamp keys come from the saved offer, so a listing/detail name mismatch still stamps the right row
    const matches: FullMatchOffer[] = [];
    const stamped: PassKey[] = [];
    for (const { event: ref, detail: offer } of fetched) {
      if (offer === null) {
        stats.noMarkets++;
        continue;
      }
      const offerKey = d.matchKey(offer.homeTeam, offer.awayTeam, league);
      if (offerKey !== keyOf.get(ref)) {
        stats.nameMismatch++;
        d.log(
          `[IncrementalPass] name mismatch ${bookmaker} ${ref.eventId}: "${ref.homeTeam} v ${ref.awayTeam}" vs "${offer.homeTeam} v ${offer.awayTeam}"`,
        );
      }
      matches.push(offer);
      stamped.push({ matchKey: offerKey, fingerprint: ref.fingerprint });
    }
    stats.fetched = matches.length;
    stats.skipped = skipped.length;

    // 7. Success rule; a failed pass saves nothing (like HttpScraper), so it stamps nothing
    const error = skipped.length > 0 ? `${skipped.length} of ${stats.due} details failed | ${skipped[0].error}` : undefined;
    const failed = stats.due >= MIN_DUE_FOR_FAILURE_RATIO && skipped.length / stats.due > MAX_SKIPPED_DETAIL_RATIO;
    if (failed) return finish({ success: false, matches: [], error }, { fetched: [], confirmed });
    return finish({ success: true, matches, error }, { fetched: stamped, confirmed });
  } catch (e) {
    return finish({ success: false, matches: [], error: errorText(e) }, { fetched: [], confirmed: [] });
  }
}

export function isIncrementalPassResult(r: FullOfferScraperResult): r is IncrementalPassResult {
  const c = r as Partial<IncrementalPassResult>;
  return typeof c.incremental === "object" && c.incremental !== null && typeof c.pending === "object" && c.pending !== null;
}

export type FinalizeResult = RecordPassResult | { recordError: string } | null;

/**
 * Stamps and confirms (skipped for plan-only and when both lists are empty),
 * then logs exactly one `[IncrementalPass] {json}` line. Never throws.
 * Returns the record result, `{ recordError }` on a failed call, or null when no call was made.
 */
export async function finalizeIncrementalPass(
  result: IncrementalPassResult,
  runId: string,
  deps?: Partial<IncrementalPassDeps>,
): Promise<FinalizeResult> {
  const d = withDefaults(deps);
  const { pending, incremental: stats, bookmaker, league } = result;

  let rec: FinalizeResult = null;
  if (stats.mode !== "plan-only" && (pending.fetched.length > 0 || pending.confirmed.length > 0)) {
    try {
      rec = await d.recordPass(runId, bookmaker, pending.fetched, pending.confirmed);
    } catch (e) {
      const message = errorText(e);
      d.log(`[IncrementalPass] record failed ${bookmaker}/${league}: ${message}`);
      rec = { recordError: message };
    }
  }

  const ok = rec !== null && !("recordError" in rec) ? rec : null;
  const recordError = rec !== null && "recordError" in rec ? rec.recordError : null;
  const error = [result.error, recordError].filter(Boolean).join(" | ") || null;
  d.log(
    `[IncrementalPass] ${JSON.stringify({
      runId,
      bookmaker,
      league,
      ...stats,
      stamped: ok?.stamped ?? null,
      notConfirmed: ok?.notConfirmed ?? null,
      confirmedRows: ok?.confirmedRows ?? null,
      stampMiss: ok ? stats.fetched - ok.stamped : null,
      error,
      // The log has no timestamps of its own: the report windows passes by this field
      at: new Date(d.now()).toISOString(),
    })}`,
  );
  return rec;
}

export interface HourSummary {
  passes: number;
  failedPasses: number;
  firstError: string | null;
}

/**
 * Incremental passes between two hourly ticks, per (bookmaker, league). In
 * memory: a restart loses at most one hour of notes (they are in the
 * [IncrementalPass] lines).
 */
export class IncrementalHourLedger {
  private readonly hours = new Map<string, HourSummary>();

  /** Counts a pass; failed = !success or any skipped detail. */
  note(bookmaker: PolishBookmaker, league: string, r: IncrementalPassResult): void {
    const k = `${bookmaker}|${league}`;
    const h = this.hours.get(k) ?? { passes: 0, failedPasses: 0, firstError: null };
    h.passes++;
    if (!r.success || r.incremental.skipped > 0) {
      h.failedPasses++;
      h.firstError ??= r.error ?? "incremental pass failed without an error message";
    }
    this.hours.set(k, h);
  }

  /** Counts a pass that produced no pass result at all (a hard timeout, a thrown unit) as failed. */
  noteFailure(bookmaker: PolishBookmaker, league: string, error: string): void {
    const k = `${bookmaker}|${league}`;
    const h = this.hours.get(k) ?? { passes: 0, failedPasses: 0, firstError: null };
    h.passes++;
    h.failedPasses++;
    h.firstError ??= error;
    this.hours.set(k, h);
  }

  /** Returns and resets; zeros when nothing was noted. */
  take(bookmaker: PolishBookmaker, league: string): HourSummary {
    const k = `${bookmaker}|${league}`;
    const h = this.hours.get(k) ?? { passes: 0, failedPasses: 0, firstError: null };
    this.hours.delete(k);
    return h;
  }
}

export const incrementalHourLedger = new IncrementalHourLedger();

/** First error verbatim, further ones only counted (run-outcome's summarizeErrors style). */
function summarizeErrors(errors: readonly string[]): string | null {
  if (errors.length === 0) return null;
  return errors.length === 1 ? errors[0] : `${errors[0]} (+${errors.length - 1} more)`;
}

const RECORD_ERROR_PREFIX = "record_incremental_pass failed";

/**
 * The hourly outcome of one incremental bookmaker and league. Rules, first
 * match wins: failed pass (listing, or more than half of >= 4 due details) ->
 * scrape_failed; nothing eligible -> empty (owner A6); fetched offers that saved
 * nothing -> classifyBookmakerRun's persist_failed cause; a failed record with
 * nothing saved -> persist_failed; else success, or partial with every cause
 * (pass error, save errors, record error, the hour's failed passes).
 */
export function classifyIncrementalOutcome(
  r: IncrementalPassResult,
  save: NormalizeAndSaveResult | null,
  record: { confirmedRows: number } | { recordError: string } | null,
  hour: HourSummary,
): { status: BookmakerRunStatus; error: string | null; matchesFound: number; marketsFound: number; marketsSaved: number } {
  const s = r.incremental;
  const eligible = s.listed - s.dropped - s.started;
  const base = {
    matchesFound: Math.max(0, eligible),
    marketsFound: r.matches.reduce((n, m) => n + m.markets.length, 0),
  };
  const recordError = record !== null && "recordError" in record ? record.recordError : null;
  const confirmedRows = record !== null && "confirmedRows" in record ? record.confirmedRows : 0;
  const savedRows = save?.marketsSaved ?? 0;

  if (!r.success) {
    return { ...base, status: "scrape_failed", error: r.error || "Incremental pass failed without an error message", marketsSaved: 0 };
  }
  if (eligible <= 0) {
    return { ...base, status: "empty", error: r.error || "Scraper reported success with 0 matches", marketsSaved: 0 };
  }
  if (s.fetched > 0 && savedRows === 0) {
    const c = classifyBookmakerRun({ success: true, matches: r.matches, error: r.error }, save);
    return { ...base, status: c.status, error: c.error, marketsSaved: 0 };
  }
  if (recordError !== null && savedRows === 0) {
    const error = recordError.startsWith(RECORD_ERROR_PREFIX) ? recordError : `${RECORD_ERROR_PREFIX}: ${recordError}`;
    return { ...base, status: "persist_failed", error, marketsSaved: 0 };
  }

  const causes = [
    r.error,
    summarizeErrors(save?.errors ?? []),
    recordError,
    hour.failedPasses > 0 ? `${hour.failedPasses} of ${hour.passes} incremental passes this hour failed | ${hour.firstError}` : null,
  ].filter((c): c is string => typeof c === "string" && c.length > 0);
  return {
    ...base,
    status: causes.length > 0 ? "partial" : "success",
    error: causes.length > 0 ? causes.join(" | ") : null,
    marketsSaved: savedRows + confirmedRows,
  };
}
