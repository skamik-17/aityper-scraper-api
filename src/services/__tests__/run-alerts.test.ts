import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG, type PolishBookmaker } from "../../config/index.js";
import { outcome, summary, RUN2_OK } from "../../__tests__/helpers/run-fixtures.js";
import type { BookmakerRunSummary } from "../bookmaker-status.js";
import { buildRunAlerts, emitAlerts, formatAbortAlert, formatRunSummaryLine } from "../run-alerts.js";

// Run 2 (440d2fc6): 9 bookmakers saved rows, 5 returned no events.
const run2 = CONFIG.BOOKMAKERS.map((bm) =>
  RUN2_OK[bm] !== undefined
    ? outcome({ bookmaker: bm, status: "success", matchesFound: 20, marketsSaved: RUN2_OK[bm] })
    : outcome({ bookmaker: bm, status: "scrape_failed", matchesFound: 0, marketsSaved: 0, error: "No events found from API" }),
);

const BETTERS_ERR = "No events found from API | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485";
const PERSIST_ERR =
  "Batch insert failed (12 of 12 batches): TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)";
// Run 1 (startup, Supabase still coming up): these 7 scraped 20 matches each and saved nothing.
const RUN1_NOT_SAVED: readonly PolishBookmaker[] = ["fortuna", "superbet", "lvbet", "fuksiarz", "betfan", "forbet", "etoto"];
const RUN1_SAVED: readonly PolishBookmaker[] = ["sts", "betclic", "betcris"];
const run1 = CONFIG.BOOKMAKERS.map((bm) =>
  RUN1_NOT_SAVED.includes(bm)
    ? outcome({ bookmaker: bm, status: "persist_failed", matchesFound: 20, marketsSaved: 0, error: PERSIST_ERR })
    : RUN1_SAVED.includes(bm)
      ? outcome({ bookmaker: bm, status: "success", matchesFound: 20, marketsSaved: 3262 })
      : outcome({ bookmaker: bm, status: "scrape_failed", matchesFound: 0, error: "No events found from API" }),
);

const summaries = (...list: BookmakerRunSummary[]) =>
  new Map<PolishBookmaker, BookmakerRunSummary>(list.map((s) => [s.bookmaker, s]));

describe("formatRunSummaryLine", () => {
  it("one summary line for run 2", () =>
    expect(
      formatRunSummaryLine({
        league: "premier-league",
        runId: "440d2fc6-658b-46fe-b288-05261faa0caf",
        finishedAt: new Date("2026-11-06T16:02:49.798Z"),
        outcomes: run2,
      }),
    ).toBe(
      "[ScrapeRun] premier-league run=440d2fc6 finished=2026-11-06T16:02:49.798Z ok=9/14 matches=180 saved=68201 failed=betters:scrape_failed,lebull:scrape_failed,betcris:scrape_failed,pzbuk:scrape_failed,totalbet:scrape_failed",
    ));

  it("counts matches of every outcome but saved markets of OK outcomes only, and says failed=none when all are OK", () => {
    const line = formatRunSummaryLine({
      league: "premier-league",
      runId: "440d2fc6-658b-46fe-b288-05261faa0caf",
      finishedAt: new Date("2026-11-06T16:02:49.798Z"),
      outcomes: [
        outcome({ bookmaker: "betclic", status: "success", marketsSaved: 3150 }),
        outcome({ bookmaker: "fortuna", status: "partial", marketsSaved: 2801 }),
      ],
    });
    expect(line).toBe(
      "[ScrapeRun] premier-league run=440d2fc6 finished=2026-11-06T16:02:49.798Z ok=2/2 matches=40 saved=5951 failed=none",
    );
    expect(formatRunSummaryLine({ league: "premier-league", runId: "x", finishedAt: new Date(0), outcomes: run1 })).toContain(
      "ok=3/14 matches=200 saved=9786 failed=fortuna:persist_failed,superbet:persist_failed,",
    );
  });
});

describe("formatAbortAlert", () => {
  it("abort line", () =>
    expect(formatAbortAlert("premier-league", "TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)")).toBe(
      "[ALERT] scrape run ABORTED for premier-league: database unreachable - TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)",
    ));
});

