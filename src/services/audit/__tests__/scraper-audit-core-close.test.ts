import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../scrapers/base/browser-runtime.js", async (orig) => ({
  ...(await orig<typeof import("../../../scrapers/base/browser-runtime.js")>()),
  browserRuntime: { openSession: vi.fn(), closeAll: vi.fn(), closeIfIdle: vi.fn(async () => {}), activeSessions: 0, waitingSessions: 0 },
}));

const { browserRuntime } = await import("../../../scrapers/base/browser-runtime.js");
const { scrapeOneMatchFullOffer } = await import("../scraper-audit-core.js");

afterEach(() => vi.mocked(browserRuntime.closeIfIdle).mockClear());

const offer = (eventUrl: string, markets: number) => ({ eventUrl, homeTeam: "A", awayTeam: "B", markets: Array.from({ length: markets }, () => ({})) });

describe("scrapeOneMatchFullOffer and the shared browser (plan 08 Review Focus 5)", () => {
  it("scrapeOneMatchFullOffer closes an idle browser after success and after a throw", async () => {
    const ok = { scrapeFullOffer: vi.fn(async () => ({ success: true, bookmaker: "fortuna", league: "premier-league", matches: [offer("https://x/1", 3)] })) };
    const m = await scrapeOneMatchFullOffer(ok as never, "premier-league", "https://x/1");
    expect(m?.eventUrl).toBe("https://x/1");
    expect(browserRuntime.closeIfIdle).toHaveBeenCalledTimes(1);

    vi.mocked(browserRuntime.closeIfIdle).mockClear();
    const boom = { scrapeFullOffer: vi.fn(async () => Promise.reject(new Error("boom"))) };
    await expect(scrapeOneMatchFullOffer(boom as never, "premier-league", "https://x/1")).rejects.toThrow("boom");
    expect(browserRuntime.closeIfIdle).toHaveBeenCalledTimes(1);
  });

  it("closes after a failed (empty) scrape too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const empty = { scrapeFullOffer: vi.fn(async () => ({ success: false, bookmaker: "fortuna", league: "premier-league", matches: [], error: "x" })) };
    expect(await scrapeOneMatchFullOffer(empty as never, "premier-league", "https://x/1")).toBeNull();
    expect(browserRuntime.closeIfIdle).toHaveBeenCalledTimes(1);
  });
});
