import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FullMatchOffer } from "../../types/full-offer.js";
import { RUN2_OK, RUN_ID, outcome } from "../../__tests__/helpers/run-fixtures.js";
import {
  OK_RUN_STATUSES,
  classifyBookmakerRun,
  formatDbError,
  isOkRunStatus,
} from "../run-outcome.js";

const shapes = JSON.parse(
  readFileSync(new URL("./fixtures/observability/db-error-shapes-2026-11-06.json", import.meta.url), "utf8"),
);
const twenty = Array.from({ length: 20 }, () => ({}) as FullMatchOffer);

describe("formatDbError", () => {
  it("extracts the socket cause from a supabase fetch failure", () => {
    expect(formatDbError(shapes.econnrefused)).toBe("TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)");
    expect(formatDbError(shapes.socketClosed)).toBe("TypeError: fetch failed (other side closed)");
    expect(formatDbError(shapes.epipe)).toBe("TypeError: fetch failed (write EPIPE)");
  });

  it("falls back to the cause code when the cause has no message", () => {
    // Captured 2026-11-07 on Node 20.19.5 with postgrest-js 2.89 against a closed port on
    // http://localhost:59999: happy eyeballs tries ::1 and 127.0.0.1 and rejects with an
    // AggregateError whose message is empty, so only the code survives in `details`.
    const localhostRefused = {
      message: "TypeError: fetch failed",
      details:
        "TypeError: fetch failed\n\nCaused by: AggregateError:  (ECONNREFUSED)\nAggregateError [ECONNREFUSED]: \n" +
        "    at internalConnectMultiple (node:net:1122:18)\n    at afterConnectMultiple (node:net:1689:7)",
      hint: "",
      code: "",
    };
    expect(formatDbError(localhostRefused)).toBe("TypeError: fetch failed (ECONNREFUSED)");

    // Synthetic: a code with digits is still recognised as the trailing code.
    expect(
      formatDbError({
        message: "TypeError: fetch failed",
        details: "TypeError: fetch failed\n\nCaused by: Error:  (ERR_HTTP2_STREAM_ERROR)\nError: \n    at x (node:internal:1:1)",
        hint: "",
        code: "",
      }),
    ).toBe("TypeError: fetch failed (ERR_HTTP2_STREAM_ERROR)");
  });

  it("ignores a cause line that carries neither a message nor a code", () => {
    // Synthetic: postgrest-js writes "Caused by: Error: " when cause.message and cause.code are empty.
    expect(
      formatDbError({
        message: "TypeError: fetch failed",
        details: "TypeError: fetch failed\n\nCaused by: Error: \nError: \n    at x (node:internal:1:1)",
        hint: "",
        code: "",
      }),
    ).toBe("TypeError: fetch failed");
    // A cause without a trailing code keeps its message.
    expect(
      formatDbError({
        message: "TypeError: fetch failed",
        details: "TypeError: fetch failed\n\nCaused by: Error: certificate has expired\nError: certificate has expired",
        hint: "",
        code: "",
      }),
    ).toBe("TypeError: fetch failed (certificate has expired)");
  });

  it("appends the PostgREST code when there is no socket cause", () => {
    expect(formatDbError(shapes.schemaCacheNotReady)).toBe(
      "Could not query the database for the schema cache. Retrying. [PGRST002]",
    );
    expect(
      formatDbError({
        code: "PGRST204",
        message: "Could not find the 'run_id' column of 'scraper_runs' in the schema cache",
        details: null,
        hint: null,
      }),
    ).toBe("Could not find the 'run_id' column of 'scraper_runs' in the schema cache [PGRST204]");
  });

  it("appends the first line of the details after the code", () => {
    // Synthetic Postgres foreign-key error in the PostgREST shape (the market_types
    // FK failure mode described in CLAUDE.md); not taken from a live log.
    expect(
      formatDbError({
        code: "23503",
        message: 'insert or update on table "odds" violates foreign key constraint "odds_market_type_id_fkey"',
        details: 'Key (market_type_id)=(999) is not present in table "market_types".\nsecond line',
        hint: null,
      }),
    ).toBe(
      'insert or update on table "odds" violates foreign key constraint "odds_market_type_id_fkey" [23503]: ' +
        'Key (market_type_id)=(999) is not present in table "market_types".',
    );
  });

  it("handles Error instances and strings", () => {
    expect(formatDbError(new Error("boom"))).toBe("boom");
    expect(formatDbError("plain")).toBe("plain");
  });

  it("never returns an empty string for values without a message", () => {
    expect(formatDbError(null)).toBe("Unknown database error");
    expect(formatDbError(undefined)).toBe("Unknown database error");
    expect(formatDbError({ code: "", message: "" })).toBe("Unknown database error");
    expect(formatDbError({ message: " \n\t " })).toBe("Unknown database error");
    expect(formatDbError(new Error(""))).toBe("Error");
  });

  it("keeps a non-JSON error body (gateway HTML) on one bounded line", () => {
    // postgrest-js sets `message` to the raw body when an error response is not JSON.
    const html =
      "<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n" +
      "<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n";
    expect(formatDbError({ message: html })).toBe(
      "<html> <head><title>502 Bad Gateway</title></head> <body> <center><h1>502 Bad Gateway</h1></center> <hr><center>nginx</center> </body> </html>",
    );

    const long = formatDbError({ message: `<html>\n${"<p>filler</p>\n".repeat(100)}</html>` });
    expect(long).not.toContain("\n");
    expect(long.length).toBe(300);
    expect(long.startsWith("<html> <p>filler</p> <p>filler</p>")).toBe(true);
  });
});

