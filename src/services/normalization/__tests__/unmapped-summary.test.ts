import { describe, it, expect, vi, afterEach } from "vitest";
import { summarizeUnmappedMarkets, formatUnmappedSummary } from "../unmapped-summary.js";
import { normalizeAndSaveMatches } from "../../scrape-helpers.js";
import type { FullMatchOffer, ScrapedMarket } from "../../../types/full-offer.js";

// normalizeAndSaveMatches persists through the repository; replace it so the
// wiring test never touches Supabase.
vi.mock("../../../repositories/full-offer-repository.js", () => ({
  saveFullOfferMarkets: vi.fn(async () => ({ inserted: 0 })),
  saveBatchFullOfferMarkets: vi.fn(async () => ({ inserted: 0, failedBatches: 0, totalBatches: 1, firstError: null })),
}));

const mk = (id: string | undefined, type: string, name = "x") => ({ name, bookmakerMarketId: id, normalizedType: type, selections: [] }) as any;

describe("unmapped market summary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("summarizeUnmappedMarkets counts OTHER markets by bookmaker id, falling back to the name", () => {
    const s = summarizeUnmappedMarkets([mk("ShotsonTarget2ndHalfTotal", "OTHER"), mk("ShotsonTarget2ndHalfTotal", "OTHER"),
      mk("PlayerShotsOutsidetheBox", "OTHER"), mk("FoulsTotal", "FOULS_TOTAL"), mk(undefined, "OTHER", "Faule. 1. połowa")]);
    expect(s).toEqual({ otherMarkets: 4, distinctIds: 3, top: [["ShotsonTarget2ndHalfTotal", 2], ["Faule. 1. połowa", 1], ["PlayerShotsOutsidetheBox", 1]] });
  });

  it("formatUnmappedSummary renders one greppable line", () => {
    expect(formatUnmappedSummary("betcris", { otherMarkets: 3, distinctIds: 2, top: [["ShotsonTarget2ndHalfTotal", 2], ["PlayerShotsOutsidetheBox", 1]] }))
      .toBe("[ScrapeHelpers] betcris: 2 unmapped market ids, 3 OTHER markets this run (top: ShotsonTarget2ndHalfTotal×2, PlayerShotsOutsidetheBox×1)");
  });

  it("normalizeAndSaveMatches logs exactly one summary line per call, over all of its matches", async () => {
    // Raw shapes copied from the Everton - Coventry City golden fixture
    // (__fixtures__/betcris/premier-league_everton_coventry-city.json).
    const matchResult = (): ScrapedMarket => ({
      name: "Wynik meczu",
      bookmakerMarketId: "P1XP2",
      groupName: "Wynik meczu",
      selections: [
        { name: "  W1", odds: 1.67 },
        { name: "Remis", odds: 4.1 },
        { name: "W2", odds: 5.5 },
      ],
    });
    const shotsOnTarget2ndHalf = (): ScrapedMarket => ({
      name: "2. połowa. Strzały celne. Suma",
      bookmakerMarketId: "ShotsonTarget2ndHalfTotal",
      groupName: "Inne",
      selections: [
        { name: "4+", odds: 1.29 },
        { name: "5+", odds: 1.62 },
      ],
    });
    const playerShotsOutsideBox = (): ScrapedMarket => ({
      name: "Zawodnik - strzały spoza pola karnego",
      bookmakerMarketId: "PlayerShotsOutsidetheBox",
      groupName: "Inne",
      selections: [
        { name: "Bobby Thomas 1+", odds: 4.1 },
        { name: "Gustavo Hamer 1+", odds: 1.29 },
      ],
    });
    const offer = (homeTeam: string, awayTeam: string, markets: ScrapedMarket[]): FullMatchOffer => ({
      matchId: `${homeTeam}-${awayTeam}`,
      bookmaker: "betcris",
      homeTeam,
      awayTeam,
      eventUrl: "https://www.betcris.pl/",
      markets,
      scrapedAt: new Date("2026-11-07T12:00:00Z"),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const summaryLines = () =>
      warn.mock.calls.map((args) => String(args[0])).filter((line) => line.startsWith("[ScrapeHelpers] betcris:"));

    const result = await normalizeAndSaveMatches(
      [
        offer("Everton", "Coventry City", [matchResult(), shotsOnTarget2ndHalf()]),
        offer("Leeds United", "Tottenham Hotspur", [shotsOnTarget2ndHalf(), playerShotsOutsideBox()]),
      ],
      "betcris",
      "premier-league",
      { useBatchInsert: true }
    );

    expect(result.matchesProcessed).toBe(2);
    expect(result.errors).toEqual([]);
    expect(summaryLines()).toEqual([
      "[ScrapeHelpers] betcris: 2 unmapped market ids, 3 OTHER markets this run (top: ShotsonTarget2ndHalfTotal×2, PlayerShotsOutsidetheBox×1)",
    ]);

    // A call whose markets all map stays silent.
    warn.mockClear();
    await normalizeAndSaveMatches([offer("Everton", "Coventry City", [matchResult()])], "betcris", "premier-league", {
      useBatchInsert: true,
    });
    expect(summaryLines()).toEqual([]);
  });
});
