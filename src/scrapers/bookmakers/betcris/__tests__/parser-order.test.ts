/**
 * parseAllMarkets must not depend on the key order of the Swarm maps. Event ids
 * (~7.4e9) and soon market ids (~2.54e9, near 2^32 - 1) are not array-index
 * keys, so JS keeps the server's insertion order, which differs between runs.
 */
import { describe, expect, it } from "vitest";
import { findGameInSwarmData } from "../swarm-offer.js";
import { parseAllMarkets } from "../parser.js";
import type { SwarmEvent, SwarmGame, SwarmMarket } from "../types.js";
import { recordedGame, SWARM_RECORDED_GAME_ID } from "./helpers/swarm-fixtures.js";

/** Past the array-index range, so a re-keyed market map keeps insertion order like the event maps do */
const MARKET_ID_OFFSET = 5_000_000_000;

/** Deterministic Fisher-Yates driven by a small LCG */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function recordedSwarmGame(): SwarmGame {
  const game = findGameInSwarmData(recordedGame(SWARM_RECORDED_GAME_ID), SWARM_RECORDED_GAME_ID);
  if (!game) throw new Error("recorded game missing");
  return game;
}

/** The game with market ids moved past 2^32 - 1, markets and events inserted in the order `order` gives */
function rekeyed(game: SwarmGame, order: <T>(items: readonly T[]) => T[]): SwarmGame {
  const market: Record<string, SwarmMarket> = {};
  for (const m of order(Object.values(game.market ?? {}))) {
    const id = m.id + MARKET_ID_OFFSET;
    const event: Record<string, SwarmEvent> = {};
    for (const e of order(Object.values(m.event ?? {}))) event[String(e.id)] = e;
    market[String(id)] = { ...m, id, event };
  }
  return { ...game, market };
}

describe("betcris parseAllMarkets: key-order independence", () => {
  it("betcris parser: shuffled event and market key order gives byte-identical output on the recorded game", () => {
    const game = recordedSwarmGame();
    const reference = JSON.stringify(parseAllMarkets(rekeyed(game, (xs) => [...xs])));
    for (const seed of [1, 7, 42, 2026]) {
      const shuffledGame = rekeyed(game, (xs) => shuffled(xs, seed));
      expect(JSON.stringify(parseAllMarkets(shuffledGame))).toBe(reference);
    }
    const reversedGame = rekeyed(game, (xs) => [...xs].reverse());
    expect(JSON.stringify(parseAllMarkets(reversedGame))).toBe(reference);
  });

  it("betcris parser: the line of a market without a base is the same whichever event arrives first", () => {
    const market = (events: SwarmEvent[]): SwarmGame => ({
      id: 1,
      team1_name: "Arsenal",
      team2_name: "Chelsea",
      team1_id: 1,
      team2_id: 2,
      start_ts: 1700000000,
      markets_count: 1,
      is_blocked: 0,
      game_number: 1,
      market: {
        "5000000001": {
          id: 5000000001,
          name: "Liczba rzutów rożnych",
          type: "CornersAsianTotal",
          order: 3,
          col_count: 2,
          event: Object.fromEntries(events.map((e) => [String(e.id), e])),
        },
      },
    });
    const a: SwarmEvent = { id: 7400000001, name: "A", price: 1.9, order: 1, base: 9.5 };
    const b: SwarmEvent = { id: 7400000002, name: "B", price: 1.9, order: 2, base: 10.5 };
    const forward = parseAllMarkets(market([a, b]));
    const backward = parseAllMarkets(market([b, a]));
    expect(backward).toEqual(forward);
    expect(forward[0].paramValue).toBe("9.5");
  });
});
