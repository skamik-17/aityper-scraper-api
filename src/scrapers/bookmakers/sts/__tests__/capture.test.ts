import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isSnapshotFrame,
  recordStsFrame,
  hasFixtureSnapshot,
  captureMatchWithRetry,
} from "../navigation.js";
import { parseWebSocketJson, parseFixtures, parseAllMarkets } from "../parser.js";
import type { WSCaptureResult } from "../types.js";

/**
 * Frame capture regression coverage for the 2026-11 partial-match race:
 * a fixture delta frame (no "f":1 in its header) overwrote the full fixture
 * snapshot, and the match wait ended as soon as i_pl landed. The frames are
 * real captures (Leeds vs Tottenham, live order: i_pl, snapshot, delta).
 */
const fx = (f: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", f), "utf8");
const SNAP = "f_f2921896_pl.leeds-tottenham.snapshot.txt", DELTA = "f_f2921896_pl.leeds-tottenham.delta.txt";
const empty = (): WSCaptureResult => ({ initialData: "", fixtureData: new Map() });

describe("STS WebSocket frame capture", () => {
  it("isSnapshotFrame: true for the f:1 snapshot header, false for a delta", () => {
    expect(isSnapshotFrame(fx(SNAP))).toBe(true);
    expect(isSnapshotFrame(fx(DELTA))).toBe(false);
    expect(isSnapshotFrame(fx("i_pl.trimmed.txt"))).toBe(true);
  });
  it("recordStsFrame keeps the snapshot when a delta follows (live Leeds vs Tottenham order)", () => {
    const r = empty();
    for (const f of ["i_pl.trimmed.txt", SNAP, DELTA]) recordStsFrame(r, fx(f));
    const ipl = parseWebSocketJson(r.initialData)!;
    const fixture = parseFixtures(ipl, "premier-league").find((f) => f.id === "f2921896")!;
    expect(parseAllMarkets(fixture, r.fixtureData.get("f2921896")!, ipl).length).toBeGreaterThan(400); // 452 today; 1 with the delta
  });
  it("recordStsFrame: a newer snapshot replaces the stored one; a snapshot frame without a parsable body does not", () => {
    const r = empty();
    const head = '{"s":"f_f1_pl","n":1,"f":1}';
    recordStsFrame(r, `${head}\n{"P":{"older":{}}}`);
    recordStsFrame(r, `${head}\n{"P":{"newer":{}}}`);
    expect(Object.keys(r.fixtureData.get("f1")!.P!)).toEqual(["newer"]);
    recordStsFrame(r, head); // header only
    recordStsFrame(r, `${head}\n{"P":`); // truncated body
    expect(Object.keys(r.fixtureData.get("f1")!.P!)).toEqual(["newer"]);
  });
  it("hasFixtureSnapshot is false after i_pl only and after a delta only", () => {
    const r = empty(); recordStsFrame(r, fx("i_pl.trimmed.txt"));
    expect(hasFixtureSnapshot(r, "f2921896")).toBe(false);
    recordStsFrame(r, fx(DELTA)); expect(hasFixtureSnapshot(r, "f2921896")).toBe(false);
    recordStsFrame(r, fx(SNAP)); expect(hasFixtureSnapshot(r, "f2921896")).toBe(true);
  });
  it("captureMatchWithRetry retries once and returns the attempt that has the snapshot", async () => {
    const withSnap = empty(); recordStsFrame(withSnap, fx(SNAP));
    const results = [empty(), withSnap]; let calls = 0;
    const out = await captureMatchWithRetry(async () => results[calls++], "u", "f2921896");
    expect(out).toBe(withSnap); expect(calls).toBe(2);
  });
  it("captureMatchWithRetry returns null after 2 attempts without a snapshot", async () => {
    let calls = 0;
    expect(await captureMatchWithRetry(async () => { calls++; return empty(); }, "u", "f2921896")).toBeNull();
    expect(calls).toBe(2);
  });
  it("captureMatchWithRetry treats a null attempt as a miss and retries", async () => {
    const withSnap = empty(); recordStsFrame(withSnap, fx(SNAP));
    const results = [null, withSnap]; let calls = 0;
    const out = await captureMatchWithRetry(async () => results[calls++], "u", "f2921896");
    expect(out).toBe(withSnap); expect(calls).toBe(2);
  });
});
