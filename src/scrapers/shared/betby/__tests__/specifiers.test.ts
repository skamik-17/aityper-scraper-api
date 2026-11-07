import { describe, expect, it } from "vitest";
import {
  classifyLine,
  formatLine,
  formatSignedLine,
  parseSpecifiers,
  readEuropeanHandicap,
  readLine,
  readTotalLine,
} from "../specifiers.js";
import type { BetbyBookmaker, BetbyEnvelope, BetbyEvent } from "../types.js";
import { loadJson } from "./fixtures.js";

// Values that must never become a line: blank (Number("") is 0), non-decimal spellings that
// Number() still accepts, non-finite values, values off the quarter grid, and a large value
// whose String() would switch to exponent notation.
const MALFORMED = [
  undefined, "", " ", " 2.5", "2.5 ", "abc", "NaN", "Infinity", "-Infinity", "+Infinity",
  "1e1", "0x10", "0b1", "2.", ".5", "1,5", "2.5.1", "1:0", "--1", "2.3", "0.3", "2.1",
  "1" + "0".repeat(20),
];

describe("betby specifiers", () => {
  it("parseSpecifiers splits on | and then on the first =", () => {
    expect(parseSpecifiers("from=0:00|to=15:00|hcp=-0.5")).toEqual({ from: "0:00", to: "15:00", hcp: "-0.5" });
    expect(parseSpecifiers("variant=sr:goal_range:7+")).toEqual({ variant: "sr:goal_range:7+" });
    expect(parseSpecifiers("")).toEqual({});
  });

  it("classifyLine tells half, integer and quarter lines apart", () => {
    expect([2.5, 3, -1, 0, 2.75, -0.25].map(classifyLine)).toEqual(["half", "integer", "integer", "integer", "quarter", "quarter"]);
  });

  it("formatSignedLine signs every non-zero line and spells zero as 0", () => {
    expect([-1.5, 1.5, 0, Number("-1.0"), 1].map(formatSignedLine)).toEqual(["-1.5", "+1.5", "0", "-1", "+1"]);
  });

  it("formatLine prints the plain number", () => {
    expect([3, 2.5, Number("4")].map(formatLine)).toEqual(["3", "2.5", "4"]);
  });

  it("readLine accepts plain decimals on the quarter grid", () => {
    const ok = ["2.5", "3", "-1.0", "-1", "+1", "1", "0", "2.75", "-0.25", "-4.5", "02.5"];
    expect(ok.map((v) => readLine(v))).toEqual([2.5, 3, -1, -1, 1, 1, 0, 2.75, -0.25, -4.5, 2.5]);
    expect(formatSignedLine(readLine("-1.0")!)).toBe("-1");
    expect(formatSignedLine(readLine("-0")!)).toBe("0");
  });

  it("readLine rejects blank, non-decimal, non-finite and off-grid values", () => {
    for (const v of MALFORMED) expect(readLine(v), JSON.stringify(v)).toBeNull();
  });

  it("readTotalLine also rejects a zero or negative total", () => {
    expect(["0.5", "1", "2.75", "6.5", "+2.5"].map((v) => readTotalLine(v))).toEqual([0.5, 1, 2.75, 6.5, 2.5]);
    for (const v of [...MALFORMED, "0", "-0", "+0", "0.0", "-1.5", "-0.25"]) {
      expect(readTotalLine(v), JSON.stringify(v)).toBeNull();
    }
  });

  it("readEuropeanHandicap turns a:b into the home side's goal start a-b", () => {
    expect(["1:0", "0:1", "2:0", "0:3"].map((v) => readEuropeanHandicap(v))).toEqual([1, -1, 2, -3]);
    expect(formatSignedLine(readEuropeanHandicap("1:0")!)).toBe("+1");
    expect(formatSignedLine(readEuropeanHandicap("0:2")!)).toBe("-2");
  });

  it("readEuropeanHandicap rejects malformed and level a:b values", () => {
    const bad = [undefined, "", " ", "x:0", "0:x", "1", "1:", ":1", ":", "1:1", "0:0", "-1:0", "1:-1", "1.5:0",
      "1:0:0", " 1:0", "1:0 ", "1;0", "1-0"];
    for (const v of bad) expect(readEuropeanHandicap(v), JSON.stringify(v)).toBeNull();
  });

  it("the readers accept every total and handicap line in the evidence", () => {
    const TOTALS = ["18", "19", "20", "36", "37", "68", "90", "547"];
    const ASIAN = ["16", "66"];
    const EUROPEAN = ["14", "65"];
    const files: [BetbyBookmaker, string][] = [
      ["betters", "event-2725816334213586962.json"],
      ["betters", "event-2725816334213586981.json"],
      ["betters", "event-2726177353700085769.json"],
      ["betters", "event-2725446939305979931.json"],
      ["lebull", "event-2725816334213586962.json"],
    ];
    const events: BetbyEvent[] = files.flatMap(([bm, f]) =>
      Object.values(loadJson<{ events: Record<string, BetbyEvent> }>(bm, f).events),
    );
    for (const bm of ["betters", "lebull"] as const) {
      for (const chunk of loadJson<{ chunks: BetbyEnvelope[] }>(bm, "snapshot-trimmed.json").chunks) {
        events.push(...Object.values(chunk.events ?? {}));
      }
    }
    const seen = new Map<string, number>();
    const rejected: string[] = [];
    for (const ev of events) {
      for (const [id, bySpec] of Object.entries(ev.markets ?? {})) {
        for (const spec of Object.keys(bySpec)) {
          const s = parseSpecifiers(spec);
          let value: number | null;
          if (TOTALS.includes(id)) value = readTotalLine(s.total);
          else if (ASIAN.includes(id)) value = readLine(s.hcp);
          else if (EUROPEAN.includes(id)) value = readEuropeanHandicap(s.hcp);
          else continue;
          seen.set(id, (seen.get(id) ?? 0) + 1);
          if (value === null) rejected.push(`${id} ${spec}`);
        }
      }
    }
    expect(rejected).toEqual([]);
    // Every line market of the phase-1 table is exercised at least once.
    expect([...seen.keys()].sort()).toEqual([...TOTALS, ...ASIAN, ...EUROPEAN].sort());
  });
});