describe("buildRunAlerts", () => {
  it("streak alert fires once at the threshold", () => {
    const s = (n: number) =>
      summaries(
        summary({ bookmaker: "betters", lastStatus: "scrape_failed", consecutiveFailures: n, failingSince: "2026-11-06T15:44:03.000Z", lastError: BETTERS_ERR }),
      );
    expect(buildRunAlerts({ league: "premier-league", outcomes: run2, summaries: s(3), threshold: 3 })).toContain(
      "[ALERT] betters (premier-league) failed 3 consecutive runs since 2026-11-06T15:44:03.000Z: No events found from API | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485",
    );
    expect(
      buildRunAlerts({ league: "premier-league", outcomes: run2, summaries: s(4), threshold: 3 }).filter((l) => l.includes("betters")),
    ).toEqual([]);
    expect(
      buildRunAlerts({ league: "premier-league", outcomes: run2, summaries: s(2), threshold: 3 }).filter((l) => l.includes("betters")),
    ).toEqual([]);
  });

  it("persist failures alert immediately", () => {
    const lines = buildRunAlerts({ league: "premier-league", outcomes: run1, summaries: new Map(), threshold: 3 });
    expect(lines[0]).toMatch(
      /^\[ALERT\] premier-league: 7 bookmaker\(s\) scraped but NOT saved \(fortuna,superbet,lvbet,fuksiarz,betfan,forbet,etoto\) - Batch insert failed/,
    );
    expect(lines).toEqual([
      `[ALERT] premier-league: 7 bookmaker(s) scraped but NOT saved (fortuna,superbet,lvbet,fuksiarz,betfan,forbet,etoto) - ${PERSIST_ERR}`,
    ]);
  });

  it("all-empty run collapses to one league alert (Review Focus 4)", () => {
    const empty = CONFIG.BOOKMAKERS.map((bm) =>
      outcome({ bookmaker: bm, status: "empty", matchesFound: 0, error: "Scraper reported success with 0 matches" }),
    );
    const atThreshold = summaries(
      ...CONFIG.BOOKMAKERS.map((bm) =>
        summary({ bookmaker: bm, lastStatus: "empty", consecutiveFailures: 3, failingSince: "2026-11-06T14:00:00.000Z", lastError: "Scraper reported success with 0 matches" }),
      ),
    );
    const lines = buildRunAlerts({ league: "premier-league", outcomes: empty, summaries: atThreshold, threshold: 3 });
    expect(lines).toEqual([
      "[ALERT] premier-league: 14/14 bookmakers returned 0 matches - per-bookmaker alerts suppressed for this run",
    ]);
  });

  it("half the bookmakers empty collapses even with OK outcomes (owner decision A6); the others keep their lines", () => {
    const EMPTY: readonly PolishBookmaker[] = ["forbet", "etoto", "betters", "lebull", "betcris", "pzbuk", "totalbet"];
    const outcomes = CONFIG.BOOKMAKERS.map((bm) =>
      EMPTY.includes(bm)
        ? outcome({ bookmaker: bm, status: "empty", matchesFound: 0, error: "Scraper reported success with 0 matches" })
        : bm === "betfan"
          ? outcome({ bookmaker: bm, status: "scrape_failed", matchesFound: 0, error: "No events found from API" })
          : outcome({ bookmaker: bm, status: "success", marketsSaved: 5000 }),
    );
    const s = summaries(
      ...EMPTY.map((bm) => summary({ bookmaker: bm, lastStatus: "empty", consecutiveFailures: 3, failingSince: "2026-11-06T14:00:00.000Z" })),
      summary({ bookmaker: "betfan", lastStatus: "scrape_failed", consecutiveFailures: 3, failingSince: "2026-11-06T14:00:00.000Z", lastError: "No events found from API" }),
      summary({ bookmaker: "betclic", recoveredAfterFailures: 3 }),
    );
    expect(buildRunAlerts({ league: "premier-league", outcomes, summaries: s, threshold: 3 })).toEqual([
      "[ALERT] premier-league: 7/14 bookmakers returned 0 matches - per-bookmaker alerts suppressed for this run",
      "[ALERT-RESOLVED] betclic (premier-league) ok again after 3 failed runs",
      "[ALERT] betfan (premier-league) failed 3 consecutive runs since 2026-11-06T14:00:00.000Z: No events found from API",
    ]);
  });

  it("fewer than half empty does not collapse: an empty bookmaker gets its own streak line", () => {
    const outcomes = run2.map((o) => (o.bookmaker === "etoto" ? outcome({ bookmaker: "etoto", status: "empty", matchesFound: 0, error: "Scraper reported success with 0 matches" }) : o));
    const s = summaries(
      summary({ bookmaker: "etoto", lastStatus: "empty", consecutiveFailures: 3, failingSince: "2026-11-06T14:00:00.000Z", lastError: "Scraper reported success with 0 matches" }),
    );
    expect(buildRunAlerts({ league: "premier-league", outcomes, summaries: s, threshold: 3 })).toEqual([
      "[ALERT] etoto (premier-league) failed 3 consecutive runs since 2026-11-06T14:00:00.000Z: Scraper reported success with 0 matches",
    ]);
  });

  it("resolved line", () => {
    const outcomes = run2.map((o) => (o.bookmaker === "betcris" ? outcome({ bookmaker: "betcris", status: "success", marketsSaved: 9753 }) : o));
    const lines = buildRunAlerts({
      league: "premier-league",
      outcomes,
      summaries: summaries(summary({ bookmaker: "betcris", consecutiveFailures: 0, recoveredAfterFailures: 3 })),
      threshold: 3,
    });
    expect(lines).toContain("[ALERT-RESOLVED] betcris (premier-league) ok again after 3 failed runs");
    expect(
      buildRunAlerts({
        league: "premier-league",
        outcomes,
        summaries: summaries(summary({ bookmaker: "betcris", recoveredAfterFailures: 2 })),
        threshold: 3,
      }),
    ).toEqual([]);
  });

  it("resolved also fires after an outage longer than the threshold (>= threshold, not only exactly at it)", () => {
    const outcomes = run2.map((o) => (o.bookmaker === "betcris" ? outcome({ bookmaker: "betcris", status: "success", marketsSaved: 9753 }) : o));
    expect(
      buildRunAlerts({
        league: "premier-league",
        outcomes,
        summaries: summaries(summary({ bookmaker: "betcris", recoveredAfterFailures: 7 })),
        threshold: 3,
      }),
    ).toEqual(["[ALERT-RESOLVED] betcris (premier-league) ok again after 7 failed runs"]);
  });

  it("alerts only for bookmakers that ran in this run, so a single-bookmaker run does not repeat others' alerts", () => {
    const lines = buildRunAlerts({
      league: "premier-league",
      outcomes: [outcome({ bookmaker: "forbet", status: "success", marketsSaved: 5869 })],
      summaries: summaries(
        summary({ bookmaker: "betters", lastStatus: "scrape_failed", consecutiveFailures: 3, failingSince: "2026-11-06T14:00:00.000Z", lastError: BETTERS_ERR }),
        summary({ bookmaker: "pzbuk", recoveredAfterFailures: 3 }),
      ),
      threshold: 3,
    });
    expect(lines).toEqual([]);
  });

  it("nothing to alert for a clean run or an empty outcome list", () => {
    const clean = run2.filter((o) => o.status === "success");
    expect(buildRunAlerts({ league: "premier-league", outcomes: clean, summaries: new Map(), threshold: 3 })).toEqual([]);
    expect(buildRunAlerts({ league: "premier-league", outcomes: [], summaries: new Map(), threshold: 3 })).toEqual([]);
  });

  it("a threshold of 0 never alerts a healthy bookmaker (no streak or resolved line for 0 failures)", () => {
    const clean = run2.filter((o) => o.status === "success");
    const healthy = summaries(...clean.map((o) => summary({ bookmaker: o.bookmaker })));
    expect(buildRunAlerts({ league: "premier-league", outcomes: clean, summaries: healthy, threshold: 0 })).toEqual([]);
  });
});

