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
  // Validated by validateConfig: scrape on boot only when stale (auto), always, or never
  STARTUP_SCRAPE: (process.env.STARTUP_SCRAPE ?? "auto") as StartupScrapePolicy,
  // Validated by validateConfig (an integer 1-1440): the loop starts runs this far apart, ±10 %
  SCRAPE_INTERVAL_MINUTES: Number(process.env.SCRAPE_INTERVAL_MINUTES ?? "30"),

  // Alerts: a bookmaker alert fires once its failure streak reaches this many runs.
  // The webhook (Slack-compatible {"text": ...}) is off unless a URL is set.
  ALERT_CONSECUTIVE_FAILURES: parseInt(process.env.ALERT_CONSECUTIVE_FAILURES || "3"),
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

export type StartupScrapePolicy = "auto" | "always" | "never";

/** STARTUP_SCRAPE as a policy: unset -> auto; else auto|always|never, or a named error. */
export function assertStartupScrape(raw: string | undefined): StartupScrapePolicy {
  if (raw === undefined) return "auto";
  if (raw === "auto" || raw === "always" || raw === "never") return raw;
  throw new Error(`Invalid STARTUP_SCRAPE "${raw}": expected auto|always|never`);
}

/** SCRAPE_INTERVAL_MINUTES as minutes: unset -> 30; else an integer 1-1440, or a named error. */
export function assertScrapeIntervalMinutes(raw: string | undefined): number {
  if (raw === undefined) return 30;
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 1440) {
    throw new Error(`Invalid SCRAPE_INTERVAL_MINUTES "${raw}": expected an integer 1-1440`);
  }
  return n;
}

// Validate required env vars
export function validateConfig(): void {
  assertScrapeIntervalMinutes(process.env.SCRAPE_INTERVAL_MINUTES);
  assertStartupScrape(process.env.STARTUP_SCRAPE);

  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}
