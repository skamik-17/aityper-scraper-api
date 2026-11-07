import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseAllMarkets } from "../parser.js";
import type { SuperbetEvent, SuperbetOddsSelection } from "../types.js";

describe("parseAllMarkets - rich audit data", () => {
  // Minimal sample event with a known 1X2 market and an Over/Under market.
  const sampleEvent: SuperbetEvent = {
    eventId: 12345,
    matchName: "Lech Poznan · Legia Warszawa",
    tournamentId: 644,
    sportId: 5,
    odds: [
      { id: 1, marketId: 547, code: "1", name: "Lech Poznan", price: 2.1, status: "active" },
      { id: 2, marketId: 547, code: "0", name: "Remis", price: 3.4, status: "active" },
      { id: 3, marketId: 547, code: "2", name: "Legia Warszawa", price: 3.0, status: "active" },
      { id: 4, marketId: 200734, code: "O", name: "Powyzej", price: 1.85, specialBetValue: "2.5", status: "active" },
      { id: 5, marketId: 200734, code: "U", name: "Ponizej", price: 1.95, specialBetValue: "2.5", status: "active" },
    ],
  };

  it("produces a real (non-placeholder) market name and a non-empty bookmakerMarketId", () => {
    const markets = parseAllMarkets(sampleEvent);

    expect(markets.length).toBeGreaterThan(0);

    const matchResult = markets.find((m) => m.type === "1X2");
    expect(matchResult).toBeDefined();

    // Name must be the real human-readable label, not the "Rynek <id>" fallback.
    expect(matchResult!.name).toBe("Wynik meczu");
    expect(matchResult!.name).not.toMatch(/^Rynek \d+$/);

    // Stable market-type id must be carried for id-based audit matching.
    expect(matchResult!.bookmakerMarketId).toBe("547");
    expect(matchResult!.bookmakerMarketId).toBeTruthy();
  });

  it("carries bookmakerMarketId on every produced market", () => {
    const markets = parseAllMarkets(sampleEvent);

    for (const market of markets) {
      expect(market.bookmakerMarketId).toBeTruthy();
      expect(market.bookmakerMarketId).toMatch(/^\d+$/);
    }
  });
});

describe("parseAllMarkets - selection externalId", () => {
  // Real rows from Arsenal - Hull City (2026-11-06): today's API sends a
  // per-selection `uuid` and an `outcomeId`, and no numeric `id`. The third
  // row carries neither, to pin the "no identifier" case.
  const uuidEvent: SuperbetEvent = {
    eventId: 14438716,
    matchName: "Arsenal·Hull City",
    tournamentId: 0,
    sportId: 5,
    odds: [
      { uuid: "3b3179ac-c756-573c-8cd2-fdc0d5f5d00b", outcomeId: 1470, marketId: 547, code: "1", name: "1", price: 1.17, status: "active" },
      { uuid: "49ac60ac-1c1c-57e0-ae08-4b42023d1615", outcomeId: 1471, marketId: 547, code: "0", name: "X", price: 7.5, status: "active" },
      { marketId: 547, code: "2", name: "2", price: 14, status: "active" },
    ],
  };

  it("uses the selection uuid as externalId and leaves it undefined when absent", () => {
    const markets = parseAllMarkets(uuidEvent);

    expect(markets).toHaveLength(1);
    expect(markets[0].selections.map((s) => s.externalId)).toEqual([
      "3b3179ac-c756-573c-8cd2-fdc0d5f5d00b",
      "49ac60ac-1c1c-57e0-ae08-4b42023d1615",
      undefined,
    ]);
  });

  it("never emits the literal string 'undefined' as externalId", () => {
    const markets = parseAllMarkets(uuidEvent);

    for (const market of markets) {
      for (const selection of market.selections) {
        expect(selection.externalId).not.toBe("undefined");
      }
    }
  });

  it("still stringifies the legacy numeric id when no uuid is present", () => {
    const legacyEvent: SuperbetEvent = {
      eventId: 12345,
      matchName: "Lech Poznan · Legia Warszawa",
      tournamentId: 644,
      sportId: 5,
      odds: [{ id: 1, marketId: 547, code: "1", name: "Lech Poznan", price: 2.1 }],
    };

    const markets = parseAllMarkets(legacyEvent);

    expect(markets).toHaveLength(1);
    expect(markets[0].selections[0].externalId).toBe("1");
  });
});

