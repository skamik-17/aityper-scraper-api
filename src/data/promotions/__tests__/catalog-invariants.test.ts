import { describe, it, expect } from "vitest";
import { PROMOTION_CATALOG } from "../index.js";
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

describe("promotion catalog invariants", () => {
  it("ids are unique and start with the bookmaker id", () => {
    expect(findDuplicateIds(PROMOTION_CATALOG)).toEqual([]);
    expect(findBadIdPrefixes(PROMOTION_CATALOG)).toEqual([]);
  });

  it("every bookmaker id is known", () => {
    expect(findUnknownBookmakers(PROMOTION_CATALOG)).toEqual([]);
  });

  it("verified entries have https termsUrl, sha256 termsHash, ISO fetchedAt and verifiedAt", () => {
    expect(findBadVerifiedSources(PROMOTION_CATALOG)).toEqual([]);
  });

  it("every full-valuation effect has at least one evidence quote under its path", () => {
    expect(findFullEffectsWithoutEvidence(PROMOTION_CATALOG)).toEqual([]);
  });

  it("ACCA tiers ascend in minLegs and percent", () => {
    expect(findBadAccaTiers(PROMOTION_CATALOG)).toEqual([]);
  });

  it("validTo after validFrom", () => {
    expect(findBadValidityWindows(PROMOTION_CATALOG)).toEqual([]);
  });

  it("exclusiveGroup members share the bookmaker", () => {
    expect(findMixedExclusiveGroups(PROMOTION_CATALOG)).toEqual([]);
  });

  it("combinableWith ids exist", () => {
    expect(findDanglingCombinableWith(PROMOTION_CATALOG)).toEqual([]);
  });

  it("our labels and notes contain no forbidden words", () => {
    expect(findForbiddenWords(PROMOTION_CATALOG)).toEqual([]);
  });

  it("our text never shows a promo code", () => {
    expect(findPromoCodesInOurText(PROMOTION_CATALOG)).toEqual([]);
  });
});
