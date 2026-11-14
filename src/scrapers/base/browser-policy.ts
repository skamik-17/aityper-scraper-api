/**
 * Per-bookmaker browser policy (plan 08 Task 3): what a browser session blocks, whether it
 * runs with stealth, and how long it may live. Defaults are inert (block "none", stealth
 * off); the lifetime defaults to plan 07's job budget for the bookmaker's browser path, so
 * the runtime never ends a session before the job it serves.
 *
 * Precedence: SCRAPER_BROWSER_BLOCK_<BM> / SCRAPER_BROWSER_STEALTH_<BM> > config.policy.browser > default.
 */
import type { PolishBookmaker } from "../../config/index.js";
import type { BrowserBlockLevel, BrowserPolicy, ScraperConfig } from "../../types/scraper.js";
import { maxDurationMsFor } from "../job-budgets.js";
import { DEFAULT_MAX_DURATION_MS } from "../shared/scraper-contract.js";
import { BLOCKED_EXTENSIONS, TRACKER_HOSTS } from "./browser-blocklist.js";

export type ResolvedBrowserPolicy = Required<BrowserPolicy>;

export const DEFAULT_BROWSER_POLICY: ResolvedBrowserPolicy = Object.freeze({
  block: "none",
  stealth: false,
  maxSessionMs: DEFAULT_MAX_DURATION_MS.browser,
});

const BLOCK_LEVELS: readonly BrowserBlockLevel[] = ["none", "media", "media+trackers"];

function envBlock(bookmaker: PolishBookmaker, env: NodeJS.ProcessEnv): BrowserBlockLevel | undefined {
  const name = `SCRAPER_BROWSER_BLOCK_${bookmaker.toUpperCase()}`;
  const raw = env[name];
  if (raw === undefined || raw === "") return undefined;
  const value = raw.trim().toLowerCase();
  if ((BLOCK_LEVELS as readonly string[]).includes(value)) return value as BrowserBlockLevel;
  console.warn(`[browser-policy] ignoring ${name}="${raw}" (expected none|media|media+trackers)`);
  return undefined;
}

function envStealth(bookmaker: PolishBookmaker, env: NodeJS.ProcessEnv): boolean | undefined {
  const name = `SCRAPER_BROWSER_STEALTH_${bookmaker.toUpperCase()}`;
  const raw = env[name];
  if (raw === undefined || raw === "") return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  console.warn(`[browser-policy] ignoring ${name}="${raw}" (expected 1|true|0|false)`);
  return undefined;
}

export function resolveBrowserPolicy(
  bookmaker: PolishBookmaker,
  config: Pick<ScraperConfig, "policy">,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedBrowserPolicy {
  const configured = config.policy?.browser;
  return {
    block: envBlock(bookmaker, env) ?? configured?.block ?? DEFAULT_BROWSER_POLICY.block,
    stealth: envStealth(bookmaker, env) ?? configured?.stealth ?? DEFAULT_BROWSER_POLICY.stealth,
    maxSessionMs: configured?.maxSessionMs ?? maxDurationMsFor(bookmaker, "browser"),
  };
}

/** URLPattern strings for Network.setBlockedURLs({ urlPatterns }); never a stylesheet. */
export function blockedUrlPatterns(block: BrowserBlockLevel): string[] {
  if (block === "none") return [];
  const media = [...BLOCKED_EXTENSIONS.image, ...BLOCKED_EXTENSIONS.font, ...BLOCKED_EXTENSIONS.media].map((ext) => `*://*/*.${ext}`);
  if (block === "media") return media;
  return [...media, ...TRACKER_HOSTS.flatMap((h) => [`*://${h}/*`, `*://*.${h}/*`])];
}
