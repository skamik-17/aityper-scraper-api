import { beforeEach, describe, expect, it, vi } from "vitest";
import { createScrapeBudget } from "../../../scrapers/shared/budget.js";
import { HttpError } from "../../../scrapers/shared/http/http-error.js";
import type { EventRef, IncrementalScraper } from "../../../scrapers/shared/incremental/incremental-scraper.js";
import type { TransportStats } from "../../../scrapers/shared/scraper-contract.js";
import type { FullMatchOffer } from "../../../types/full-offer.js";
import type { EventFetchState } from "../due-plan.js";
import {
  classifyIncrementalOutcome,
  DryRunLedger,
  finalizeIncrementalPass,
  IncrementalHourLedger,
  isIncrementalPassResult,
  runIncrementalPass,
  type IncrementalPassDeps,
  type IncrementalPassResult,
  type IncrementalPassStats,
} from "../incremental-pass.js";

const LEAGUE = "premier-league";
const NOW = Date.parse("2026-11-07T12:00:00.000Z");
const RUN = "440d2fc6-658b-46fe-b288-05261faa0caf";
const minutesAgo = (m: number) => NOW - m * 60_000;
const FAR = "2026-11-12T12:00:00.000Z"; // gt72h
const NEAR = "2026-11-07T12:30:00.000Z"; // lt1h
const STARTED = "2026-11-07T11:00:00.000Z";

interface Ev {
  id: string;
  home: string;
  away: string;
  kickoff: string | null;
  fp: string | null;
  offerHome?: string;
  fail?: string;
  empty?: boolean;
}
const ev = (id: string, kickoff: string | null, extra: Partial<Ev> = {}): Ev => ({
  id,
  home: `${id} Home`,
  away: `${id} Away`,
  kickoff,
  fp: `f${id.toLowerCase()}`,
  ...extra,
});

const offerOf = (e: Ev): FullMatchOffer => ({
  matchId: e.id,
  bookmaker: "forbet",
  homeTeam: e.offerHome ?? e.home,
  awayTeam: e.away,
  eventUrl: `https://x/${e.id}`,
  markets: [{ name: "1X2", selections: [{ name: "1", odds: 2 }] } as any, { name: "BTTS", selections: [] } as any],
  scrapedAt: new Date(NOW),
});

function fakeScraper(events: Ev[], opts: { listError?: Error; stats?: TransportStats[] } = {}) {
  const statsSeq = opts.stats ? [...opts.stats] : null;
  let lastStats: TransportStats = { http: { requests: 0, retries: 0, failures: 0, bytes: 0, byStatus: {} } };
  const fetchEvent = vi.fn(async (_league: string, r: EventRef<Ev>) => {
    const e = r.listing;
    if (e.fail) throw new HttpError("http", e.fail.split(" ").pop()!, 503, e.fail);
    return e.empty ? null : offerOf(e);
  });
  const scraper: IncrementalScraper<Ev> = {
    bookmaker: "forbet",
    detailConcurrency: 2,
    scrapeFullOffer: vi.fn(),
    cleanup: vi.fn(async () => {}),
    transportStats: () => {
      if (statsSeq && statsSeq.length > 0) lastStats = statsSeq.shift()!;
      return lastStats;
    },
    listEvents: vi.fn(async () => {
      if (opts.listError) throw opts.listError;
      return events.map((e) => ({
        eventId: e.id,
        homeTeam: e.home,
        awayTeam: e.away,
        kickoff: e.kickoff,
        fingerprint: e.fp,
        eventUrl: `https://x/${e.id}`,
        listing: e,
      }));
    }),
    fetchEvent,
  };
  return scraper;
}

const key = (h: string, a: string) => `${LEAGUE}:${h.toLowerCase()}:${a.toLowerCase()}`;
let lines: string[];
let state: Map<string, EventFetchState>;
let deps: Partial<IncrementalPassDeps>;

beforeEach(() => {
  lines = [];
  state = new Map();
  deps = {
    loadState: vi.fn(async () => state),
    recordPass: vi.fn(async () => ({ stamped: 0, confirmed: 0, notConfirmed: 0, confirmedRows: 0 })),
    matchKey: (h, a, l) => `${l}:${h.toLowerCase()}:${a.toLowerCase()}`,
    now: () => NOW,
    log: (line) => lines.push(line),
  };
});

