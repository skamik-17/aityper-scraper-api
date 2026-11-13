import { ALL_POLISH_BOOKMAKERS, type PolishBookmaker } from "../config/index.js";
import { PROMOTION_CATALOG } from "../data/promotions/index.js";
import type { Promotion } from "../types/promotions.js";

export interface PromotionFilter {
  bookmaker?: PolishBookmaker;
  activeAt?: Date;
}

/**
 * Verified promotions active at `activeAt` (default: now), optionally for one bookmaker.
 * validFrom is inclusive, validTo is exclusive; a missing bound is open.
 */
export function listPromotions(
  filter: PromotionFilter = {},
  catalog: Promotion[] = PROMOTION_CATALOG
): Promotion[] {
  const at = (filter.activeAt ?? new Date()).getTime();
  const order = (b: PolishBookmaker) => ALL_POLISH_BOOKMAKERS.indexOf(b);

  return catalog
    .filter((p) => p.review.status === "verified")
    .filter((p) => !filter.bookmaker || p.bookmaker === filter.bookmaker)
    .filter((p) => !p.validFrom || Date.parse(p.validFrom) <= at)
    .filter((p) => !p.validTo || at < Date.parse(p.validTo))
    .sort((a, b) => order(a.bookmaker) - order(b.bookmaker) || a.id.localeCompare(b.id));
}
