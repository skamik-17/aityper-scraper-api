import { describe, it, expect } from "vitest";
import { detectParamFormatSts } from "../param-format.js";

describe("detectParamFormatSts", () => {
  it("classifies a decimal-dot line", () => {
    expect(detectParamFormatSts("2.5")).toBe("decimal_dot");
  });
  it("classifies a signed integer", () => {
    expect(detectParamFormatSts("-1")).toBe("signed_integer");
  });
  it("classifies a dual handicap as decimal_dot", () => {
    expect(detectParamFormatSts("+0.5/-0.5")).toBe("decimal_dot");
  });
  it("classifies a team-side param", () => {
    expect(detectParamFormatSts("HOME")).toBe("team_side");
    expect(detectParamFormatSts("AWAY:1")).toBe("team_side");
  });
  it("returns none for empty", () => {
    expect(detectParamFormatSts(undefined)).toBe("none");
    expect(detectParamFormatSts(null)).toBe("none");
  });
});