describe("classifyBookmakerRun", () => {
  it("scraped but nothing saved is persist_failed with the DB cause", () => {
    const err =
      "Batch insert failed (12 of 12 batches): TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:59999)";
    expect(
      classifyBookmakerRun({ success: true, matches: twenty }, { marketsNormalized: 5995, marketsSaved: 0, errors: [err] }),
    ).toEqual({ status: "persist_failed", error: err });
  });

  it("all markets filtered is persist_failed", () => {
    expect(
      classifyBookmakerRun({ success: true, matches: twenty }, { marketsNormalized: 420, marketsSaved: 0, errors: [] }),
    ).toEqual({ status: "persist_failed", error: "0 of 420 normalized markets saved (all filtered as non-canonical)" });
  });

  it("matches without any normalized market is persist_failed, not 'all filtered'", () => {
    expect(
      classifyBookmakerRun({ success: true, matches: twenty }, { marketsNormalized: 0, marketsSaved: 0, errors: [] }),
    ).toEqual({ status: "persist_failed", error: "20 matches scraped but 0 markets normalized" });
  });

  it("matches without a save result is persist_failed", () => {
    expect(classifyBookmakerRun({ success: true, matches: twenty }, null)).toEqual({
      status: "persist_failed",
      error: "20 matches scraped but no save was attempted",
    });
  });

  it("saved with some failed batches is partial", () => {
    // Synthetic but arithmetically consistent with BATCH_SIZE 500 (full-offer-repository.ts:657):
    // 3301 records = 7 batches (6 x 500 + 301); one full batch failed -> 2801 saved.
    // Not observed live: in run 1 PGRST002 failed all 19 lvbet batches (log L28318 onwards); betclic had no batch errors.
    const err =
      "Batch insert failed (1 of 7 batches): Could not query the database for the schema cache. Retrying. [PGRST002]";
    expect(
      classifyBookmakerRun({ success: true, matches: twenty }, { marketsNormalized: 3301, marketsSaved: 2801, errors: [err] }),
    ).toEqual({ status: "partial", error: err });
  });

  it("keeps the first of several errors and counts the rest", () => {
    // Synthetic: one match failed normalization and one batch failed afterwards.
    const errors = [
      "Normalization failed for Everton vs Coventry City: boom",
      "Batch insert failed (1 of 7 batches): TypeError: fetch failed (write EPIPE)",
    ];
    expect(
      classifyBookmakerRun({ success: true, matches: twenty }, { marketsNormalized: 3301, marketsSaved: 2801, errors }),
    ).toEqual({ status: "partial", error: "Normalization failed for Everton vs Coventry City: boom (+1 more)" });
  });

  it("nothing saved names the save-stage cause first, even after a normalization error", () => {
    // scrape-helpers pushes normalization errors before the batch error.
    const errors = [
      "Normalization failed for Everton vs Coventry City: boom",
      "Batch insert failed (12 of 12 batches): TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)",
    ];
    expect(
      classifyBookmakerRun({ success: true, matches: twenty }, { marketsNormalized: 5900, marketsSaved: 0, errors }),
    ).toEqual({
      status: "persist_failed",
      error:
        "Batch insert failed (12 of 12 batches): TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321) (+1 more)",
    });
    expect(
      classifyBookmakerRun(
        { success: true, matches: twenty },
        { marketsNormalized: 5900, marketsSaved: 0, errors: [errors[0], "Batch save failed: boom", "Save failed: oops"] },
      ).error,
    ).toBe("Batch save failed: boom (+2 more)");
  });

  it("a successful scrape that carries an error is partial, so the scraper's diagnostics survive", () => {
    // betcris (betcris/index.ts): success with the matches captured before the abort.
    const betcris = "aborted after 3 consecutive per-match capture failures";
    expect(
      classifyBookmakerRun(
        { success: true, matches: [twenty[0], twenty[1]], error: betcris },
        { marketsNormalized: 40, marketsSaved: 40, errors: [] },
      ),
    ).toEqual({ status: "partial", error: betcris });

    // totalbet (totalbet/index.ts): detail failures and slug drift are its diagnostics (totalbet.md risk 8).
    const totalbet =
      "Detail fetch failed for 17/20 events (first: HTTP 503) | phase-1 keys missing for Everton vs Coventry City: total,btts";
    expect(
      classifyBookmakerRun({ success: true, matches: twenty, error: totalbet }, { marketsNormalized: 60, marketsSaved: 60, errors: [] }),
    ).toEqual({ status: "partial", error: totalbet });

    // The save error follows the scraper's.
    const batch = "Batch insert failed (1 of 2 batches): TypeError: fetch failed (write EPIPE)";
    expect(
      classifyBookmakerRun(
        { success: true, matches: twenty, error: totalbet },
        { marketsNormalized: 60, marketsSaved: 30, errors: [batch] },
      ),
    ).toEqual({ status: "partial", error: `${totalbet} | ${batch}` });

    // An empty error string carries nothing.
    expect(
      classifyBookmakerRun({ success: true, matches: twenty, error: "" }, { marketsNormalized: 60, marketsSaved: 60, errors: [] }),
    ).toEqual({ status: "success", error: null });
  });

  it("clean save is success", () => {
    expect(
      classifyBookmakerRun({ success: true, matches: twenty }, { marketsNormalized: 3150, marketsSaved: 3150, errors: [] }),
    ).toEqual({ status: "success", error: null });
  });

  it("scraper failure keeps the scraper's text", () => {
    const err = "No events found from API | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485";
    expect(classifyBookmakerRun({ success: false, matches: [], error: err }, null)).toEqual({
      status: "scrape_failed",
      error: err,
    });
    expect(classifyBookmakerRun({ success: false, matches: [] }, null).error).toBe(
      "Scraper returned success=false without an error message",
    );
    expect(classifyBookmakerRun({ success: false, matches: [], error: "" }, null).error).toBe(
      "Scraper returned success=false without an error message",
    );
  });

  it("success with zero matches is empty", () => {
    expect(classifyBookmakerRun({ success: true, matches: [] }, null)).toEqual({
      status: "empty",
      error: "Scraper reported success with 0 matches",
    });
  });

  it("empty keeps the enriched navigation text (Task 2 output survives classification)", () => {
    const err = "0 matches | document HTTP 404 https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485";
    expect(classifyBookmakerRun({ success: true, matches: [], error: err }, null)).toEqual({
      status: "empty",
      error: err,
    });
  });

  it("isOkRunStatus", () => {
    expect(["success", "partial"].every(isOkRunStatus)).toBe(true);
    expect(["empty", "scrape_failed", "persist_failed", "running", null].some(isOkRunStatus)).toBe(false);
    expect(OK_RUN_STATUSES).toEqual(["success", "partial"]);
  });
});

