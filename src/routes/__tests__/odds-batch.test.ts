import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PolishBookmaker } from "../../config/index.js";
import type { BookmakerStatus } from "../../types/database.js";
import type { BookmakerHealthMeta } from "../../services/bookmaker-status.js";

const m = vi.hoisted(() => ({ getAllLatestOdds: vi.fn(), outside: new Set<string>() }));
vi.mock("../../services/league-window.js", async () => ({
  isLeagueScheduled: (league: string) => !m.outside.has(league),
}));

// The real config, with a second enabled league so the merge has something to merge.
vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  return { ...actual, CONFIG: { ...actual.CONFIG, ENABLED_LEAGUES: ["premier-league", "la-liga"] } };
});
vi.mock("../../services/odds-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/odds-service.js")>()),
  getAllLatestOdds: m.getAllLatestOdds,
}));

import oddsRouter from "../odds.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { CONFIG } from "../../config/index.js";

/** 14-key status map, "available" unless overridden. */
function st(overrides: Partial<Record<PolishBookmaker, BookmakerStatus>> = {}): Record<PolishBookmaker, BookmakerStatus> {
  return Object.fromEntries(CONFIG.BOOKMAKERS.map((bm) => [bm, overrides[bm] ?? "available"])) as Record<PolishBookmaker, BookmakerStatus>;
}

/** The bookmakerHealth that matches a status map; lastSuccessAt tells the leagues apart. */
function hl(status: Record<PolishBookmaker, BookmakerStatus>, lastSuccessAt: string): Record<PolishBookmaker, BookmakerHealthMeta> {
  return Object.fromEntries(
    Object.entries(status).map(([bm, s]) => [
      bm,
      { status: s, lastSuccessAt, failingSince: s === "error" ? lastSuccessAt : null, consecutiveFailures: s === "error" ? 1 : 0 },
    ]),
  ) as Record<PolishBookmaker, BookmakerHealthMeta>;
}

const LEAGUES: Record<string, { status: Record<PolishBookmaker, BookmakerStatus>; lastUpdated: string | null; at: string }> = {
  "premier-league": { status: st({ betcris: "stale" }), lastUpdated: "2026-11-06T16:02:49.798Z", at: "2026-11-06T16:02:49.798Z" },
  "la-liga": { status: st({ betcris: "error" }), lastUpdated: "2026-11-06T15:02:49.000Z", at: "2026-11-06T15:02:49.000Z" },
  ekstraklasa: { status: st({ fortuna: "error" }), lastUpdated: null, at: "2026-11-06T14:00:00.000Z" }, // not enabled
};

async function leagueOdds(league: string) {
  const l = LEAGUES[league];
  if (!l) throw new Error(`no odds for ${league}`);
  return { matches: [], lastUpdated: l.lastUpdated, bookmakerStatus: l.status, bookmakerHealth: hl(l.status, l.at) };
}

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express().use(express.json()).use("/api/odds", oddsRouter).use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
});

beforeEach(() => {
  m.getAllLatestOdds.mockReset().mockImplementation(leagueOdds);
  m.outside.clear();
});

const post = (leagues: string[]) =>
  fetch(`${base}/api/odds/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leagues }),
  }).then((r) => r.json());

describe("POST /api/odds/batch meta", () => {
  it("an enabled league outside its fixture window does not merge (nothing scrapes it between windows)", async () => {
    m.outside.add("la-liga");
    const { meta } = await post(["premier-league", "la-liga"]);
    expect(meta.bookmakerStatus.betcris).toBe("stale");
    expect(meta.bookmakerHealth.betcris.lastSuccessAt).toBe("2026-11-06T16:02:49.798Z");
  });

  it("worst status wins across enabled leagues, as plain strings (today the first league wins)", async () => {
    const { meta } = await post(["premier-league", "la-liga", "ekstraklasa"]);
    expect(meta.bookmakerStatus.betcris).toBe("error");
    expect(meta.bookmakerStatus.fortuna).toBe("available"); // ekstraklasa is not enabled -> not merged
    expect(Object.values(meta.bookmakerStatus).every((v) => typeof v === "string")).toBe(true);
    expect(Object.keys(meta.bookmakerHealth)).toHaveLength(14);
    expect(meta.bookmakerHealth.betcris.status).toBe("error");
    expect(meta.lastUpdated).toBe("2026-11-06T16:02:49.798Z");
  });

  it("falls back to all requested leagues when none is enabled", async () =>
    expect((await post(["ekstraklasa"])).meta.bookmakerStatus.fortuna).toBe("error"));

  it("bookmakerHealth comes from the league whose status won; a tie keeps the first league", async () => {
    const { meta } = await post(["premier-league", "la-liga"]);
    expect(meta.bookmakerHealth.betcris).toEqual({
      status: "error",
      lastSuccessAt: "2026-11-06T15:02:49.000Z",
      failingSince: "2026-11-06T15:02:49.000Z",
      consecutiveFailures: 1,
    });
    expect(meta.bookmakerHealth.sts.lastSuccessAt).toBe("2026-11-06T16:02:49.798Z");
  });

  it("a league whose fetch threw contributes nothing to the status maps, and says why in the log", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      m.getAllLatestOdds.mockImplementation(async (league: string) => {
        if (league === "la-liga") throw new Error("statement timeout");
        return leagueOdds(league);
      });
      const { meta } = await post(["premier-league", "la-liga"]);
      expect(meta.bookmakerStatus.betcris).toBe("stale");
      expect(meta.bookmakerHealth.betcris.status).toBe("stale");
      expect(Object.keys(meta.bookmakerStatus)).toHaveLength(14);
      expect(meta.lastUpdated).toBe("2026-11-06T16:02:49.798Z");
      expect(errorSpy.mock.calls).toEqual([["[Odds/batch] la-liga failed: statement timeout"]]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("lastUpdated is the newest per-league value over all requested leagues", async () => {
    LEAGUES.ekstraklasa.lastUpdated = "2026-11-06T17:00:00.000Z";
    try {
      expect((await post(["premier-league", "ekstraklasa"])).meta.lastUpdated).toBe("2026-11-06T17:00:00.000Z");
    } finally {
      LEAGUES.ekstraklasa.lastUpdated = null;
    }
  });
});
