/**
 * Synchronize the in-code MARKET_CATALOG to the Supabase market_types table.
 *
 * The odds table has a foreign key from market_type_id → market_types.id. When
 * new entries are added to the catalog but not to the DB, scraper inserts fail
 * with FK violation and whole batches roll back — causing matches to disappear
 * from the aggregated view. Run this once at startup to keep DB aligned.
 */

import { getSupabase } from "../config/database.js";
import { MARKET_CATALOG } from "../data/market-catalog.js";
import type { Database } from "../types/database.js";

type MarketTypeInsert = Database["public"]["Tables"]["market_types"]["Insert"];

export async function syncMarketTypes(): Promise<{ upserted: number }> {
  const supabase = getSupabase();

  // sub_category exists in the DB schema (migration 02) but not yet in the
  // generated TS type — cast payload shape to any to include it.
  const rows = MARKET_CATALOG.map((entry) => ({
    id: entry.numericId,
    code: entry.code,
    name_pl: entry.labels.pl,
    name_en: entry.labels.en,
    description_pl: entry.descriptions.pl,
    description_en: entry.descriptions.en,
    view_type: entry.viewType,
    category: entry.category,
    sub_category: entry.subCategory ?? null,
    has_parameter: entry.hasParameter,
    param_type: entry.parameterType ?? null,
    selections: entry.selections as MarketTypeInsert["selections"],
    display_order: entry.displayOrder,
  })) as unknown as MarketTypeInsert[];

  const { error } = await supabase
    .from("market_types")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: false });

  if (error) {
    console.error("[marketTypesSync] Upsert error:", error);
    throw error;
  }

  return { upserted: rows.length };
}
