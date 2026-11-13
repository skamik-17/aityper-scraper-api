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

const DEFAULT_ALERT_CONSECUTIVE_FAILURES = 3;

/**
 * ALERT_CONSECUTIVE_FAILURES as a positive integer. Unset or blank gives the
 * default; any other value that is not a positive integer gives the default
 * with one warning, because parseInt would turn it into NaN or 0 and silently
 * disable every streak alert. Runs once, when CONFIG is built.
 */
function alertThreshold(raw: string | undefined): number {
  const value = raw?.trim() ?? "";
  if (value === "") return DEFAULT_ALERT_CONSECUTIVE_FAILURES;
  if (/^\d+$/.test(value) && Number(value) >= 1) return Number(value);
  console.warn(
    `[Config] ALERT_CONSECUTIVE_FAILURES=${JSON.stringify(raw)} is not a positive integer, using ${DEFAULT_ALERT_CONSECUTIVE_FAILURES}`
  );
  return DEFAULT_ALERT_CONSECUTIVE_FAILURES;
}

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

  // Alerts: a bookmaker alert fires once its failure streak reaches this many runs.
  // The webhook (Slack-compatible {"text": ...}) is off unless a URL is set.
  ALERT_CONSECUTIVE_FAILURES: alertThreshold(process.env.ALERT_CONSECUTIVE_FAILURES),
  ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL || null,

  // Supported leagues
  ENABLED_LEAGUES: [
    "premier-league",
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
