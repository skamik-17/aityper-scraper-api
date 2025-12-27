import dotenv from "dotenv";

dotenv.config();

export const CONFIG = {
  // Server
  PORT: parseInt(process.env.PORT || "3001"),
  NODE_ENV: process.env.NODE_ENV || "development",

  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY!,

  // Admin
  ADMIN_API_KEY: process.env.ADMIN_API_KEY || "dev-api-key",

  // Scraper settings
  SCRAPE_INTERVAL_MINUTES: parseInt(
    process.env.SCRAPE_INTERVAL_MINUTES || "5"
  ),
  SCRAPE_CRON: `*/${process.env.SCRAPE_INTERVAL_MINUTES || "5"} * * * *`,
  SCRAPER_TIMEOUT_MS: parseInt(process.env.SCRAPER_TIMEOUT_MS || "30000"),

  // Supported leagues
  ENABLED_LEAGUES: ["ekstraklasa", "premier-league"] as const,

  // Bookmakers
  BOOKMAKERS: [
    "sts",
    "fortuna",
    "betclic",
    "superbet",
    "lvbet",
    "fuksiarz",
  ] as const,
} as const;

// Type for enabled leagues
export type EnabledLeague = (typeof CONFIG.ENABLED_LEAGUES)[number];

// Type for bookmakers
export type PolishBookmaker = (typeof CONFIG.BOOKMAKERS)[number];

// Validate required env vars
export function validateConfig(): void {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}
