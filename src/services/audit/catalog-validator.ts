import { MARKET_CATALOG, getMarketByCode } from "../../data/market-catalog.js";

export interface ProposedCatalogEntry {
  code: string;
  category: string;
  viewType: string;
  selections: string[];
  labelPl: string;
}

/**
 * Guards autonomous additions to market-catalog.ts. A new code must be unique,
 * UPPER_SNAKE_CASE, use the HALF_TIME_ (not FIRST_HALF_) convention, carry a
 * non-empty label + selections, and use a category/viewType that already exists
 * in the catalog (so the frontend knows how to render it).
 */
export function validateNewCatalogCode(entry: ProposedCatalogEntry): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (getMarketByCode(entry.code)) errors.push(`code ${entry.code} already exists`);
  if (!/^[A-Z][A-Z0-9_]*$/.test(entry.code)) errors.push(`code must be UPPER_SNAKE_CASE: ${entry.code}`);
  if (/^FIRST_HALF_/.test(entry.code)) errors.push("use HALF_TIME_ prefix, not FIRST_HALF_");
  if (!entry.selections || entry.selections.length === 0) errors.push("selections must be non-empty");
  if (!entry.labelPl || entry.labelPl.trim().length === 0) errors.push("labelPl must be non-empty");

  const knownCategories = new Set(MARKET_CATALOG.map((m) => m.category));
  if (!knownCategories.has(entry.category as never)) {
    errors.push(`unknown category: ${entry.category}`);
  }
  const knownViewTypes = new Set(MARKET_CATALOG.map((m) => m.viewType));
  if (!knownViewTypes.has(entry.viewType as never)) {
    errors.push(`unknown viewType: ${entry.viewType}`);
  }

  return { ok: errors.length === 0, errors };
}
