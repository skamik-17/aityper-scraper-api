import { describe, expect, it } from "vitest";
import type { EventRef } from "../../../scrapers/shared/incremental/incremental-scraper.js";
import {
  HARD_CAP_NEAR_MS,
  planDetailFetches,
  TIER_MAX_AGE_MS,
  type EventFetchState,
  type TierLabel,
} from "../due-plan.js";

const now = Date.parse("2026-11-07T12:00:00.000Z");
// Times without a date are on 2026-11-07
const at = (t: string): string => (t.includes("T") ? t : `2026-11-07T${t}`);

const ref = (kickoff: string | null, fp: string | null = "aaaa"): EventRef => ({
  eventId: "e1",
  homeTeam: "Home",
  awayTeam: "Away",
  kickoff: kickoff === null ? null : new Date(at(kickoff)).toISOString(),
  fingerprint: fp,
  eventUrl: "https://x/e1",
  listing: null,
});
const st = (lastDetail: string | null, fp: string | null = "aaaa", status: "ok" | "degenerate" = "ok"): EventFetchState => ({
  lastDetailAt: lastDetail === null ? null : Date.parse(at(lastDetail)),
  fingerprint: fp,
  status,
});

type Row = [name: string, r: EventRef, s: EventFetchState | undefined, due: boolean, reason: string, tier?: TierLabel];

const ROWS: Row[] = [
  ["never fetched", ref("2026-11-09T12:00Z"), undefined, true, "never-fetched", "24to72h"],
  ["started a minute ago", ref("11:59Z"), undefined, false, "started", "lt1h"],
  ["kickoff equals now", ref("12:00Z"), st("11:00Z"), false, "started"],
  ["lt1h age 7 min is fresh", ref("12:30Z"), st("11:53Z"), false, "fresh", "lt1h"],
  ["lt1h age 8 min is due", ref("12:30Z"), st("11:52Z"), true, "tier-age", "lt1h"],
  ["59:59.999 is still lt1h", ref("12:59:59.999Z"), st("11:50Z"), true, "tier-age", "lt1h"],
  ["exactly 1 h is 1to3h, 17 min fresh", ref("13:00Z"), st("11:43Z"), false, "fresh", "1to3h"],
  ["1to3h 18 min due", ref("13:00Z"), st("11:42Z"), true, "tier-age"],
  ["3h boundary, 57 min fresh", ref("15:00Z"), st("11:03Z"), false, "fresh", "3to24h"],
  ["3to24h 58 min due", ref("15:00Z"), st("11:02Z"), true, "tier-age"],
  ["24h boundary, 117 min fresh", ref("2026-11-08T12:00Z"), st("10:03Z"), false, "fresh", "24to72h"],
  ["24to72h 118 min due", ref("2026-11-08T12:00Z"), st("10:02Z"), true, "tier-age"],
  ["72h boundary, 5h57 fresh", ref("2026-11-10T12:00Z"), st("06:03Z"), false, "fresh", "gt72h"],
  ["gt72h 5h58 due", ref("2026-11-10T12:00Z"), st("06:02Z"), true, "tier-age", "gt72h"],
  ["71h59 uses the 2 h tier", ref("2026-11-10T11:59Z"), st("10:02Z"), true, "tier-age", "24to72h"],
  ["fingerprint changed", ref("2026-11-10T12:00Z"), st("11:50Z", "bbbb"), true, "fingerprint-changed"],
  ["null listing fp never triggers", ref("2026-11-10T12:00Z", null), st("11:50Z", "bbbb"), false, "fresh"],
  ["null stored fp triggers", ref("2026-11-10T12:00Z"), st("11:50Z", null), true, "fingerprint-changed"],
  ["degenerate snapshot", ref("2026-11-10T12:00Z"), st("11:50Z", "aaaa", "degenerate"), true, "degenerate"],
  ["detail never stamped", ref("2026-11-10T12:00Z"), st(null), true, "never-fetched"],
  ["unknown kickoff 8 min due", ref(null), st("11:52Z"), true, "tier-age", "noKickoff"],
  ["unknown kickoff 7 min fresh", ref(null), st("11:53Z"), false, "fresh", "noKickoff"],
];

describe("planDetailFetches", () => {
  it.each(ROWS)("%s", (_name, r, s, due, reason, tier) => {
    const [d] = planDetailFetches([r], () => s, now);
    expect(d.ref).toBe(r);
    expect(d.due).toBe(due);
    expect(d.reason).toBe(reason);
    if (tier !== undefined) expect(d.tier).toBe(tier);
    expect(d.ageMs).toBe(s?.lastDetailAt == null ? null : now - s.lastDetailAt);
  });

  it("forceAll fetches fresh events but never started ones", () => {
    const fresh = ref("2026-11-10T12:00Z");
    const started = ref("11:59Z");
    const ds = planDetailFetches([fresh, started], () => st("11:50Z"), now, { forceAll: true });
    expect(ds.map((d) => [d.due, d.reason])).toEqual([
      [true, "forced"],
      [false, "started"],
    ]);
  });

  it("caps inside 72 h never exceed 2 h", () =>
    expect(
      Math.max(...(["lt1h", "1to3h", "3to24h", "24to72h", "noKickoff"] as const).map((t) => TIER_MAX_AGE_MS[t])),
    ).toBe(HARD_CAP_NEAR_MS));
});
