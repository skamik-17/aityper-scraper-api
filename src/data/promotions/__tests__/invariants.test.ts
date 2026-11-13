import { describe, it, expect } from "vitest";
import type { Promotion } from "../../../types/promotions.js";
import {
  findDuplicateIds,
  findBadIdPrefixes,
  findUnknownBookmakers,
  findBadVerifiedSources,
  findFullEffectsWithoutEvidence,
  findBadAccaTiers,
  findBadValidityWindows,
  findMixedExclusiveGroups,
  findDanglingCombinableWith,
  findForbiddenWords,
  findPromoCodesInOurText,
} from "../invariants.js";

function promo(over: Partial<Promotion> = {}): Promotion {
  return {
    id: "sts-test",
    bookmaker: "sts",
    name: "Test",
    audience: "everyone",
    recurrence: { kind: "always_on" },
    activation: { kind: "automatic" },
    eligibility: {
      betTypes: ["single"],
      fundsSource: "any",
      requiresConfirmation: [],
      notes: [],
    },
    effects: [],
    stacking: { combinableWith: [] },
    source: {
      promoUrl: "https://example.com",
      termsUrl: "https://example.com/terms",
      termsHash: "a".repeat(64),
      fetchedAt: "2026-11-07T10:00:00.000Z",
      evidence: {},
    },
    review: { status: "verified", verifiedAt: "2026-11-07T10:00:00.000Z", verifiedBy: "x" },
    version: 1,
    ...over,
  };
}

const taxEffect = {
  effect: { type: "TAX_RELIEF" as const, relief: { kind: "stake_factor" as const, factor: 1 } },
  valuation: "full" as const,
};