const run = (s: IncrementalScraper, mode: "incremental" | "forced" | "plan-only" = "incremental", ledger?: DryRunLedger) =>
  runIncrementalPass(s, LEAGUE, { runId: RUN, budget: createScrapeBudget(10_000), mode, ledger }, deps);

describe("runIncrementalPass", () => {
  it("fetches only due events and confirms fresh ones", async () => {
    state.set(key("B Home", "B Away"), { lastDetailAt: minutesAgo(10), fingerprint: "fb", status: "ok" });
    const s = fakeScraper([ev("A", FAR), ev("B", FAR), ev("C", STARTED)]);
    const r = await run(s);
    expect(s.fetchEvent).toHaveBeenCalledTimes(1);
    expect((s.fetchEvent as any).mock.calls[0][1].eventId).toBe("A");
    expect(r.success).toBe(true);
    expect(r.matches.map((m) => m.matchId)).toEqual(["A"]);
    expect(r.pending).toEqual({
      fetched: [{ matchKey: "premier-league:a home:a away", fingerprint: "fa" }],
      confirmed: [{ matchKey: "premier-league:b home:b away", fingerprint: "fb" }],
    });
    expect(r.incremental).toMatchObject({
      mode: "incremental",
      ledger: "db",
      listed: 3,
      dropped: 0,
      started: 1,
      due: 1,
      fetched: 1,
      skipped: 0,
      noMarkets: 0,
      confirmed: 1,
      nameMismatch: 0,
      byReason: { "never-fetched": 1, fresh: 1, started: 1 },
    });
    expect(isIncrementalPassResult(r)).toBe(true);
  });

  it("drops refs whose home and away resolve to the same key", async () => {
    const s = fakeScraper([ev("A", FAR, { home: "Leeds", away: "Leeds" }), ev("B", FAR)]);
    const r = await run(s);
    expect(r.incremental.dropped).toBe(1);
    expect((s.fetchEvent as any).mock.calls.map((c: any[]) => c[1].eventId)).toEqual(["B"]);
    expect([...r.pending.fetched, ...r.pending.confirmed].some((k) => k.matchKey.includes("leeds"))).toBe(false);
  });

  it("a listing failure fails the pass with the HttpError message", async () => {
    const s = fakeScraper([], {
      listError: new HttpError("http", "https://api.example/list", 503, "fetch HTTP 503 https://api.example/list"),
    });
    const r = await run(s);
    expect(r).toMatchObject({ success: false, error: "fetch HTTP 503 https://api.example/list", matches: [] });
    expect(r.pending).toEqual({ fetched: [], confirmed: [] });
  });

  it("state read failure fetches every non-started event", async () => {
    deps.loadState = vi.fn(async () => {
      throw new Error("odds_snapshot state read failed: fetch failed (ECONNREFUSED)");
    });
    const s = fakeScraper([ev("A", FAR), ev("B", NEAR), ev("C", STARTED)]);
    const r = await run(s);
    expect(r.incremental.ledger).toBe("db");
    expect(r.incremental.due).toBe(2);
    expect(r.matches.map((m) => m.matchId)).toEqual(["A", "B"]);
    expect(lines).toContain(
      "[IncrementalPass] state unavailable for forbet/premier-league: odds_snapshot state read failed: fetch failed (ECONNREFUSED); fetching all",
    );
  });

  it("one failed detail of two keeps success and leaves it due", async () => {
    const s = fakeScraper([ev("e1", FAR), ev("e2", FAR, { fail: "fetch HTTP 503 https://x/e2" })]);
    const r = await run(s);
    expect(r.success).toBe(true);
    expect(r.error).toBe("1 of 2 details failed | fetch HTTP 503 https://x/e2");
    expect(r.incremental.skipped).toBe(1);
    expect([...r.pending.fetched, ...r.pending.confirmed].map((k) => k.matchKey)).toEqual(["premier-league:e1 home:e1 away"]);
  });

  it("three failures of four due fail the pass", async () => {
    const fail = { fail: "fetch HTTP 503 https://x/e" };
    const s = fakeScraper([ev("e1", FAR), ev("e2", FAR, fail), ev("e3", FAR, fail), ev("e4", FAR, fail)]);
    const r = await run(s);
    expect(r.success).toBe(false);
    expect(r.error).toBe("3 of 4 details failed | fetch HTTP 503 https://x/e");
    expect(r.matches).toEqual([]);
    expect(r.pending.fetched).toEqual([]);
  });

  it("forced mode fetches fresh events", async () => {
    state.set(key("A Home", "A Away"), { lastDetailAt: minutesAgo(5), fingerprint: "fa", status: "ok" });
    state.set(key("B Home", "B Away"), { lastDetailAt: minutesAgo(5), fingerprint: "fb", status: "ok" });
    const s = fakeScraper([ev("A", FAR), ev("B", FAR)]);
    const r = await run(s, "forced");
    expect(r.incremental.mode).toBe("forced");
    expect(r.incremental.byReason.forced).toBe(2);
    expect(r.pending.confirmed).toEqual([]);
    expect(s.fetchEvent).toHaveBeenCalledTimes(2);
  });

  it("name mismatch is counted and the stamp uses the offer key", async () => {
    const s = fakeScraper([ev("L", FAR, { home: "Leeds", away: "Tottenham", offerHome: "Leeds United" })]);
    const r = await run(s);
    expect(r.incremental.nameMismatch).toBe(1);
    expect(r.pending.fetched[0].matchKey).toBe("premier-league:leeds united:tottenham");
    expect(lines.filter((l) => l.includes("name mismatch"))).toEqual([
      '[IncrementalPass] name mismatch forbet L: "Leeds v Tottenham" vs "Leeds United v Tottenham"',
    ]);
  });

  it("plan-only fetches nothing and warms the ledger", async () => {
    const ledger = new DryRunLedger();
    const s = fakeScraper([ev("A", FAR), ev("B", FAR), ev("N", NEAR)]);
    const first = await run(s, "plan-only", ledger);
    expect(first.incremental).toMatchObject({ mode: "plan-only", ledger: "cold", due: 3, fetched: 0 });
    expect(first.matches).toEqual([]);
    expect(s.fetchEvent).not.toHaveBeenCalled();
    expect(deps.loadState).not.toHaveBeenCalled();

    deps.now = () => NOW + 10 * 60_000;
    const second = await run(s, "plan-only", ledger);
    expect(second.incremental.ledger).toBe("warm");
    expect(second.incremental.due).toBe(1);
    expect(second.incremental.byReason).toMatchObject({ "tier-age": 1, fresh: 2 });
  });

  it("a plan-only pass over an empty listing still warms the ledger", async () => {
    const ledger = new DryRunLedger();
    await run(fakeScraper([]), "plan-only", ledger);
    expect((await run(fakeScraper([]), "plan-only", ledger)).incremental.ledger).toBe("warm");
  });

  it("preAgeMinByTier reports ages before fetching", async () => {
    state.set(key("A Home", "A Away"), { lastDetailAt: minutesAgo(358), fingerprint: "fa", status: "ok" });
    const r = await run(fakeScraper([ev("A", FAR)]));
    expect(r.incremental.byReason["tier-age"]).toBe(1);
    expect(r.incremental.preAgeMinByTier.gt72h).toBe(358);
  });

  it("transport deltas", async () => {
    const t = (requests: number, bytes: number): TransportStats => ({
      http: { requests, retries: 0, failures: 0, bytes, byStatus: {} },
    });
    const s = fakeScraper([ev("A", FAR), ev("B", FAR)], { stats: [t(10, 1000), t(11, 1500), t(13, 9500)] });
    const r = await run(s);
    expect(r.incremental).toMatchObject({ listingRequests: 1, listingBytes: 500, requests: 3, bytes: 8500 });
  });
});

