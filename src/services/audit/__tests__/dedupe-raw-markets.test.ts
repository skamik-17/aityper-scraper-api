import { describe, it, expect } from "vitest";
import { dedupeRawMarkets } from "../scraper-audit-core.js";
import type { RawAuditMarket } from "../scraper-audit-core.js";

const m = (name: string, param: string | undefined, sels: string[]): RawAuditMarket => ({
  name,
  paramValue: param,
  selections: sels.map((s) => ({ name: s, odds: 1.5 })),
});

describe("dedupeRawMarkets", () => {
  it("drops exact duplicates by name+param+selection-set, keeps distinct params", () => {
    const input = [
      m("Liczba goli", "2.5", ["Powyżej 2,5", "Poniżej 2,5"]),
      m("Liczba goli", "2.5", ["Powyżej 2,5", "Poniżej 2,5"]), // dup
      m("Liczba goli", "3.5", ["Powyżej 3,5", "Poniżej 3,5"]), // distinct param
      m("Wynik meczu", undefined, ["1", "X", "2"]),
    ];
    const out = dedupeRawMarkets(input);
    expect(out.length).toBe(3);
    expect(out.filter((x) => x.name === "Liczba goli").length).toBe(2);
  });
});
