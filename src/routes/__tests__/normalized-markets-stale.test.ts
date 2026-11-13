import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getFullOfferByMatch: vi.fn() }));
vi.mock("../../repositories/full-offer-repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../repositories/full-offer-repository.js")>()),
  getFullOfferByMatch: m.getFullOfferByMatch,
}));

import normalizedMarketsRouter from "../normalized-markets.js";
import { errorHandler } from "../../middleware/error-handler.js";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express().use("/api/matches", normalizedMarketsRouter).use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.close();
  await once(server, "close");
});

const sel = (odds: number) => [{ name: "1", normalizedName: "HOME", odds }];

beforeEach(() => {
  m.getFullOfferByMatch.mockResolvedValue({
    matchId: "premier-league:arsenal:hull city",
    homeTeam: "Arsenal",
    awayTeam: "Hull City",
    leagueSlug: "premier-league",
    markets: {
      MATCH_WINNER: {
        type: "MATCH_WINNER",
        category: "WYNIK_MECZU",
        name: "1X2",
        bookmakerOdds: {
          betclic: { selections: sel(2.4), scrapedAt: "2026-11-06T16:15:00+00:00" },
          sts: { selections: sel(2.5), scrapedAt: "2026-11-06T11:00:00+00:00", stale: true },
        },
        bestOdds: { HOME: { bookmaker: "sts", odds: 2.5 } },
      },
    },
  });
});

describe("normalized-markets: stale bookmakers", () => {
  it("lists stale bookmakers in stats, sorted", async () => {
    const res = await fetch(`${base}/api/matches/Arsenal/Hull%20City/normalized-markets?league=premier-league`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.stats.staleBookmakers).toEqual(["sts"]);
  });

  it("no stale quote gives an empty list", async () => {
    const offer = await m.getFullOfferByMatch();
    delete offer.markets.MATCH_WINNER.bookmakerOdds.sts.stale;
    m.getFullOfferByMatch.mockResolvedValue(offer);
    const body = await (await fetch(`${base}/api/matches/Arsenal/Hull%20City/normalized-markets?league=premier-league`)).json();
    expect(body.data.stats.staleBookmakers).toEqual([]);
  });
});
