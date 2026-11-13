import { describe, it, expect } from "vitest";
import { assessMatchGroups, MIN_GROUP_BYTES, type BetclicGroupName, type BetclicGroupResult } from "../match-groups.js";
import { parseAllMarketsFromMultipleResponses, parseMatchHeader } from "../parser.js";
import { groupResults, HANDICAP_MSG, TOP_MSG } from "./betclic-fixtures.js";

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

  it("drops a payload byte-identical to an earlier group, keeps a one-byte difference", () => {
    const top = Buffer.alloc(300, 7);
    const a = assessMatchGroups(distinct({ TOP: top, METODA_GOLA: Buffer.from(top) }));
    expect(a).toMatchObject({ ok: true, duplicates: [{ group: "METODA_GOLA", sameAs: "TOP" }] });
    expect(a.ok && a.responses).toHaveLength(6);
    const changed = Buffer.from(top);
    changed[299] = 8;
    expect(assessMatchGroups(distinct({ TOP: top, METODA_GOLA: changed }))).toMatchObject({ ok: true, duplicates: [] });
  });

  it("far-match echo: 3 duplicates of TOP are not parsed", () => {
    const top = Buffer.alloc(300, 7);
    const a = assessMatchGroups(distinct({ TOP: top, STRZELCY: Buffer.from(top), METODA_GOLA: Buffer.from(top), STATYSTYKI: Buffer.from(top) }));
    expect(a.ok && a.duplicates.map((d) => `${d.group}=${d.sameAs}`)).toEqual(["STRZELCY=TOP", "METODA_GOLA=TOP", "STATYSTYKI=TOP"]);
    expect(a.ok && a.responses).toHaveLength(4);
  });

  it("parse output with duplicates skipped deep-equals the parse of all 7 (recorded payloads)", () => {
    const all = groupResults();
    const a = assessMatchGroups(all);
    expect(a.ok && a.responses).toHaveLength(2);
    expect(parseAllMarketsFromMultipleResponses(a.ok ? a.responses : [])).toEqual(parseAllMarketsFromMultipleResponses(all.map((r) => r.response!)));
  });
});

describe("parseMatchHeader", () => {
  const OPTA_CATEGORIES = ["ca_ftb_top", "ca_ftb_ft", "ca_ftb_rslt", "ca_ftb_pssb", "ca_ftb_gsc", "ca_ftb_goa", "ca_ftb_cshcp", "ca_ftb_prp"];

  it("reads the declared categories from TOP (Arsenal-Hull)", () =>
    expect(parseMatchHeader(TOP_MSG)).toEqual({ categories: OPTA_CATEGORIES }));

  it("every group carries the same header (HANDICAP)", () => expect(parseMatchHeader(HANDICAP_MSG)).toEqual(parseMatchHeader(TOP_MSG)));

  it("malformed input gives an empty list", () => {
    expect(parseMatchHeader(Buffer.from("not protobuf"))).toEqual({ categories: [] });
    expect(parseMatchHeader(Buffer.alloc(0))).toEqual({ categories: [] });
    expect(parseMatchHeader(TOP_MSG.subarray(0, 5995))).toEqual({ categories: [] }); // truncated: lengths overrun
    expect(parseMatchHeader(Buffer.from([0x08, 0xff]))).toEqual({ categories: [] }); // varint past the end
  });
});
