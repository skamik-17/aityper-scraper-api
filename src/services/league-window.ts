/**
 * Fixture windows for competitions that play only in international breaks (the Nations League).
 *
 * Between windows every bookmaker lists 0 matches, which the run rules count as a failure
 * (owner decision A6) and which would raise the empty-collapse alert every hour. Scheduled runs
 * therefore skip such a league while no cached TheSportsDB fixture is near. Admin runs are not
 * filtered. Every doubt fails open: an empty cache or a failing lookup keeps the league scheduled.
 */
import { getLeagueConfig } from "../config/leagues.js";
import { countTsdbFixtures, countTsdbFixturesBetween } from "../repositories/tsdb-fixtures-repository.js";

export interface LeagueWindowDeps {
  countFixtures(league: string): Promise<number>;
  countFixturesBetween(league: string, fromIso: string, toIso: string): Promise<number>;
}

export interface LeagueWindowDecision {
  active: boolean;
  reason: string;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_TIMEOUT_MS = 10_000;

const defaultDeps: LeagueWindowDeps = {
  countFixtures: countTsdbFixtures,
  countFixturesBetween: countTsdbFixturesBetween,
};

// Leagues the last refresh found outside their window; empty until the first refresh
const outside = new Set<string>();

/** Whether a scheduled run should scrape the league now. */
export async function decideLeagueWindow(
  league: string,
  nowMs: number,
  deps: LeagueWindowDeps = defaultDeps,
): Promise<LeagueWindowDecision> {
  const window = getLeagueConfig(league)?.fixtureWindow;
  if (!window) return { active: true, reason: "no fixture window" };

  const fromIso = new Date(nowMs - window.tailHours * HOUR_MS).toISOString();
  const toIso = new Date(nowMs + window.leadDays * DAY_MS).toISOString();
  try {
    if ((await deps.countFixturesBetween(league, fromIso, toIso)) > 0) {
      return { active: true, reason: `fixtures between ${fromIso} and ${toIso}` };
    }
    // Never synced: scrape and let the bookmakers tell
    if ((await deps.countFixtures(league)) === 0) return { active: true, reason: "no cached fixtures yet" };
    return { active: false, reason: `no fixture between ${fromIso} and ${toIso}` };
  } catch (error) {
    return { active: true, reason: `fixture lookup failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Re-decide every league. A refresh that outlives `timeoutMs` keeps the previous state.
 * Logs only when a league enters or leaves its window. Never throws.
 */
export async function refreshLeagueWindows(
  leagues: readonly string[],
  nowMs: number = Date.now(),
  deps: LeagueWindowDeps = defaultDeps,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const decisions = await Promise.race([
    Promise.all(leagues.map(async (league) => [league, await decideLeagueWindow(league, nowMs, deps)] as const)),
    timeout,
  ]);
  clearTimeout(timer);
  if (decisions === null) {
    console.error(`[LeagueWindow] fixture lookup timed out after ${timeoutMs} ms; keeping the previous schedule`);
    return;
  }

  for (const [league, d] of decisions) {
    if (d.active && outside.delete(league)) {
      console.log(`[LeagueWindow] ${league}: back in its fixture window (${d.reason}), scheduled runs scrape it`);
    } else if (!d.active && !outside.has(league)) {
      outside.add(league);
      console.log(`[LeagueWindow] ${league}: outside its fixture window (${d.reason}), scheduled runs skip it`);
    }
  }
}

/** False while the last refresh found the league outside its fixture window. */
export function isLeagueScheduled(league: string): boolean {
  return !outside.has(league);
}

/** The leagues a scheduled run should scrape, in their configured order. */
export function scheduledLeagues(leagues: readonly string[]): string[] {
  return leagues.filter(isLeagueScheduled);
}

/** Tests only: forget every decision. */
export function resetLeagueWindows(): void {
  outside.clear();
}
