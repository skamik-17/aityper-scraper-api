import { describe, it, expect, vi, afterEach } from "vitest";
import { getTransportOverride } from "../transport.js";

afterEach(() => vi.restoreAllMocks());

describe("getTransportOverride", () => {
  it.each([
    ["browser", "browser"],
    [" BROWSER ", "browser"],
    ["", undefined],
    [undefined, undefined],
  ])("SCRAPER_TRANSPORT_LVBET=%j → %s", (v, out) =>
    expect(getTransportOverride("lvbet", v === undefined ? {} : { SCRAPER_TRANSPORT_LVBET: v })).toBe(out));

  it("warns on an unknown value and ignores other bookmakers' variables", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getTransportOverride("sts", { SCRAPER_TRANSPORT_STS: "http", SCRAPER_TRANSPORT_FORTUNA: "browser" })).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[transport] Ignoring SCRAPER_TRANSPORT_STS="http": only "browser" is recognised');
  });
});
