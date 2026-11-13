import { describe, it, expect } from "vitest";
import { listPromotions } from "../promotions-service.js";
import type { Promotion } from "../../types/promotions.js";

function makePromotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: "betclic-test",
    bookmaker: "betclic",
    name: "Test",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["single", "accumulator"],
      fundsSource: "any",
      requiresConfirmation: [],
      notes: [],
    },
    effects: [],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://example.com",
      termsUrl: "https://example.com/terms",
      termsHash: "hash",
      fetchedAt: "2026-11-01T00:00:00Z",
      evidence: {},
    },
    review: { status: "verified" },
    version: 1,
    ...overrides,
  };
}

const NOW = new Date("2026-11-07T12:00:00Z");

describe("listPromotions", () => {
  it("returns only verified promotions", () => {
    const catalog = [
      makePromotion({ id: "a-verified" }),
      makePromotion({ id: "b-draft", review: { status: "draft" } }),
      makePromotion({ id: "c-suspended", review: { status: "suspended" } }),
      makePromotion({ id: "d-expired", review: { status: "expired" } }),
    ];
    const result = listPromotions({ activeAt: NOW }, catalog);
    expect(result.map((p) => p.id)).toEqual(["a-verified"]);
  });

  it("respects validFrom/validTo at activeAt", () => {
    const catalog = [
      makePromotion({ id: "open" }),
      makePromotion({ id: "not-yet", validFrom: "2026-11-08T00:00:00Z" }),
      makePromotion({ id: "ended", validTo: "2026-11-07T00:00:00Z" }),
      makePromotion({ id: "current", validFrom: "2026-11-01T00:00:00Z", validTo: "2026-11-30T00:00:00Z" }),
    ];
    expect(listPromotions({ activeAt: NOW }, catalog).map((p) => p.id)).toEqual(["current", "open"]);

    const edge = [makePromotion({ id: "edge", validTo: "2026-11-08T00:00:00Z" })];
    expect(listPromotions({ activeAt: new Date("2026-11-07T23:59:59Z") }, edge)).toHaveLength(1);
    // validTo is exclusive
    expect(listPromotions({ activeAt: new Date("2026-11-08T00:00:00Z") }, edge)).toHaveLength(0);
    // validFrom is inclusive
    const from = [makePromotion({ id: "from", validFrom: "2026-11-08T00:00:00Z" })];
    expect(listPromotions({ activeAt: new Date("2026-11-08T00:00:00Z") }, from)).toHaveLength(1);
  });

  it("filters by bookmaker", () => {
    const catalog = [
      makePromotion({ id: "x", bookmaker: "sts" }),
      makePromotion({ id: "y", bookmaker: "fortuna" }),
    ];
    const result = listPromotions({ bookmaker: "sts", activeAt: NOW }, catalog);
    expect(result.map((p) => p.id)).toEqual(["x"]);
  });

  it("sorts by bookmaker order then id", () => {
    const catalog = [
      makePromotion({ id: "b", bookmaker: "fortuna" }),
      makePromotion({ id: "z", bookmaker: "sts" }),
      makePromotion({ id: "a", bookmaker: "fortuna" }),
      makePromotion({ id: "m", bookmaker: "sts" }),
    ];
    const result = listPromotions({ activeAt: NOW }, catalog);
    expect(result.map((p) => p.id)).toEqual(["m", "z", "a", "b"]);
  });
});
