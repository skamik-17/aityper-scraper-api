/**
 * Minimal TheSportsDB client for backend sync jobs.
 * Only exposes what sync-service needs. Free tier rate limit handled via batching.
 */

const BASE_URL = "https://www.thesportsdb.com/api/v1/json/3";

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
 * Free tier is ~30 req/min; we use batches of 3 with 3s delay → ~60 req/min peak
 * which still respects the per-minute window with some margin across leagues.
 */
export async function fetchAllRounds(
  leagueId: string,
  totalRounds: number,
  season: string,
  opts: { batchSize?: number; batchDelayMs?: number } = {}
): Promise<FetchAllRoundsResult> {
  const { batchSize = 3, batchDelayMs = 3000 } = opts;
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

  return { events, failedRounds };
}