describe("parseAllMarkets - per-player stat lines (sr:player specialBetValue)", () => {
  // Real rows in today's format: one row per player and line, each with its own
  // specialBetValue "sr:player:<id>-<Name>-<line>". The John Egan rows are
  // rawOddsPlayerShotsJohnEgan from Arsenal - Hull City (event 14438716,
  // evidence/superbet/exact-goals-1x2-raw-and-parsed-ars-hul-2026-11-06.json).
  // The others are from Leeds United - Tottenham (event 14438722,
  // evidence/superbet/player-stat-lines-raw-lee-tot-2026-11-07.json). Values are
  // verbatim; fields the parser does not read are dropped. The API sends no
  // `code` on these rows, hence the cast. "Kulusekvski" is Superbet's spelling.
  const SHOTS = "Zawodnik - liczba strzałów";
  const OFFSIDES = "Zawodnik - liczba spalonych";
  const HEADER_SOT = "Zawodnik - liczba celnych strzałów głową";
  const statLineEvent: SuperbetEvent = {
    eventId: 14438722,
    matchName: "Leeds United·Tottenham",
    tournamentId: 106,
    sportId: 5,
    odds: [
      // 236218
      { uuid: "9ef812bd-8172-5110-9eb7-fdc9f29c5dae", outcomeId: 12690, marketId: 236218, marketName: SHOTS, name: "John Egan - powyżej 0.5", price: 2.12, status: "active", specialBetValue: "sr:player:100578-John Egan-0.5" },
      { uuid: "f0d8832c-c4d9-5224-845e-d6f3985d272d", outcomeId: 12690, marketId: 236218, marketName: SHOTS, name: "John Egan - powyżej 1.5", price: 6, status: "active", specialBetValue: "sr:player:100578-John Egan-1.5" },
      { uuid: "f4ae1381-ad32-5fd2-86c8-24d3bf71631b", outcomeId: 12690, marketId: 236218, marketName: SHOTS, name: "John Egan - powyżej 2.5", price: 17, status: "active", specialBetValue: "sr:player:100578-John Egan-2.5" },
      { uuid: "bbfb873b-5c77-5589-81df-63a862f4af47", outcomeId: 12690, marketId: 236218, marketName: SHOTS, name: "Anton Stach - powyżej 0.5", price: 1.06, status: "active", specialBetValue: "sr:player:1021607-Anton Stach-0.5" },
      { uuid: "ee653c7a-5129-5648-9420-8190c76e7b0c", outcomeId: 12690, marketId: 236218, marketName: SHOTS, name: "Anton Stach - powyżej 1.5", price: 1.43, status: "active", specialBetValue: "sr:player:1021607-Anton Stach-1.5" },
      { uuid: "ee5d2eb5-a92c-50e8-9eb4-32a1e8148e39", outcomeId: 12690, marketId: 236218, marketName: SHOTS, name: "Anton Stach - powyżej 2.5", price: 2.27, status: "active", specialBetValue: "sr:player:1021607-Anton Stach-2.5" },
      { uuid: "035e01b8-9c92-5492-b88d-bbfa9bd9013b", outcomeId: 12690, marketId: 236218, marketName: SHOTS, name: "Anton Stach - powyżej 3.5", price: 4, status: "active", specialBetValue: "sr:player:1021607-Anton Stach-3.5" },
      { uuid: "3fc2c9f5-b9a3-568e-b49f-1ebc255995d0", outcomeId: 12690, marketId: 236218, marketName: SHOTS, name: "Anton Stach - powyżej 4.5", price: 6.9, status: "active", specialBetValue: "sr:player:1021607-Anton Stach-4.5" },
      { uuid: "8d172e6a-c159-542e-98d1-82e4986ff619", outcomeId: 12690, marketId: 236218, marketName: SHOTS, name: "Anton Stach - powyżej 5.5", price: 13, status: "active", specialBetValue: "sr:player:1021607-Anton Stach-5.5" },
      { uuid: "7f69febd-523c-5b5a-a16b-694c25388f53", outcomeId: 12690, marketId: 236218, marketName: SHOTS, name: "Anton Stach - powyżej 6.5", price: 27, status: "active", specialBetValue: "sr:player:1021607-Anton Stach-6.5" },
      { uuid: "95a872f8-5fe8-588c-897f-6d50db01a4f3", outcomeId: 12690, marketId: 236218, marketName: SHOTS, name: "Dejan Kulusekvski - powyżej 0.5", price: 1.07, status: "active", specialBetValue: "sr:player:1065654-Dejan Kulusekvski-0.5" },
      { uuid: "ab38034a-0f26-5617-a337-20e7761fcabe", outcomeId: 12690, marketId: 236218, marketName: SHOTS, name: "Dejan Kulusekvski - powyżej 1.5", price: 1.46, status: "active", specialBetValue: "sr:player:1065654-Dejan Kulusekvski-1.5" },
      { uuid: "4305993d-7e5b-5a33-8113-023d00d77949", outcomeId: 12690, marketId: 236218, marketName: SHOTS, name: "Dejan Kulusekvski - powyżej 2.5", price: 2.35, status: "active", specialBetValue: "sr:player:1065654-Dejan Kulusekvski-2.5" },
      { uuid: "c03a0f8d-f52a-5dcf-90eb-76a853992ec0", outcomeId: 12690, marketId: 236218, marketName: SHOTS, name: "Dejan Kulusekvski - powyżej 3.5", price: 4.1, status: "active", specialBetValue: "sr:player:1065654-Dejan Kulusekvski-3.5" },
      { uuid: "be05a479-c4d0-5bfa-80af-a784195c77d1", outcomeId: 12690, marketId: 236218, marketName: SHOTS, name: "Dejan Kulusekvski - powyżej 4.5", price: 7.1, status: "active", specialBetValue: "sr:player:1065654-Dejan Kulusekvski-4.5" },
      { uuid: "ac6e6619-0385-56a3-a0e7-21d3aa7c4368", outcomeId: 12690, marketId: 236218, marketName: SHOTS, name: "Dejan Kulusekvski - powyżej 5.5", price: 14, status: "active", specialBetValue: "sr:player:1065654-Dejan Kulusekvski-5.5" },
      { uuid: "c60ead7a-3f2c-5a16-a707-78b1c5c13914", outcomeId: 12690, marketId: 236218, marketName: SHOTS, name: "Dejan Kulusekvski - powyżej 6.5", price: 28, status: "active", specialBetValue: "sr:player:1065654-Dejan Kulusekvski-6.5" },
      // 236224
      { uuid: "6e61d12c-4b9f-5e7a-88f1-fbc684ea335c", outcomeId: 12702, marketId: 236224, marketName: OFFSIDES, name: "Dejan Kulusekvski - powyżej 0.5", price: 2.15, status: "active", specialBetValue: "sr:player:1065654-Dejan Kulusekvski-0.5" },
      { uuid: "8d041d14-51d0-58f0-90d5-12f44c056010", outcomeId: 12702, marketId: 236224, marketName: OFFSIDES, name: "Dejan Kulusekvski - powyżej 1.5", price: 6.5, status: "active", specialBetValue: "sr:player:1065654-Dejan Kulusekvski-1.5" },
      { uuid: "68bd83e1-7d02-5a8b-b04f-1f41935c3baf", outcomeId: 12702, marketId: 236224, marketName: OFFSIDES, name: "Dejan Kulusekvski - powyżej 2.5", price: 20, status: "active", specialBetValue: "sr:player:1065654-Dejan Kulusekvski-2.5" },
      { uuid: "ce7ed3fa-b9b6-5a5b-81a9-6d1eceeddf43", outcomeId: 12702, marketId: 236224, marketName: OFFSIDES, name: "Mohammed Kudus - powyżej 0.5", price: 1.92, status: "active", specialBetValue: "sr:player:1321798-Mohammed Kudus-0.5" },
      { uuid: "e38d00f8-40b4-5d4d-a1d1-7d8c2eab25b3", outcomeId: 12702, marketId: 236224, marketName: OFFSIDES, name: "Mohammed Kudus - powyżej 1.5", price: 5.45, status: "active", specialBetValue: "sr:player:1321798-Mohammed Kudus-1.5" },
      { uuid: "1a59f3f9-00e2-549c-b4f2-ee22bd112142", outcomeId: 12702, marketId: 236224, marketName: OFFSIDES, name: "Mohammed Kudus - powyżej 2.5", price: 17, status: "active", specialBetValue: "sr:player:1321798-Mohammed Kudus-2.5" },
      // 238465
      { uuid: "6f09b4bd-afc6-5dce-a3c5-d622ea228d47", outcomeId: 16206, marketId: 238465, marketName: HEADER_SOT, name: "Anton Stach - powyżej 0.5", price: 8.9, status: "active", specialBetValue: "sr:player:1021607-Anton Stach-0.5" },
      { uuid: "3bb06843-f49e-50c3-84b3-2508ca8ebbe1", outcomeId: 16206, marketId: 238465, marketName: HEADER_SOT, name: "Dejan Kulusekvski - powyżej 0.5", price: 7.1, status: "active", specialBetValue: "sr:player:1065654-Dejan Kulusekvski-0.5" },
      { uuid: "e856f845-806e-5fa1-96cf-01fd29a0d173", outcomeId: 16206, marketId: 238465, marketName: HEADER_SOT, name: "Jan-Paul van Hecke - powyżej 0.5", price: 5.6, status: "active", specialBetValue: "sr:player:1630352-Jan-Paul van Hecke-0.5" },
      { uuid: "186cd2e7-d4cb-500c-9bba-d7345c3a2b29", outcomeId: 16206, marketId: 238465, marketName: HEADER_SOT, name: "Jan-Paul van Hecke - powyżej 1.5", price: 35, status: "active", specialBetValue: "sr:player:1630352-Jan-Paul van Hecke-1.5" },
      { uuid: "2a2ee017-8150-52e8-a4e0-d467d0712c37", outcomeId: 16206, marketId: 238465, marketName: HEADER_SOT, name: "Dominic Calvert-Lewin - powyżej 0.5", price: 2.92, status: "active", specialBetValue: "sr:player:372344-Dominic Calvert-Lewin-0.5" },
      { uuid: "2adfd192-a9c1-59ee-92f1-2fb0a90b9c05", outcomeId: 16206, marketId: 238465, marketName: HEADER_SOT, name: "Dominic Calvert-Lewin - powyżej 1.5", price: 11, status: "active", specialBetValue: "sr:player:372344-Dominic Calvert-Lewin-1.5" },
      { uuid: "773a08fe-f21b-576e-9f47-e2675a1300c3", outcomeId: 16206, marketId: 238465, marketName: HEADER_SOT, name: "Dominic Calvert-Lewin - powyżej 2.5", price: 35, status: "active", specialBetValue: "sr:player:372344-Dominic Calvert-Lewin-2.5" },
    ] as SuperbetOddsSelection[],
  };

  // One entry per (bookmakerMarketId, player): the player's ladder in API order.
  const expectedLadders: Array<{
    id: string;
    marketName: string;
    player: string;
    ladder: Array<[line: string, price: number]>;
  }> = [
    { id: "236218", marketName: SHOTS, player: "John Egan", ladder: [["0.5", 2.12], ["1.5", 6], ["2.5", 17]] },
    {
      id: "236218",
      marketName: SHOTS,
      player: "Anton Stach",
      ladder: [["0.5", 1.06], ["1.5", 1.43], ["2.5", 2.27], ["3.5", 4], ["4.5", 6.9], ["5.5", 13], ["6.5", 27]],
    },
    {
      id: "236218",
      marketName: SHOTS,
      player: "Dejan Kulusekvski",
      ladder: [["0.5", 1.07], ["1.5", 1.46], ["2.5", 2.35], ["3.5", 4.1], ["4.5", 7.1], ["5.5", 14], ["6.5", 28]],
    },
    { id: "236224", marketName: OFFSIDES, player: "Dejan Kulusekvski", ladder: [["0.5", 2.15], ["1.5", 6.5], ["2.5", 20]] },
    { id: "236224", marketName: OFFSIDES, player: "Mohammed Kudus", ladder: [["0.5", 1.92], ["1.5", 5.45], ["2.5", 17]] },
    { id: "238465", marketName: HEADER_SOT, player: "Anton Stach", ladder: [["0.5", 8.9]] },
    { id: "238465", marketName: HEADER_SOT, player: "Dejan Kulusekvski", ladder: [["0.5", 7.1]] },
    { id: "238465", marketName: HEADER_SOT, player: "Jan-Paul van Hecke", ladder: [["0.5", 5.6], ["1.5", 35]] },
    {
      id: "238465",
      marketName: HEADER_SOT,
      player: "Dominic Calvert-Lewin",
      ladder: [["0.5", 2.92], ["1.5", 11], ["2.5", 35]],
    },
  ];

  it("emits exactly one raw market per player for each of 236218/236224/238465", () => {
    const markets = parseAllMarkets(statLineEvent);

    // A split ladder adds markets and a merged one removes them, so the counts
    // catch both directions.
    expect(markets).toHaveLength(expectedLadders.length);
    for (const id of ["236218", "236224", "238465"]) {
      expect(markets.filter((m) => m.bookmakerMarketId === id)).toHaveLength(
        expectedLadders.filter((e) => e.id === id).length
      );
    }
  });

  it.each(expectedLadders.map((e) => [`${e.id} ${e.player}`, e] as const))(
    "%s: the whole ladder is one market, in order",
    (_label, { id, marketName, player, ladder }) => {
      const markets = parseAllMarkets(statLineEvent).filter(
        (m) => m.bookmakerMarketId === id && m.selections.some((s) => s.name.startsWith(`${player} - `))
      );

      expect(markets).toHaveLength(1);
      expect(markets[0].name).toBe(marketName);
      // Exact equality also proves no other player's rows are mixed in.
      expect(markets[0].selections.map((s) => [s.name, s.odds])).toEqual(
        ladder.map(([line, price]) => [`${player} - powyżej ${line}`, price])
      );
    }
  );
});

