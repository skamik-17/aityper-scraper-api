import dotenv from "dotenv";

dotenv.config();

// All supported Polish bookmakers (for type definitions)
export const ALL_POLISH_BOOKMAKERS = [
  "sts",
  "fortuna",
  "betclic",
  "superbet",
  "lvbet",
  "fuksiarz",
  "betfan",
  "totalbet",
  "forbet",
  "etoto",
  "betters",
  "lebull",
  "betcris",
  "pzbuk",
] as const;

// Type for all Polish bookmakers (used in type definitions)
export type PolishBookmaker = (typeof ALL_POLISH_BOOKMAKERS)[number];

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
  SCRAPERS_ON: process.env.SCRAPERS_ON !== "false", // Default: true, set to "false" to disable
  SCRAPE_INTERVAL_MINUTES: parseInt(
    process.env.SCRAPE_INTERVAL_MINUTES || "30"
  ),
  SCRAPE_CRON: `*/${process.env.SCRAPE_INTERVAL_MINUTES || "30"} * * * *`,
  SCRAPER_TIMEOUT_MS: parseInt(process.env.SCRAPER_TIMEOUT_MS || "30000"),

  // Supported leagues
  ENABLED_LEAGUES: [
    "world-cup-2026",
  ] as const,

  // Bookmakers
  BOOKMAKERS: [
    "sts", 
    "fortuna",
    "betclic",
    "superbet",
    "lvbet",
    "fuksiarz",
    "betfan",
    "forbet",
    "etoto",
    "betters",
    "lebull",
    "betcris",
    "pzbuk",
    "totalbet",
  ] as const,
} as const;

// Type for enabled leagues
export type EnabledLeague = (typeof CONFIG.ENABLED_LEAGUES)[number];

// Type for enabled bookmakers (subset of PolishBookmaker)
export type EnabledBookmaker = (typeof CONFIG.BOOKMAKERS)[number];

// Validate required env vars
export function validateConfig(): void {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}