describe("run fixtures", () => {
  it("match the run-2 evidence", () => {
    // Run 2 saved 68 201 rows across 9 bookmakers (observability.md, "Status today").
    expect(Object.values(RUN2_OK).reduce((a, b) => a + (b ?? 0), 0)).toBe(68201);
    const o = outcome();
    expect(o.runId).toBe(RUN_ID);
    expect(o.finishedAt.getTime() - o.startedAt.getTime()).toBe(o.durationMs);
  });
});

describe("classifyBookmakerRun: a scraper cause with saved rows (perf plan 07 Task 0)", () => {
  it("success with a scraper cause and saved rows is partial and keeps the cause (README §5.1)", () =>
    expect(
      classifyBookmakerRun(
        { success: true, matches: twenty, error: "aborted after 3 consecutive per-match capture failures" },
        { marketsNormalized: 6000, marketsSaved: 6000, errors: [] },
      ),
    ).toEqual({ status: "partial", error: "aborted after 3 consecutive per-match capture failures" }));

  it("joins the scraper cause and the save errors with ' | '", () =>
    expect(
      classifyBookmakerRun(
        { success: true, matches: twenty, error: "1 of 20 details failed | fetch HTTP 503 https://api.example/1" },
        {
          marketsNormalized: 4200,
          marketsSaved: 4100,
          errors: ["Batch insert failed (1 of 12 batches): TypeError: fetch failed (other side closed)"],
        },
      ),
    ).toEqual({
      status: "partial",
      error:
        "1 of 20 details failed | fetch HTTP 503 https://api.example/1 | Batch insert failed (1 of 12 batches): TypeError: fetch failed (other side closed)",
    }));

  it("an empty scraper error string is no cause", () =>
    expect(
      classifyBookmakerRun({ success: true, matches: twenty, error: "" }, { marketsNormalized: 10, marketsSaved: 10, errors: [] }),
    ).toEqual({ status: "success", error: null }));

  it("a scraper cause never turns a run that saved nothing into partial", () =>
    expect(
      classifyBookmakerRun(
        { success: true, matches: twenty, error: "aborted after 3 consecutive per-match capture failures" },
        { marketsNormalized: 420, marketsSaved: 0, errors: [] },
      ),
    ).toEqual({ status: "persist_failed", error: "0 of 420 normalized markets saved (all filtered as non-canonical)" }));
});

describe("classifyBookmakerRun: writes rejected after kickoff (plan 09 Task 8)", () => {
  it("all matches rejected is partial, not persist_failed (Review Focus 4)", () =>
    expect(classifyBookmakerRun({ success: true, matches: twenty }, { marketsNormalized: 4100, marketsSaved: 0, errors: [], rejectedStarted: 20 }))
      .toEqual({ status: "partial", error: "All 20 matches rejected: kickoff passed" }));

  it("a rejection next to a real save error stays persist_failed with that error", () =>
    expect(classifyBookmakerRun({ success: true, matches: twenty }, { marketsNormalized: 4100, marketsSaved: 0, errors: ["Batch insert failed (1 of 1 batches): x"], rejectedStarted: 3 }).status)
      .toBe("persist_failed"));
});
