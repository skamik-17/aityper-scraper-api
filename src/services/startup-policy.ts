/**
 * Whether the first run after a boot is an immediate startup scrape or the next
 * interval run, from how fresh the stored data is (STARTUP_SCRAPE, default auto).
 * Unknown freshness (DB down, no OK run) counts as stale: never a silent skip.
 */
import { CONFIG, type StartupScrapePolicy } from "../config/index.js";
import { isLeagueSupported } from "../config/leagues.js";
import { getOddsFreshnessByBookmaker } from "../repositories/odds-repository.js";
import { getLastSuccessfulScrapeTime, getRecentRunRows } from "../repositories/scraper-run-repository.js";
import { parseDbTimestamp } from "../utils/db-timestamp.js";
import { STATUS_WINDOW_RUNS } from "./bookmaker-status.js";

export const STARTUP_DELAY_MS = 5_000;

export interface StartupDecision {
  firstTrigger: "startup" | "interval";
  firstDelayMs: number;
  reason: string;
}

export function decideStartupScrape(
  policy: StartupScrapePolicy,
  stalestOkRunAt: Date | null,
  now: Date,
  intervalMs: number,
): StartupDecision {
  if (policy === "never") return { firstTrigger: "interval", firstDelayMs: intervalMs, reason: "STARTUP_SCRAPE=never" };
  if (policy === "always") return { firstTrigger: "startup", firstDelayMs: STARTUP_DELAY_MS, reason: "STARTUP_SCRAPE=always" };
  if (stalestOkRunAt === null) return { firstTrigger: "startup", firstDelayMs: STARTUP_DELAY_MS, reason: "auto: no OK run on record" };

  const ageMs = now.getTime() - stalestOkRunAt.getTime();
  const ageMin = Math.floor(ageMs / 60_000);
  const intervalMin = Math.round(intervalMs / 60_000);
  if (ageMs >= intervalMs) {
    return { firstTrigger: "startup", firstDelayMs: STARTUP_DELAY_MS, reason: `auto: last OK run ${ageMin} min ago >= ${intervalMin} min` };
  }
  return {
    firstTrigger: "interval",
    firstDelayMs: Math.max(STARTUP_DELAY_MS, intervalMs - ageMs),
    reason: `auto: last OK run ${ageMin} min ago < ${intervalMin} min`,
  };
}

/**
 * A league's last OK run: scraper_runs first, else the newest odds row; any error -> null.
 * With scraper_runs, the league is only as fresh as its stalest supported bookmaker's newest
 * outcome (any status): a run interrupted before the browser jobs finished, or a
 * one-bookmaker admin run, leaves the others' data old. A supported bookmaker with no
 * outcome on record makes it unknown (null).
 */
export async function getLastOkRunAt(league: string): Promise<Date | null> {
  try {
    const last = await getLastSuccessfulScrapeTime(league);
    if (last) {
      const rows = await getRecentRunRows(league, STATUS_WINDOW_RUNS * CONFIG.BOOKMAKERS.length);
      // Rows come newest first: the first row per bookmaker is its newest outcome
      const newest = new Map<string, Date>();
      for (const row of rows) {
        if (!newest.has(row.bookmaker)) newest.set(row.bookmaker, parseDbTimestamp(row.finished_at ?? row.started_at));
      }
      let oldest = last;
      for (const bm of CONFIG.BOOKMAKERS) {
        if (!isLeagueSupported(league, bm)) continue;
        const at = newest.get(bm);
        if (!at || isNaN(at.getTime())) return null;
        if (at < oldest) oldest = at;
      }
      return oldest;
    }
    const freshness = await getOddsFreshnessByBookmaker(league, CONFIG.BOOKMAKERS);
    let newest: Date | null = null;
    for (const at of freshness.values()) if (!newest || at > newest) newest = at;
    return newest;
  } catch {
    return null;
  }
}

/** The oldest league's last OK run; null when any league's is unknown. */
export async function getStalestOkRunAt(leagues: readonly string[]): Promise<Date | null> {
  const all = await Promise.all(leagues.map((league) => getLastOkRunAt(league)));
  if (all.length === 0 || all.some((at) => at === null)) return null;
  return all.reduce((oldest, at) => (at! < oldest! ? at : oldest));
}
