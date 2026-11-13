import { describe, expect, it } from "vitest";
import { CONFIG } from "../../config/index.js";
import { staleAfterMs } from "../bookmaker-status.js";
import { isStaleQuote, staleQuoteThresholdMs } from "../odds-freshness.js";

const NOW = new Date("2026-11-06T16:16:18.614Z");

describe("odds freshness (Review Focus 5)", () => {
  it("older than the threshold is stale; +00:00 parses", () => {
    expect(isStaleQuote("2026-11-06T14:00:00+00:00", NOW, 7_200_000)).toBe(true);
    expect(isStaleQuote("2026-11-06T16:00:45.385+00:00", NOW, 7_200_000)).toBe(false);
  });

  it("exactly at the threshold is not stale", () => {
    expect(isStaleQuote("2026-11-06T14:16:18.614Z", NOW, 7_200_000)).toBe(false);
  });

  it("the threshold is observability's staleAfterMs for the scrape interval", () => {
    expect(staleQuoteThresholdMs()).toBe(staleAfterMs(CONFIG.SCRAPE_INTERVAL_MINUTES));
  });
});