describe("emitAlerts", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let timeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Pass-through spy: the real AbortSignal.timeout still runs.
    timeoutSpy = vi.spyOn(AbortSignal, "timeout");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    timeoutSpy.mockRestore();
  });

  it("webhook only when configured; failures never throw", async () => {
    const f = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", f);
    await emitAlerts(["[ALERT] x"], null);
    expect(f).not.toHaveBeenCalled();
    await expect(emitAlerts(["[ALERT] x"], "http://127.0.0.1:9/hook")).resolves.toBeUndefined();
    expect(f).toHaveBeenCalledWith(
      "http://127.0.0.1:9/hook",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "[ALERT] x" }) }),
    );
    expect(warnSpy).toHaveBeenCalledWith("[RunAlerts] webhook failed: ECONNREFUSED");
  });

  it("logs every line and posts them as one Slack-compatible message with a timeout", async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", f);
    await emitAlerts(["[ALERT] a", "[ALERT-RESOLVED] b"], "https://hooks.example/x");
    expect(errorSpy.mock.calls).toEqual([["[ALERT] a"], ["[ALERT-RESOLVED] b"]]);
    expect(f).toHaveBeenCalledTimes(1);
    const [, init] = f.mock.calls[0];
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "[ALERT] a\n[ALERT-RESOLVED] b" }),
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // A slow webhook must not hold up the run for longer than 5 s.
    expect(timeoutSpy).toHaveBeenCalledWith(5000);
    expect(init.signal).toBe(timeoutSpy.mock.results[0]?.value);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not post when there is nothing to say", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await emitAlerts([], "https://hooks.example/x");
    expect(f).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("warns when the webhook answers with an error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 500 })));
    await expect(emitAlerts(["[ALERT] x"], "https://hooks.example/x")).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith("[RunAlerts] webhook failed: HTTP 500");
  });
});

describe("alert config", () => {
  // CONFIG is computed at import: stub the env, then load a fresh copy of the module.
  // dotenv never overrides a variable that is already set, so a local .env cannot interfere.
  const loadConfig = async () => {
    vi.resetModules();
    return (await import("../../config/index.js")).CONFIG;
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults: alert after 3 consecutive failures, webhook off (owner decision B8)", async () => {
    vi.stubEnv("ALERT_CONSECUTIVE_FAILURES", "");
    vi.stubEnv("ALERT_WEBHOOK_URL", "");
    const config = await loadConfig();
    expect(config.ALERT_CONSECUTIVE_FAILURES).toBe(3);
    expect(config.ALERT_WEBHOOK_URL).toBeNull();
  });

  it("reads both variables when set", async () => {
    vi.stubEnv("ALERT_CONSECUTIVE_FAILURES", "5");
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.example/x");
    const config = await loadConfig();
    expect(config.ALERT_CONSECUTIVE_FAILURES).toBe(5);
    expect(config.ALERT_WEBHOOK_URL).toBe("https://hooks.example/x");
  });
});
