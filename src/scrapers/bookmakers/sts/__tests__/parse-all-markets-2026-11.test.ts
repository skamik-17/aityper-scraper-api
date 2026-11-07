import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWebSocketJson, parseFixtures, parseAllMarkets } from "../parser.js";

/**
 * parseAllMarkets regression coverage for the 2026-11 STS offer, on the real
 * Arsenal vs Hull City fixture snapshot (f2921898, stsId 72221372). Each
 * cards/corners O/U line arrives under the same line name, so without a line
 * suffix the name-based dedup kept only one line per market.
 */
const fx = (f: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", f), "utf8");
const fixture = parseFixtures(parseWebSocketJson(fx("i_pl.trimmed.txt"))!, "premier-league").find((f) => f.id === "f2921898")!;
const markets = parseAllMarkets(fixture, parseWebSocketJson(fx("f_f2921898_pl.arsenal-hull.snapshot.txt")), null);
const byId = (id: string) => markets.filter((m) => m.bookmakerMarketId === id);

describe("STS parseAllMarkets on the 2026-11 Arsenal vs Hull City snapshot", () => {
  it("keeps every cards/corners total line", () => {
    expect(byId("185")).toHaveLength(5);
    expect(byId("185").map((m) => m.name)).toContain("Liczba kartek 2.5");
    expect(byId("228")).toHaveLength(5);
    expect(byId("206")).toHaveLength(3);
    expect(byId("247")).toHaveLength(3);
  });
  it("each cards/corners line keeps its own line and prices", () => {
    for (const id of ["185", "228", "206", "247"]) {
      for (const m of byId(id)) {
        const line = m.name.match(/ (\d+\.5)$/)?.[1];
        expect(line, m.name).toBeDefined();
        expect(m.selections.map((s) => s.name), m.name).toEqual([`+${line}`, `-${line}`]);
      }
    }
    expect(byId("185").find((m) => m.name === "Liczba kartek 2.5")!.selections).toEqual([
      expect.objectContaining({ name: "+2.5", odds: 1.6 }),
      expect.objectContaining({ name: "-2.5", odds: 2.2 }),
    ]);
  });
});
