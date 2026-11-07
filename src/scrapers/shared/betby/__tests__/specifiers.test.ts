import { describe, expect, it } from "vitest";
import { classifyLine, formatLine, formatSignedLine, parseSpecifiers } from "../specifiers.js";

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
});