describe("parseAllMarkets - player fouls/tackles/assists stat lines", () => {
  // Verbatim API rows from Arsenal - Hull City (event 14438716, 2026-11-06,
  // evidence/superbet/event-odds-sample-arsenal-hull-2026-11-06.json). The
  // rows carry no `code`, hence the cast.
  const sample = JSON.parse(
    readFileSync(fileURLToPath(new URL("./fixtures/event-14438716-odds-sample.json", import.meta.url)), "utf8")
  ) as { oddsSample: SuperbetOddsSelection[] };
  const sampleEvent: SuperbetEvent = {
    eventId: 14438716,
    matchName: "Arsenal·Hull City",
    tournamentId: 0,
    sportId: 5,
    odds: sample.oddsSample,
  };

  it("player stat lines group one raw market per player", () => {
    const markets = parseAllMarkets(sampleEvent);

    const counts: Record<string, number> = {};
    for (const market of markets) {
      counts[market.bookmakerMarketId!] = (counts[market.bookmakerMarketId!] ?? 0) + 1;
    }
    // 238453 has no catalog code (OTHER), so it keeps one market per line;
    // 200685 is a team corners market grouped by its threshold.
    expect(counts).toEqual({ "236216": 2, "236222": 2, "239621": 2, "238453": 5, "200685": 6 });

    // Each grouped market is one player's whole ladder, never two players.
    for (const market of markets.filter((m) => ["236216", "236222", "239621"].includes(m.bookmakerMarketId!))) {
      const players = new Set(market.selections.map((s) => s.name.replace(/\s*-\s*powyżej\s+[\d.]+$/u, "")));
      expect(players.size, `${market.bookmakerMarketId} ${[...players].join(", ")}`).toBe(1);
    }
  });
});
