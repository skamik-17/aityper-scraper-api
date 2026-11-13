import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  parseAllMarkets,
  getMarketName,
  parse1X2Odds,
  parseDoubleChance,
  parseBTTS,
  parseOverUnder,
  hasValid1X2Odds,
  parseTeamNames,
} from "../parser.js";
import { MARKET_TYPES } from "../constants.js";
import { decodeFrame, initialStatesOf, SingleEventAccumulator } from "../ws-protocol.js";
import type { PZBukEvent, PZBukInitialState } from "../types.js";

describe("pzbuk parseAllMarkets - rich names and stable ids", () => {
  it("uses the real API market name and carries bookmakerMarketId", () => {
    const data: PZBukInitialState = {
      events: [],
      markets: [
        {
          id: "mkt-1",
          // Real human-readable name provided by the PZBuk API
          name: "Wynik meczu (1X2)",
          eventId: "evt-1",
          isSuspended: false,
          marketType: { id: MARKET_TYPES.MATCH_RESULT, name: "Match Result" },
        },
      ],
      selections: [
        {
          id: "sel-h",
          name: "Real Madryt",
          trueOdds: 1.8,
          marketId: "mkt-1",
          marketTypeId: MARKET_TYPES.MATCH_RESULT,
          eventId: "evt-1",
          outcomeType: "Home",
          status: "Active",
          order: 0,
        },
        {
          id: "sel-d",
          name: "Remis",
          trueOdds: 3.5,
          marketId: "mkt-1",
          marketTypeId: MARKET_TYPES.MATCH_RESULT,
          eventId: "evt-1",
          outcomeType: "Tie",
          status: "Active",
          order: 1,
        },
      ],
    };

    const markets = parseAllMarkets(data, "evt-1");

    expect(markets).toHaveLength(1);
    const market = markets[0];

    // Real (non-placeholder) name from the API is surfaced
    expect(market.name).toBe("Wynik meczu (1X2)");
    expect(market.name).not.toMatch(/^Rynek /);

    // Stable market-type id is carried for audit matching
    expect(market.bookmakerMarketId).toBe(MARKET_TYPES.MATCH_RESULT);
    expect(market.bookmakerMarketId).toBeTruthy();
  });

  it("falls back to the hard-coded label when the API name is blank", () => {
    const data: PZBukInitialState = {
      events: [],
      markets: [
        {
          id: "mkt-2",
          name: "",
          eventId: "evt-1",
          isSuspended: false,
          marketType: { id: MARKET_TYPES.MATCH_RESULT, name: "" },
        },
      ],
      selections: [
        {
          id: "sel-h",
          name: "Real Madryt",
          trueOdds: 1.8,
          marketId: "mkt-2",
          marketTypeId: MARKET_TYPES.MATCH_RESULT,
          eventId: "evt-1",
          outcomeType: "Home",
          status: "Active",
          order: 0,
        },
      ],
    };

    const markets = parseAllMarkets(data, "evt-1");

    expect(markets).toHaveLength(1);
    // Hard-coded fallback label, still carrying the stable id
    expect(markets[0].name).toBe("Wynik meczu");
    expect(markets[0].bookmakerMarketId).toBe(MARKET_TYPES.MATCH_RESULT);
  });

  it("getMarketName prefers the API name over the switch fallback", () => {
    expect(
      getMarketName(MARKET_TYPES.MATCH_RESULT, undefined, "Custom API Name")
    ).toBe("Custom API Name");
    // Blank api name -> switch label
    expect(getMarketName(MARKET_TYPES.MATCH_RESULT, undefined, "  ")).toBe(
      "Wynik meczu"
    );
    // Unknown type without api name -> placeholder
    expect(getMarketName("99999")).toBe("Rynek 99999");
  });
});

// Captured sportsbook-api/ws frames (Task 1 fixtures). `sels` is the single-event
// union of every market-group stream, built exactly as the Task 2 accumulator test does.
const load = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const league = load("ws-league-frames.json");
const event = load("ws-event-frames.json");
const states = (frames: any[]) => frames.filter((f) => f.dir === "recv").flatMap((f) => {
  const d = decodeFrame(f.text);
  return d.kind === "data" ? initialStatesOf(d) : [];
});
const acc = new SingleEventAccumulator();
states(event.frames).forEach((s) => acc.add(s));
const sels = acc.snapshot()!.selections;

describe("pzbuk legacy helpers on numeric wire ids", () => {
  it("parse1X2Odds reads id 1", () => expect(parse1X2Odds(sels)).toEqual({ home: 1.66, draw: 3.92, away: 4.91 }));
  it("parseDoubleChance reads id 10 by selection name", () =>
    expect(parseDoubleChance(sels)).toEqual({ homeOrDraw: 1.19, drawOrAway: 2.13, homeOrAway: 1.26 }));
  it("parseBTTS reads id 27", () => expect(parseBTTS(sels)).toEqual({ yes: 1.76, no: 1.92 }));
  it("parseOverUnder reads id 17 lines", () => {
    const ou = parseOverUnder(sels)!;
    expect(Object.keys(ou).sort()).toEqual(["0.5", "1.5", "2.5", "3.5", "4.5", "5.5"]);
    expect(ou["2.5"]).toEqual({ over: 1.77, under: 1.98 });
  });
  it("hasValid1X2Odds accepts the league snapshot event", () => {
    const [listing] = initialStatesOf(decodeFrame(league.frames[2].text));
    const ls = listing.selections.filter((s) => s.eventId === (4408475 as unknown as string));
    expect(hasValid1X2Odds(ls)).toBe(true);
  });
});

describe("pzbuk id labels", () => {
  it("labels blank-named id 126 as Kartki 1x2", () => {
    const data: PZBukInitialState = {
      events: [],
      markets: [{ id: "m", name: "", eventId: "e", isSuspended: false, marketType: { id: "126", name: "" } }],
      selections: [
        {
          id: "s",
          name: "Everton FC",
          trueOdds: 2,
          marketId: "m",
          marketTypeId: "126",
          eventId: "e",
          outcomeType: "",
          status: "Active",
          order: 0,
        },
      ],
    };
    const markets = parseAllMarkets(data, "e");
    expect(markets).toHaveLength(1);
    expect(markets[0].name).toBe("Kartki 1x2");
  });
});

describe("pzbuk parseTeamNames: event-name fallback", () => {
  const event = (eventName: string) => ({ eventName, primaryParticipants: {} }) as unknown as PZBukEvent;
  it.each([
    ["Paris Saint-Germain - Olympique Lyon", "Paris Saint-Germain", "Olympique Lyon"],
    ["Aston Villa – Chelsea FC", "Aston Villa", "Chelsea FC"],
    ["Leeds United vs. Tottenham Hotspur", "Leeds United", "Tottenham Hotspur"],
  ])("splits %j only at a spaced separator", (name, homeTeam, awayTeam) => {
    expect(parseTeamNames(event(name))).toEqual({ homeTeam, awayTeam });
  });
  it.each(["Leeds United", "Leeds United -", "", "Nottingham Forest.Everton"])("never invents a name from %j", (name) => {
    expect(parseTeamNames(event(name))).toEqual({ homeTeam: "", awayTeam: "" });
  });
});
