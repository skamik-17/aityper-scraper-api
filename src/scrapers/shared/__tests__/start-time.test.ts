import { describe, it, expect } from "vitest";
import { toIsoStartTime } from "../start-time.js";

describe("toIsoStartTime", () => {
  it.each([
    [1794054600000, "2026-11-07T12:30:00.000Z"], // forbet/etoto/betfan/fuksiarz eventStart (ms)
    [1794054600, "2026-11-07T12:30:00.000Z"], // epoch seconds
    ["2026-11-08T14:00:00+00:00", "2026-11-08T14:00:00.000Z"], // lvbet date
    ["2026-11-07T12:30:00.0000000Z", "2026-11-07T12:30:00.000Z"], // betclic listing field 3
    [0, undefined],
    [null, undefined],
    [undefined, undefined],
    ["not a date", undefined],
  ])("toIsoStartTime(%j) → %j", (input, expected) => expect(toIsoStartTime(input as never)).toBe(expected));
});
