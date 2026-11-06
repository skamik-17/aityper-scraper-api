// Regression tests for the 2026-11 forbet recovery (scraper health check
// 2026-11-06). Inputs are real forbet /rest/market/events/{id} payloads
// captured 2026-11-06, trimmed to the games these tests need:
//   fixtures/forbet-event-57945881-everton-coventry.trimmed.json
//   fixtures/forbet-event-57945911-arsenal-hull.trimmed.json
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { forbetNormalizer } from "../forbet-normalizer.js";
import { parseAllMarkets } from "../../../../scrapers/bookmakers/forbet/parser.js";
import type { ForbetEvent } from "../../../../scrapers/bookmakers/forbet/types.js";
import type {
  NormalizationContext,
  NormalizedMarketOutput,
  RawBookmakerMarket,
} from "../../types.js";

const ctxEC: NormalizationContext = {
  homeTeam: "Everton",
  awayTeam: "Coventry City",
  league: "premier-league",
};
const ctxAH: NormalizationContext = {
  homeTeam: "Arsenal",
  awayTeam: "Hull City",
  league: "premier-league",
};

/**
 * Runs a captured forbet event through the real parser and normalizer, the
 * same way the full-offer pipeline does, and returns every non-null output.
 */
function normalizeCapture(file: string, ctx: NormalizationContext): NormalizedMarketOutput[] {
  const path = fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url));
  const event = JSON.parse(readFileSync(path, "utf8")) as ForbetEvent;
  const outputs: NormalizedMarketOutput[] = [];
  for (const market of parseAllMarkets(event)) {
    const raw: RawBookmakerMarket = {
      bookmakerMarketId: market.bookmakerMarketId,
      name: market.name,
      groupName: market.groupName,
      paramValue: market.paramValue,
      selections: market.selections.map((sel) => ({ name: sel.name, odds: sel.odds })),
    };
    const out = forbetNormalizer.normalizeMarket(raw, ctx);
    if (out) outputs.push(out);
  }
  return outputs;
}