function passResult(stats: Partial<IncrementalPassStats>, extra: Partial<IncrementalPassResult> = {}): IncrementalPassResult {
  return {
    success: true,
    bookmaker: "forbet",
    league: LEAGUE,
    matches: [],
    duration: 100,
    pending: { fetched: [], confirmed: [] },
    incremental: {
      mode: "incremental",
      ledger: "db",
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
      listingRequests: 1,
      listingBytes: 100,
      requests: 1,
      bytes: 100,
      durationMs: 100,
      preAgeMinByTier: {},
      ...stats,
    },
    ...extra,
  };
}

describe("finalizeIncrementalPass", () => {
  it("finalize logs one JSON line after recording", async () => {
    deps.recordPass = vi.fn(async () => ({ stamped: 0, confirmed: 1, notConfirmed: 0, confirmedRows: 220 }));
    const r = passResult(
      { listed: 2, due: 1, fetched: 1, confirmed: 1 },
      {
        pending: {
          fetched: [{ matchKey: "premier-league:a:b", fingerprint: "fa" }],
          confirmed: [{ matchKey: "premier-league:c:d", fingerprint: "fc" }],
        },
      },
    );
    const rec = await finalizeIncrementalPass(r, RUN, deps);
    expect(rec).toEqual({ stamped: 0, confirmed: 1, notConfirmed: 0, confirmedRows: 220 });
    expect(deps.recordPass).toHaveBeenCalledWith(RUN, "forbet", r.pending.fetched, r.pending.confirmed);
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith("[IncrementalPass] {")).toBe(true);
    const json = JSON.parse(lines[0].slice("[IncrementalPass] ".length));
    expect(json).toMatchObject({ runId: RUN, bookmaker: "forbet", league: LEAGUE, stampMiss: 1, confirmedRows: 220, stamped: 0, notConfirmed: 0, error: null });
  });

  it("finalize survives a record failure", async () => {
    deps.recordPass = vi.fn(async () => {
      throw new Error("record_incremental_pass failed: fetch failed (ECONNREFUSED)");
    });
    const r = passResult({ listed: 1, confirmed: 1 }, { pending: { fetched: [], confirmed: [{ matchKey: "k", fingerprint: null }] } });
    const rec = await finalizeIncrementalPass(r, RUN, deps);
    expect(rec).toEqual({ recordError: "record_incremental_pass failed: fetch failed (ECONNREFUSED)" });
    expect(lines).toContain("[IncrementalPass] record failed forbet/premier-league: record_incremental_pass failed: fetch failed (ECONNREFUSED)");
    const json = JSON.parse(lines.find((l) => l.startsWith("[IncrementalPass] {"))!.slice(18));
    expect(json).toMatchObject({ stamped: null, notConfirmed: null, confirmedRows: null, stampMiss: null });
  });

  it("makes no record call for plan-only or empty passes", async () => {
    expect(await finalizeIncrementalPass(passResult({ mode: "plan-only", confirmed: 1 }, { pending: { fetched: [], confirmed: [{ matchKey: "k", fingerprint: null }] } }), RUN, deps)).toBeNull();
    expect(await finalizeIncrementalPass(passResult({}), RUN, deps)).toBeNull();
    expect(deps.recordPass).not.toHaveBeenCalled();
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0].slice(18))).toMatchObject({ mode: "plan-only", stamped: null, stampMiss: null });
  });
});

