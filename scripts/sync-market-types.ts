/**
 * Manual runner for syncMarketTypes — use this to populate market_types table
 * from MARKET_CATALOG without starting the full backend.
 *
 * Run: npx tsx scripts/sync-market-types.ts
 */

import { syncMarketTypes } from "../src/services/market-types-sync.js";
import { testConnection } from "../src/config/database.js";

async function main() {
  console.log("[sync-market-types] Testing DB connection...");
  const connected = await testConnection();
  if (!connected) {
    console.error("[sync-market-types] DB connection failed. Check SUPABASE_URL / SUPABASE_SERVICE_KEY in backend/.env");
    process.exit(1);
  }
  console.log("[sync-market-types] DB connected. Running sync...");

  try {
    const { upserted } = await syncMarketTypes();
    console.log(`[sync-market-types] Success: ${upserted} entries upserted to market_types`);
    process.exit(0);
  } catch (error) {
    console.error("[sync-market-types] FAILED:", error);
    process.exit(1);
  }
}

main();
