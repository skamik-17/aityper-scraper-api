import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getAggregatedOdds: vi.fn(), getMatchOdds: vi.fn(), getBookmakerStatusSnapshot: vi.fn() }));
vi.mock("../../repositories/odds-repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../repositories/odds-repository.js")>()),
  getAggregatedOdds: m.getAggregatedOdds,
  getMatchOdds: m.getMatchOdds,
}));
vi.mock("../bookmaker-status.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bookmaker-status.js")>()),
  getBookmakerStatusSnapshot: m.getBookmakerStatusSnapshot,
}));

import { getAllLatestOdds, getOddsForMatch } from "../odds-service.js";

const NOW = new Date("2026-11-06T16:16:18.614Z");
const STS_AT = "2026-11-06T11:00:00+00:00"; // 5 h old
const BETCLIC_AT = "2026-11-06T16:15:00+00:00";
const sel = (odds: number) => [{ name: "1", normalizedName: "HOME", odds }];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  m.getBookmakerStatusSnapshot.mockResolvedValue({ status: {}, health: {}, lastSuccessfulRunAt: null });
  m.getAggregatedOdds.mockResolvedValue([
    {
      match_id: "premier-league:arsenal:hull city",
      home_team: "Arsenal",
      away_team: "Hull City",
      start_time: "2026-11-08T15:00:00+00:00",
      last_updated: BETCLIC_AT,
      markets: {
        MATCH_WINNER: {
          code: "MATCH_WINNER",
          namePl: "1X2",
          viewType: "THREE_WAY",
          category: "WYNIK_MECZU",
          paramValue: null,
          bookmakerOdds: {
            sts: { selections: sel(2.5), eventUrl: "https://sts.test/1", scrapedAt: STS_AT },
            betclic: { selections: sel(2.4), eventUrl: "https://betclic.test/1", scrapedAt: BETCLIC_AT },
          },
        },
      },
    },
  ]);
  const row = (bookmaker: string, odds: number, scraped_at: string) => ({
    match_id: "premier-league:arsenal:hull city",
    league_slug: "premier-league",
    home_team: "Arsenal",
    away_team: "Hull City",
    bookmaker,
    event_url: null,
    market_key: "MATCH_WINNER",
    market_code: "MATCH_WINNER",
    market_name_pl: "1X2",
    view_type: "THREE_WAY",
    category: "WYNIK_MECZU",
    param_value: null,
    selections: sel(odds),
    scraped_at,
  });
  m.getMatchOdds.mockResolvedValue([row("sts", 2.5, STS_AT), row("betclic", 2.4, BETCLIC_AT)]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const listMarket = async () => (await getAllLatestOdds("premier-league")).matches[0].markets.MATCH_WINNER;
const matchMarket = async () => (await getOddsForMatch("Arsenal", "Hull City", "premier-league"))!.markets.MATCH_WINNER;

describe("stale quotes (owner B12: visible only)", () => {
  it.each([["getAllLatestOdds", listMarket], ["getOddsForMatch", matchMarket]] as const)(
    "%s flags the stale quote and keeps it in bestOdds",
    async (_name, read) => {
      const mw = await read();
      expect(mw.bookmakerOdds.sts.stale).toBe(true);
      expect("stale" in mw.bookmakerOdds.betclic).toBe(false);
      expect(mw.bestOdds.HOME).toEqual({ bookmaker: "sts", odds: 2.5 });
    },
  );

  it.each([["getAllLatestOdds", listMarket], ["getOddsForMatch", matchMarket]] as const)(
    "%s: the exclusion exists only behind EXCLUDE_STALE_FROM_BEST_ODDS=true (off by default, B12)",
    async (_name, read) => {
      vi.stubEnv("EXCLUDE_STALE_FROM_BEST_ODDS", "true");
      const mw = await read();
      expect(mw.bestOdds.HOME).toEqual({ bookmaker: "betclic", odds: 2.4 });
      expect(mw.bookmakerOdds.sts.stale).toBe(true);
    },
  );
});
