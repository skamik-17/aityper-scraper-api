import { describe, expect, it } from "vitest";
import { formatIncrementalConfigLine, readIncrementalConfig } from "../incremental.js";

// Incremental (non-dry-run) mode needs the snapshot read path: confirmations only bump odds_snapshot
const SWITCHED = { ODDS_WRITE_MODEL: "switched" };

describe("readIncrementalConfig", () => {
  it("defaults to disabled", () =>
    expect(readIncrementalConfig({}, 60)).toEqual({ bookmakers: new Set(), passMinutes: 10, dryRun: false, error: null }));

  it("reads a trimmed bookmaker list", () =>
    expect(readIncrementalConfig({ ...SWITCHED, INCREMENTAL_BOOKMAKERS: "forbet, etoto" }, 60)).toEqual({
      bookmakers: new Set(["forbet", "etoto"]),
      passMinutes: 10,
      dryRun: false,
      error: null,
    }));

  it("an unknown bookmaker disables incremental mode", () =>
    expect(readIncrementalConfig({ ...SWITCHED, INCREMENTAL_BOOKMAKERS: "forbet,nosuch" }, 60)).toMatchObject({
      bookmakers: new Set(),
      error: "INCREMENTAL_BOOKMAKERS: unknown bookmaker nosuch",
    }));

  it("a pass interval outside 5..interval disables incremental mode", () => {
    for (const v of ["4", "61", "7.5", "ten"]) {
      expect(readIncrementalConfig({ ...SWITCHED, INCREMENTAL_BOOKMAKERS: "forbet", INCREMENTAL_PASS_MINUTES: v }, 60)).toMatchObject({
        bookmakers: new Set(),
        error: "INCREMENTAL_PASS_MINUTES must be an integer between 5 and 60",
      });
    }
    expect(readIncrementalConfig({ ...SWITCHED, INCREMENTAL_BOOKMAKERS: "forbet", INCREMENTAL_PASS_MINUTES: "15" }, 60).passMinutes).toBe(15);
  });

  it("reads the dry-run flag", () => {
    expect(readIncrementalConfig({ INCREMENTAL_DRY_RUN: "true" }, 60).dryRun).toBe(true);
    expect(readIncrementalConfig({ INCREMENTAL_DRY_RUN: "1" }, 60).dryRun).toBe(true);
    expect(readIncrementalConfig({ INCREMENTAL_DRY_RUN: "yes" }, 60).dryRun).toBe(false);
  });

  it("live incremental mode needs the snapshot read path; a dry run does not", () => {
    for (const model of [undefined, "legacy", "dual"]) {
      expect(readIncrementalConfig({ ODDS_WRITE_MODEL: model, INCREMENTAL_BOOKMAKERS: "forbet" }, 60)).toMatchObject({
        bookmakers: new Set(),
        error: "INCREMENTAL_BOOKMAKERS needs ODDS_WRITE_MODEL=switched or snapshot (the snapshot read path); incremental mode disabled",
      });
    }
    expect(readIncrementalConfig({ ODDS_WRITE_MODEL: "dual", INCREMENTAL_BOOKMAKERS: "forbet", INCREMENTAL_DRY_RUN: "true" }, 60).bookmakers).toEqual(
      new Set(["forbet"]),
    );
    expect(readIncrementalConfig({ ODDS_WRITE_MODEL: "snapshot", INCREMENTAL_BOOKMAKERS: "forbet" }, 60).error).toBeNull();
  });

  it("formats the startup line", () => {
    expect(formatIncrementalConfigLine(readIncrementalConfig({}, 60))).toBe("[Incremental] bookmakers=none passMinutes=10 dryRun=false");
    expect(
      formatIncrementalConfigLine(readIncrementalConfig({ INCREMENTAL_BOOKMAKERS: "forbet,etoto", INCREMENTAL_DRY_RUN: "true" }, 60)),
    ).toBe("[Incremental] bookmakers=forbet,etoto passMinutes=10 dryRun=true");
    expect(formatIncrementalConfigLine(readIncrementalConfig({ INCREMENTAL_BOOKMAKERS: "nosuch" }, 60))).toBe(
      "[Incremental] INCREMENTAL_BOOKMAKERS: unknown bookmaker nosuch; incremental mode disabled",
    );
  });
});
