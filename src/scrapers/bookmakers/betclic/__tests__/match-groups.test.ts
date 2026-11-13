import { describe, it, expect } from "vitest";
import { assessMatchGroups, MIN_GROUP_BYTES, type BetclicGroupName, type BetclicGroupResult } from "../match-groups.js";

const ORDER: BetclicGroupName[] = ["TOP", "WYNIK", "STRZELCY", "GOLE", "METODA_GOLA", "HANDICAP", "STATYSTYKI"];

/** Seven distinct completed groups (200 + i bytes each); string overrides fail a group. */
const distinct = (over: Partial<Record<BetclicGroupName, Buffer | string>> = {}): BetclicGroupResult[] =>
  ORDER.map((group, i) => {
    const value = group in over ? over[group]! : Buffer.alloc(200 + i, i + 1);
    return typeof value === "string" ? { group, response: null, error: value } : { group, response: value, error: null };
  });

describe("assessMatchGroups", () => {
  it("TOP floor is 100 bytes", () => expect(MIN_GROUP_BYTES).toBe(100));

  it("all 7 complete: ok, responses in MARKET_GROUP_FILTERS order", () => {
    const a = assessMatchGroups(distinct());
    expect(a.ok && a.responses.map((b) => b.length)).toEqual([200, 201, 202, 203, 204, 205, 206]);
  });

  it("TOP failed: skipped with the transport error", () =>
    expect(assessMatchGroups(distinct({ TOP: "Incomplete gRPC-web frame: 5995/197814 bytes" })))
      .toEqual({ ok: false, reason: "TOP missing: Incomplete gRPC-web frame: 5995/197814 bytes" }));

  it("TOP under 100 bytes: skipped", () =>
    expect(assessMatchGroups(distinct({ TOP: Buffer.alloc(37) }))).toEqual({ ok: false, reason: "TOP missing: 37 bytes" }));

  it("one non-TOP group failed: skipped", () =>
    expect(assessMatchGroups(distinct({ STRZELCY: "Incomplete gRPC-web frame: 388976/1295527 bytes" }))).toEqual({
      ok: false,
      reason: "6/7 required groups valid; failed: STRZELCY (Incomplete gRPC-web frame: 388976/1295527 bytes)",
    }));

  it("two failed groups are listed in group order", () =>
    expect(assessMatchGroups(distinct({ STATYSTYKI: "gRPC request failed: HTTP 503", GOLE: "gRPC-web frame deadline (10000 ms): 0/null bytes" })))
      .toEqual({
        ok: false,
        reason: "5/7 required groups valid; failed: GOLE (gRPC-web frame deadline (10000 ms): 0/null bytes); STATYSTYKI (gRPC request failed: HTTP 503)",
      }));

  it("an absent group counts as failed", () =>
    expect(assessMatchGroups(distinct().filter((r) => r.group !== "HANDICAP")))
      .toEqual({ ok: false, reason: "6/7 required groups valid; failed: HANDICAP (not fetched)" }));

  it("a completed non-TOP group under 100 bytes is valid but not parsed", () => {
    const a = assessMatchGroups(distinct({ HANDICAP: Buffer.alloc(40) }));
    expect(a).toMatchObject({ ok: true, emptyGroups: ["HANDICAP"] });
    expect(a.ok && a.responses).toHaveLength(6);
  });
});