describe("forbet recovery 2026-11", () => {
  it("forbet TurboPrzewaga (-31170) maps to the 2-way WIN_OR_WIN_BY_2, not EUROPEAN_HANDICAP", () => {
    const out = forbetNormalizer.normalizeMarket({
      bookmakerMarketId: "-31170",
      name: "TurboPrzewaga - 2 gole przewagi lub wygrana",
      selections: [{ name: "Everton", odds: 1.63 }, { name: "remis", odds: 3.9 }, { name: "Coventry", odds: 4.5 }],
    }, ctxEC)!;
    expect(out.marketCode).toBe("WIN_OR_WIN_BY_2");
    expect(out.marketKey).toBe("WIN_OR_WIN_BY_2");
    expect(out.paramValue).toBeUndefined();
    expect(out.selections.map((s) => [s.code, s.odds])).toEqual([["HOME", 1.63], ["AWAY", 4.5]]);
  });

  it("forbet TurboPrzewaga is dropped when its team legs do not resolve to exactly one HOME and one AWAY", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Unresolvable team names: publishing them would mean guessing the side.
      expect(forbetNormalizer.normalizeMarket({
        bookmakerMarketId: "-31170",
        name: "TurboPrzewaga - 2 gole przewagi lub wygrana",
        selections: [{ name: "Liverpool", odds: 1.63 }, { name: "remis", odds: 3.9 }, { name: "Chelsea", odds: 4.5 }],
      }, ctxEC)).toBeNull();
      // Both legs on one side: merging them would fabricate a price.
      expect(forbetNormalizer.normalizeMarket({
        bookmakerMarketId: "-31170",
        name: "TurboPrzewaga - 2 gole przewagi lub wygrana",
        selections: [{ name: "Everton", odds: 1.63 }, { name: "remis", odds: 3.9 }, { name: "Everton", odds: 4.5 }],
      }, ctxEC)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[0][0])).toContain("WIN_OR_WIN_BY_2");
    } finally {
      warn.mockRestore();
    }
  });

  it("forbet Handicap 2:0 (-6048) stays on EUROPEAN_HANDICAP:+2", () => {
    const out = forbetNormalizer.normalizeMarket({
      bookmakerMarketId: "-6048", name: "Handicap 2:0",
      selections: [{ name: "Everton (2:0)", odds: 1.03 }, { name: "X (2:0)", odds: 11 }, { name: "Coventry (2:0)", odds: 30 }],
    }, ctxEC)!;
    expect(out.marketKey).toBe("EUROPEAN_HANDICAP:+2");
    expect(out.selections.map((s) => [s.code, s.odds])).toEqual([["HOME", 1.03], ["DRAW", 11], ["AWAY", 30]]);
  });

  it("forbet no-score-line EUROPEAN_HANDICAP gets no paramValue", () => {
    const out = forbetNormalizer.normalizeMarket({
      bookmakerMarketId: "-6048", name: "Handicap specjalny 2 gole",
      selections: [{ name: "Everton", odds: 1.63 }, { name: "remis", odds: 3.9 }, { name: "Coventry", odds: 4.5 }],
    }, ctxEC)!;
    expect(out.marketCode).toBe("EUROPEAN_HANDICAP");
    expect(out.paramValue).toBeUndefined();
    expect(out.marketKey).toBe("EUROPEAN_HANDICAP");
  });

  it("forbet Everton v Coventry capture: exactly one EUROPEAN_HANDICAP:+2, priced from Handicap 2:0", () => {
    const outs = normalizeCapture("forbet-event-57945881-everton-coventry.trimmed.json", ctxEC);
    const plus2 = outs.filter((o) => o.marketKey === "EUROPEAN_HANDICAP:+2");
    expect(plus2).toHaveLength(1);
    expect(plus2[0].selections.find((s) => s.code === "HOME")?.odds).toBe(1.03);
    expect(outs.filter((o) => o.marketCode === "WIN_OR_WIN_BY_2")).toHaveLength(1);
  });

  it("forbet Arsenal v Hull capture: no EUROPEAN_HANDICAP:+2, TurboPrzewaga 1.16/14 on WIN_OR_WIN_BY_2", () => {
    const outs = normalizeCapture("forbet-event-57945911-arsenal-hull.trimmed.json", ctxAH);
    expect(outs.filter((o) => o.marketKey === "EUROPEAN_HANDICAP:+2")).toHaveLength(0);
    const turbo = outs.find((o) => o.marketCode === "WIN_OR_WIN_BY_2")!;
    expect(turbo.selections.map((s) => [s.code, s.odds])).toEqual([["HOME", 1.16], ["AWAY", 14]]);
  });

  it("forbet Everton v Coventry alternative bets map like etoto (RESULT_OR_BTTS / TEAM_WIN_OR_CLEAN_SHEET / DRAW_OR_CLEAN_SHEET)", () => {
    const outs = normalizeCapture("forbet-event-57945881-everton-coventry.trimmed.json", ctxEC);
    const rob = outs.filter((o) => o.marketKey === "RESULT_OR_BTTS").flatMap((o) => o.selections.map((s) => [s.code, s.odds]));
    expect(rob).toEqual([["HOME_OR_BTTS_YES", 1.13], ["HOME_OR_BTTS_NO", 4.7], ["AWAY_OR_BTTS_YES", 1.5], ["AWAY_OR_BTTS_NO", 2.31], ["DRAW_OR_BTTS_YES", 1.57], ["DRAW_OR_BTTS_NO", 2.16]]);
    const cs = Object.fromEntries(outs.filter((o) => /CLEAN_SHEET/.test(o.marketCode)).map((o) => [o.marketKey, o.selections.map((s) => [s.code, s.odds])]));
    expect(cs).toEqual({
      "TEAM_WIN_OR_CLEAN_SHEET:HOME": [["YES", 1.28], ["NO", 3.15]],
      "TEAM_WIN_OR_CLEAN_SHEET:AWAY": [["YES", 1.62], ["NO", 2.08]],
      "DRAW_OR_CLEAN_SHEET": [["YES", 1.44], ["NO", 2.47]],
    });
    // Unresolved side: both teams would collapse onto the bare key
    expect(outs.filter((o) => o.marketKey === "TEAM_WIN_OR_CLEAN_SHEET")).toHaveLength(0);
    expect(outs.filter((o) => o.marketCode === "OTHER" && /^Wydarzy się/.test(o.debug?.rawName ?? ""))).toHaveLength(0);
  });

  it("forbet Arsenal v Hull alternative bets resolve 'Arsenal FC' / 'Hull City' to HOME / AWAY", () => {
    const outs = normalizeCapture("forbet-event-57945911-arsenal-hull.trimmed.json", ctxAH);
    const rob = outs.filter((o) => o.marketKey === "RESULT_OR_BTTS").flatMap((o) => o.selections.map((s) => [s.code, s.odds]));
    expect(rob).toEqual([["HOME_OR_BTTS_YES", 1.04], ["HOME_OR_BTTS_NO", 7.4], ["AWAY_OR_BTTS_YES", 2.15], ["AWAY_OR_BTTS_NO", 1.57], ["DRAW_OR_BTTS_YES", 2.1], ["DRAW_OR_BTTS_NO", 1.6]]);
    const cs = Object.fromEntries(outs.filter((o) => /CLEAN_SHEET/.test(o.marketCode)).map((o) => [o.marketKey, o.selections.map((s) => [s.code, s.odds])]));
    expect(cs).toEqual({
      "TEAM_WIN_OR_CLEAN_SHEET:HOME": [["YES", 1.07], ["NO", 6.2]],
      "TEAM_WIN_OR_CLEAN_SHEET:AWAY": [["YES", 1.45], ["NO", 2.43]],
      "DRAW_OR_CLEAN_SHEET": [["YES", 1.35], ["NO", 2.8]],
    });
  });

  it("forbet RESULT_OR_BTTS is dropped when the result side or the tak/nie leg does not resolve", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Unresolvable team: tak and nie would merge into one side-less UNKNOWN row.
      expect(forbetNormalizer.normalizeMarket({
        bookmakerMarketId: "-8041",
        name: "Wydarzy się min. jedno z: Liverpool wygra lub obie drużyny strzelą gola",
        selections: [{ name: "tak", odds: 1.13 }, { name: "nie", odds: 4.7 }],
      }, ctxEC)).toBeNull();
      // Resolved side, unrecognised selection label.
      expect(forbetNormalizer.normalizeMarket({
        bookmakerMarketId: "-8041",
        name: "Wydarzy się min. jedno z: Everton wygra lub obie drużyny strzelą gola",
        selections: [{ name: "tak", odds: 1.13 }, { name: "może", odds: 4.7 }],
      }, ctxEC)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[0][0])).toContain("RESULT_OR_BTTS");
    } finally {
      warn.mockRestore();
    }
  });

  it("forbet TEAM_WIN_OR_CLEAN_SHEET is dropped when the team side does not resolve", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Without a side the price would land on the bare key, where the two
      // teams collide and one of them is dropped.
      expect(forbetNormalizer.normalizeMarket({
        bookmakerMarketId: "-8044",
        name: "Wydarzy się min. jedno z: Liverpool wygra lub którakolwiek drużyna zachowa czyste konto",
        selections: [{ name: "tak", odds: 1.28 }, { name: "nie", odds: 3.15 }],
      }, ctxEC)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("TEAM_WIN_OR_CLEAN_SHEET");
    } finally {
      warn.mockRestore();
    }
  });
});