describe("catalog invariant helpers", () => {
  it("accepts a good fixture", () => {
    const c = [promo()];
    expect(findDuplicateIds(c)).toEqual([]);
    expect(findBadIdPrefixes(c)).toEqual([]);
    expect(findUnknownBookmakers(c)).toEqual([]);
    expect(findBadVerifiedSources(c)).toEqual([]);
    expect(findBadValidityWindows(c)).toEqual([]);
    expect(findForbiddenWords(c)).toEqual([]);
  });

  it("reports duplicate ids", () => {
    expect(findDuplicateIds([promo(), promo()])).toEqual(["sts-test"]);
  });

  it("reports ids without the bookmaker prefix", () => {
    expect(findBadIdPrefixes([promo({ id: "fortuna-x" })])).toEqual(["fortuna-x"]);
  });

  it("reports unknown bookmakers", () => {
    const bad = promo({ bookmaker: "nope" as never });
    expect(findUnknownBookmakers([bad])).toEqual(["sts-test"]);
  });

  it("reports verified entries with bad sources", () => {
    const s = promo().source;
    expect(findBadVerifiedSources([promo({ source: { ...s, termsUrl: "http://x" } })])).toHaveLength(1);
    expect(findBadVerifiedSources([promo({ source: { ...s, termsHash: "xyz" } })])).toHaveLength(1);
    expect(findBadVerifiedSources([promo({ source: { ...s, fetchedAt: "nope" } })])).toHaveLength(1);
    expect(
      findBadVerifiedSources([promo({ review: { status: "verified", verifiedAt: "nope" } })]),
    ).toHaveLength(1);
    expect(
      findBadVerifiedSources([promo({ source: { ...s, termsUrl: "http://x" }, review: { status: "draft" } })]),
    ).toEqual([]);
  });

  it("reports full effects without evidence under their own index", () => {
    const evidenceOther = { "effects[1].effect.relief.factor": "q" };
    const bad = promo({
      effects: [taxEffect, taxEffect],
      source: { ...promo().source, evidence: evidenceOther },
    });
    expect(findFullEffectsWithoutEvidence([bad])).toEqual(["sts-test effects[0]"]);
    const good = promo({
      effects: [taxEffect],
      source: { ...promo().source, evidence: { "effects[0].effect.relief.factor": "q" } },
    });
    expect(findFullEffectsWithoutEvidence([good])).toEqual([]);
  });

  it("reports ACCA tiers that do not ascend", () => {
    const acca = (tiers: { minLegs: number; percent: number }[]) =>
      promo({
        effects: [
          {
            valuation: "display_only",
            effect: { type: "ACCA_BONUS", base: "profit", tiers, paidAs: { kind: "cash" } },
          },
        ],
      });
    expect(findBadAccaTiers([acca([{ minLegs: 3, percent: 5 }, { minLegs: 4, percent: 10 }])])).toEqual([]);
    expect(findBadAccaTiers([acca([{ minLegs: 3, percent: 5 }, { minLegs: 3, percent: 10 }])])).toHaveLength(1);
    expect(findBadAccaTiers([acca([{ minLegs: 3, percent: 10 }, { minLegs: 4, percent: 5 }])])).toHaveLength(1);
  });

  it("reports validTo not after validFrom", () => {
    expect(
      findBadValidityWindows([promo({ validFrom: "2026-02-01T00:00:00Z", validTo: "2026-01-01T00:00:00Z" })]),
    ).toEqual(["sts-test"]);
    expect(
      findBadValidityWindows([promo({ validFrom: "2026-01-01T00:00:00Z", validTo: "2026-02-01T00:00:00Z" })]),
    ).toEqual([]);
  });

  it("reports exclusive groups spanning bookmakers", () => {
    const a = promo({ id: "sts-a", stacking: { exclusiveGroup: "g", combinableWith: [] } });
    const b = promo({ id: "fortuna-b", bookmaker: "fortuna", stacking: { exclusiveGroup: "g", combinableWith: [] } });
    expect(findMixedExclusiveGroups([a, b])).toEqual(["g"]);
  });

  it("reports combinableWith ids that do not exist", () => {
    const a = promo({ stacking: { combinableWith: ["ghost"] } });
    expect(findDanglingCombinableWith([a])).toEqual(["sts-test -> ghost"]);
  });

  it("reports forbidden words in our text but not in name", () => {
    const e = promo().eligibility;
    expect(findForbiddenWords([promo({ name: "Gratis dla każdego" })])).toEqual([]);
    expect(
      findForbiddenWords([promo({ eligibility: { ...e, notes: ["To jest Darmowy zakład"] } })]),
    ).toHaveLength(1);
    expect(
      findForbiddenWords([
        promo({ eligibility: { ...e, requiresConfirmation: [{ key: "k", label: "Pewny zysk", expires: "never" }] } }),
      ]),
    ).toHaveLength(1);
    expect(findForbiddenWords([promo({ eligibility: { ...e, couponAction: "zakład bez ryzyka" } })])).toHaveLength(1);
    expect(
      findForbiddenWords([
        promo({
          effects: [{ ...taxEffect, extraEligibility: { couponAction: "zarabiaj" } }],
        }),
      ]),
    ).toHaveLength(1);
  });

  it("reports the promotion's own promo code in our text", () => {
    const e = promo().eligibility;
    const withCode = (over: Partial<Promotion>) =>
      promo({ activation: { kind: "promo_code", code: "WELCOME50" }, ...over });
    expect(findPromoCodesInOurText([promo({ eligibility: { ...e, notes: ["kod welcome50"] } })])).toEqual([]);
    expect(findPromoCodesInOurText([withCode({ name: "WELCOME50" })])).toEqual([]);
    expect(
      findPromoCodesInOurText([withCode({ eligibility: { ...e, notes: ["Wpisz kod welcome50 przy rejestracji"] } })]),
    ).toEqual(["sts-test: eligibility.notes[0]"]);
    expect(
      findPromoCodesInOurText([withCode({ eligibility: { ...e, notes: ["WELCOME500 inny"] } })]),
    ).toEqual([]);
    expect(
      findPromoCodesInOurText([withCode({ eligibility: { ...e, couponAction: "użyj WELCOME50" } })]),
    ).toEqual(["sts-test: eligibility.couponAction"]);
    expect(
      findPromoCodesInOurText([
        withCode({
          effects: [
            { valuation: "display_only", effect: { type: "OTHER", description: "kod WELCOME50" } },
            {
              valuation: "display_only",
              effect: { type: "TASK_REWARD", task: "WELCOME50", rewardPln: 1, paidAs: { kind: "cash" } },
            },
            {
              ...taxEffect,
              extraEligibility: { requiresConfirmation: [{ key: "k", label: "WELCOME50", expires: "never" }] },
            },
          ],
        }),
      ]),
    ).toEqual([
      "sts-test: effects[0].description",
      "sts-test: effects[1].task",
      "sts-test: effects[2].extraEligibility.requiresConfirmation[0].label",
    ]);
  });
});