describe("classifyIncrementalOutcome", () => {
  const noHour = { passes: 0, failedPasses: 0, firstError: null };
  const save = (marketsSaved: number, errors: string[] = []) => ({ matchesProcessed: 1, marketsNormalized: marketsSaved, marketsSaved, errors });

  it("nothing due with all events confirmed is success, not empty", () => {
    const r = passResult({ listed: 19, due: 0, confirmed: 19 });
    expect(classifyIncrementalOutcome(r, null, { confirmedRows: 4210 }, noHour)).toEqual({
      status: "success",
      error: null,
      matchesFound: 19,
      marketsFound: 0,
      marketsSaved: 4210,
    });
  });

  it("an empty listing is empty (owner A6)", () => {
    expect(classifyIncrementalOutcome(passResult({ listed: 0 }), null, null, noHour)).toMatchObject({
      status: "empty",
      error: "Scraper reported success with 0 matches",
      matchesFound: 0,
    });
  });

  it("the hourly outcome carries the hour's failed passes", () => {
    const ledger = new IncrementalHourLedger();
    const ok = passResult({ listed: 5, confirmed: 5 });
    const failed = passResult({ listed: 0 }, { success: false, error: "fetch HTTP 503 https://api.example/list" });
    for (const r of [ok, failed, ok, ok, ok]) ledger.note("forbet", LEAGUE, r);
    const hourly = passResult({ listed: 5, due: 1, fetched: 1, confirmed: 4 }, { matches: [offerOf(ev("A", FAR))] });
    expect(classifyIncrementalOutcome(hourly, save(40), { confirmedRows: 160 }, ledger.take("forbet", LEAGUE))).toEqual({
      status: "partial",
      error: "1 of 5 incremental passes this hour failed | fetch HTTP 503 https://api.example/list",
      matchesFound: 5,
      marketsFound: 2,
      marketsSaved: 200,
    });
    expect(ledger.take("forbet", LEAGUE)).toEqual({ passes: 0, failedPasses: 0, firstError: null });
  });

  it("a pass with a skipped detail counts as failed for the hour", () => {
    const ledger = new IncrementalHourLedger();
    ledger.note("forbet", LEAGUE, passResult({ listed: 2, due: 2, fetched: 1, skipped: 1 }, { error: "1 of 2 details failed | fetch HTTP 503 https://x/e2" }));
    expect(ledger.take("forbet", LEAGUE)).toEqual({ passes: 1, failedPasses: 1, firstError: "1 of 2 details failed | fetch HTTP 503 https://x/e2" });
  });

  it("a listing failure on the hourly tick is scrape_failed", () => {
    const r = passResult({ listed: 0 }, { success: false, error: "fetch HTTP 503 https://api.example/list" });
    expect(classifyIncrementalOutcome(r, null, null, noHour)).toMatchObject({
      status: "scrape_failed",
      error: "fetch HTTP 503 https://api.example/list",
    });
  });

  it("three failures of four due are scrape_failed with the cause", () => {
    const r = passResult({ listed: 4, due: 4, fetched: 1, skipped: 3 }, { success: false, error: "3 of 4 details failed | fetch HTTP 503 https://x/e" });
    expect(classifyIncrementalOutcome(r, null, { confirmedRows: 0 }, noHour)).toMatchObject({
      status: "scrape_failed",
      error: "3 of 4 details failed | fetch HTTP 503 https://x/e",
      matchesFound: 4,
    });
  });

  it("a failed record with nothing saved is persist_failed", () => {
    const r = passResult({ listed: 19, confirmed: 19 });
    expect(
      classifyIncrementalOutcome(r, null, { recordError: "record_incremental_pass failed: fetch failed (ECONNREFUSED)" }, noHour),
    ).toMatchObject({ status: "persist_failed", error: "record_incremental_pass failed: fetch failed (ECONNREFUSED)", marketsSaved: 0 });
  });

  it("fetched offers that save nothing defer to classifyBookmakerRun", () => {
    const r = passResult({ listed: 2, due: 1, fetched: 1, confirmed: 1 }, { matches: [offerOf(ev("A", FAR))] });
    expect(classifyIncrementalOutcome(r, save(0, ["Batch insert failed: boom"]), { confirmedRows: 50 }, noHour)).toMatchObject({
      status: "persist_failed",
      error: "Batch insert failed: boom",
    });
  });

  it("a detail failure and a save error make a partial outcome", () => {
    const r = passResult(
      { listed: 3, due: 2, fetched: 1, skipped: 1, confirmed: 1 },
      { matches: [offerOf(ev("A", FAR))], error: "1 of 2 details failed | fetch HTTP 503 https://x/e2" },
    );
    expect(classifyIncrementalOutcome(r, save(30, ["Normalize warn a", "Normalize warn b"]), { confirmedRows: 10 }, noHour)).toMatchObject({
      status: "partial",
      error: "1 of 2 details failed | fetch HTTP 503 https://x/e2 | Normalize warn a (+1 more)",
      marketsSaved: 40,
    });
  });
});
