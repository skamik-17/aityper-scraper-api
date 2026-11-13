import { describe, expect, it } from "vitest";
import { assertScrapeIntervalMinutes, assertStartupScrape } from "../index.js";

describe("SCRAPE_INTERVAL_MINUTES", () => {
  it.each([["1", 1], ["60", 60], ["1440", 1440], [undefined, 30]])("accepts %j", (raw, n) => expect(assertScrapeIntervalMinutes(raw)).toBe(n));
  it.each(["0", "1441", "45abc", "abc", "", "-5", "7.5"])("rejects %j (Review Focus 5)", (raw) =>
    expect(() => assertScrapeIntervalMinutes(raw)).toThrow(`Invalid SCRAPE_INTERVAL_MINUTES "${raw}": expected an integer 1-1440`));
});

describe("STARTUP_SCRAPE", () => {
  it("accepts auto|always|never, defaults to auto, names a bad value", () => {
    expect([undefined, "auto", "always", "never"].map(assertStartupScrape)).toEqual(["auto", "auto", "always", "never"]);
    expect(() => assertStartupScrape("yes")).toThrow('Invalid STARTUP_SCRAPE "yes": expected auto|always|never');
  });
});
