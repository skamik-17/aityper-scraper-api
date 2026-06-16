/**
 * Minimal TheSportsDB client for backend sync jobs.
 * Only exposes what sync-service needs. Free tier rate limit handled via batching.
 */

// Free-tier key "123" returns full round listings (eventsround). The legacy
// key "3" is capped (~5 events/round), which truncates fixture sync.
const BASE_URL = "https://www.thesportsdb.com/api/v1/json/123";

export interface TsdbEvent {
  idEvent: string;
  strEvent: string;
  idLeague: string;
  strLeague: string;
  strHomeTeam: string;
  strAwayTeam: string;
  idHomeTeam: string;
  idAwayTeam: string;
  strHomeTeamBadge: string | null;
  strAwayTeamBadge: string | null;
  strTimestamp: string | null;
  dateEvent: string | null;
  strTime: string | null;
  intRound: string | null;
  strStatus: string | null;
  strVenue: string | null;
  intHomeScore: string | null;
  intAwayScore: string | null;
  strHalfTimeScore: string | null;
  strPostponed: string | null;
}

interface TsdbEventsResponse {
  events: TsdbEvent[] | null;
}

async function fetchRound(
  leagueId: string,
  round: number,
  season: string
): Promise<TsdbEvent[]> {
  const url = `${BASE_URL}/eventsround.php?id=${leagueId}&r=${round}&s=${encodeURIComponent(season)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TSDB ${response.status} ${response.statusText} for round ${round}`);
  }
  const data = (await response.json()) as TsdbEventsResponse;
  return data.events ?? [];
}

export function getCurrentSeason(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  // European leagues: season starts July (month 6)
  if (month >= 6) return `${year}-${year + 1}`;
  return `${year - 1}-${year}`;
}

export interface FetchAllRoundsResult {
  events: TsdbEvent[];
  failedRounds: number[];
}

/**
 * Fetch all rounds for a league with rate-limit-friendly batching.
 * Free tier is ~30 req/min and protected by Cloudflare (1015 ban on burst).
 * Defaults: sequential requests every 3s → 20 req/min, with a retry pass
 * on rounds that failed (typically transient Cloudflare 1015 bans).
 */
export async function fetchAllRounds(
  leagueId: string,
  totalRounds: number,
  season: string,
  opts: {
    batchSize?: number;
    batchDelayMs?: number;
    retryDelayMs?: number;
  } = {}
): Promise<FetchAllRoundsResult> {
  const { batchSize = 1, batchDelayMs = 3000, retryDelayMs = 60000 } = opts;
  const events: TsdbEvent[] = [];
  const failedRounds: number[] = [];

  for (let start = 1; start <= totalRounds; start += batchSize) {
    const batch: number[] = [];
    for (let r = start; r < start + batchSize && r <= totalRounds; r++) {
      batch.push(r);
    }

    const results = await Promise.allSettled(
      batch.map((r) => fetchRound(leagueId, r, season))
    );

    results.forEach((result, idx) => {
      if (result.status === "fulfilled") {
        events.push(...result.value);
      } else {
        failedRounds.push(batch[idx]);
      }
    });

    if (start + batchSize <= totalRounds) {
      await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
    }
  }

  if (failedRounds.length > 0 && retryDelayMs > 0) {
    console.log(
      `[tsdbClient] retry pass: ${failedRounds.length} round(s) failed, waiting ${retryDelayMs}ms`
    );
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    const stillFailed: number[] = [];
    for (const r of failedRounds) {
      try {
        const roundEvents = await fetchRound(leagueId, r, season);
        events.push(...roundEvents);
      } catch {
        stillFailed.push(r);
      }
      await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
    }
    failedRounds.length = 0;
    failedRounds.push(...stillFailed);
  }

  return { events, failedRounds };
}
