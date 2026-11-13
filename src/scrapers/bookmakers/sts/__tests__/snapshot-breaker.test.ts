import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../navigation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../navigation.js")>()),
  navigateAndCaptureLeagueData: vi.fn(),
  navigateAndCaptureMatchData: vi.fn(),
}));

import * as nav from "../navigation.js";
import { PlaywrightScraper } from "../../../base/playwright-base.js";
import { STSPlaywrightScraper } from "../index.js";
import { MAX_CONSECUTIVE_MATCH_FAILURES } from "../constants.js";
import type { WSCaptureResult } from "../types.js";

const fx = (f: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", f), "utf8");
const IPL = fx("i_pl.trimmed.txt"); // 20 valid PL fixtures, f2921895 first
const LEEDS = fx("f_f2921896_pl.leeds-tottenham.snapshot.txt");
const snapshotFor = (id: string) => LEEDS.replaceAll("f2921896", id); // the same snapshot, re-keyed to another fixture
const capture = (...frames: string[]): WSCaptureResult => {
  const r: WSCaptureResult = { initialData: "", fixtureData: new Map() };
  for (const f of frames) nav.recordStsFrame(r, f);
  return r;
};
const FIRST = "https://www.sts.pl/kursy/manchester-united-aston-villa/f2921895";

async function run(hit: (id: string) => boolean) {
  vi.mocked(nav.navigateAndCaptureLeagueData).mockResolvedValue(capture(IPL));
  vi.mocked(nav.navigateAndCaptureMatchData).mockImplementation(async (_page: unknown, url: string) => {
    const id = url.split("/").pop()!;
    return capture(IPL, ...(hit(id) ? [snapshotFor(id)] : []));
  });
  vi.spyOn(PlaywrightScraper.prototype as any, "executeFullOfferScrape").mockImplementation(
    (league: any, _valid: any, logic: any) => logic({}, league) // bypasses the browser and the recorder
  );
  vi.spyOn(PlaywrightScraper.prototype as any, "delay").mockResolvedValue(undefined);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const r = await new STSPlaywrightScraper().scrapeFullOffer("premier-league");
  return {
    r,
    warns: warn.mock.calls.map(([m]) => String(m)),
    logs: log.mock.calls.map(([m]) => String(m)),
    pages: vi.mocked(nav.navigateAndCaptureMatchData).mock.calls.length,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(nav.navigateAndCaptureMatchData).mockReset();
});

describe("sts browser path: snapshot circuit breaker", () => {
  it("stops after 3 consecutive fixtures without a snapshot", async () => {
    const { r, warns, logs, pages } = await run(() => false);
    expect(r).toMatchObject({ success: false, matches: [], error: `3 of 20 details failed | no fixture snapshot ${FIRST}` });
    expect(pages).toBe(6); // 3 fixtures x 2 attempts; today 40
    expect(warns.filter((w) => w.startsWith("[STS/FullOffer] No fixture snapshot for "))).toHaveLength(3);
    expect(warns).toContain("[STS/FullOffer] Aborting per-fixture loop: 3 consecutive fixtures without a snapshot");
    expect(logs.some((l) => l.startsWith("[STS/FullOffer] Completed:"))).toBe(false);
  });

  it("a captured fixture resets the count; the error names the first miss", async () => {
    // fixtures 1 miss, 2 hit, 3 miss, 4 hit, 5-7 miss -> trips at fixture 7 with 5 misses
    const { r, pages } = await run((id) => id === "f2921896" || id === "f2921898");
    expect(r).toMatchObject({ success: false, matches: [], error: `5 of 20 details failed | no fixture snapshot ${FIRST}` });
    expect(pages).toBe(12);
  });

  it("a miss below the breaker keeps success and names the cause", async () => {
    const { r, logs } = await run((id) => id !== "f2921897");
    expect(r.success).toBe(true);
    expect(r.error).toBe("1 of 20 details failed | no fixture snapshot https://www.sts.pl/kursy/fulham-newcastle/f2921897");
    expect(r.matches.map((m) => m.matchId)).not.toContain("f2921897");
    expect(r.matches.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.startsWith("[STS/FullOffer] Completed:"))).toBe(true);
  });

  it("no miss: success without an error key (characterization)", async () => {
    const { r, pages } = await run(() => true);
    expect([r.success, "error" in r, pages]).toEqual([true, false, 20]);
  });

  it("the breaker limit is 3", () => expect(MAX_CONSECUTIVE_MATCH_FAILURES).toBe(3));
});
