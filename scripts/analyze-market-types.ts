import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || "";

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyzeMarketTypes() {
  console.log("Fetching raw odds data from Supabase...\n");
  
  const { data: odds, error } = await supabase
    .from("raw_scraped_match_odds")
    .select("bookmaker, markets")
    .limit(1000);
    
  if (error) {
    console.error("Error fetching data:", error);
    return;
  }
  
  if (!odds || odds.length === 0) {
    console.log("No data found in database");
    return;
  }
  
  console.log(`Found ${odds.length} records\n`);
  
  // Aggregate market types by bookmaker
  const bookmakerMarkets: Record<string, Set<string>> = {};
  const bookmakerMarketNames: Record<string, Set<string>> = {};
  
  for (const row of odds) {
    const bookmaker = row.bookmaker;
    if (!bookmakerMarkets[bookmaker]) {
      bookmakerMarkets[bookmaker] = new Set();
      bookmakerMarketNames[bookmaker] = new Set();
    }
    
    const markets = row.markets as any[];
    if (markets) {
      for (const market of markets) {
        if (market.type) {
          bookmakerMarkets[bookmaker].add(market.type);
        }
        if (market.name) {
          bookmakerMarketNames[bookmaker].add(market.name);
        }
      }
    }
  }
  
  console.log("=== MARKET TYPES BY BOOKMAKER ===\n");
  
  for (const [bookmaker, types] of Object.entries(bookmakerMarkets).sort()) {
    console.log(`\n${bookmaker.toUpperCase()}:`);
    console.log(`  Types (${types.size}): ${[...types].sort().join(", ")}`);
    const names = bookmakerMarketNames[bookmaker];
    if (names.size > 0 && names.size <= 30) {
      console.log(`  Names: ${[...names].slice(0, 20).join(", ")}${names.size > 20 ? "..." : ""}`);
    }
  }
}

analyzeMarketTypes().catch(console.error);
