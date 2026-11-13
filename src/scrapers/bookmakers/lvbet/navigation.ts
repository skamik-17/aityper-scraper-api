/**
 * LVBet Navigation Module
 *
 * Handles all Playwright interactions for the LVBet scraper.
 * Responsible for:
 * - Fetching match lists from competition-view endpoint
 * - Fetching market data from markets/search endpoint
 * - Building event URLs
 *
 * NOTE: LVBet uses a REST API. We use page.request.fetch to make
 * API calls within the browser context to inherit session cookies.
 */

import type { Page } from "playwright";
import { API_BASE_URL, BASE_URL, TOURNAMENT_IDS, REQUEST_TIMEOUT } from "./constants.js";
import type {
  LVBetCompetitionResponse,
  LVBetMarketsResponse,
  LVBetMatch,
} from "./types.js";

/**
 * Navigate to the base site to establish session cookies
 * Required before making API requests
 */
export async function navigateToBaseSite(page: Page): Promise<boolean> {
  try {
    console.log(`[LVBet/Navigation] Navigating to base site: ${BASE_URL}`);
    await page.goto(BASE_URL, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });
    return true;
  } catch (error) {
    console.error(`[LVBet/Navigation] Failed to navigate to base site:`, error);
    return false;
  }
}

/**
 * Fetch all matches for a league from the competition-view endpoint
 *
 * @param page - Playwright page with established session
 * @param league - League slug (e.g., "ekstraklasa")
 * @returns Competition response with matches or null on error
 */
export async function fetchLeagueMatches(
  page: Page,
  league: string
): Promise<LVBetCompetitionResponse | null> {
  const tournamentId = TOURNAMENT_IDS[league];
  if (!tournamentId) {
    console.error(`[LVBet/Navigation] No tournament ID for league: ${league}`);
    return null;
  }

  try {
    const apiUrl = lvbetCompetitionViewUrl(tournamentId);
    console.log(`[LVBet/Navigation] Fetching matches from: ${apiUrl}`);

    const response = await page.request.fetch(apiUrl);
    const data = await response.json();

    return data as LVBetCompetitionResponse;
  } catch (error) {
    console.error(`[LVBet/Navigation] Failed to fetch league matches:`, error);
    return null;
  }
}

/**
 * Fetch all markets for given match IDs
 * This is a batch endpoint that accepts comma-separated match IDs
 *
 * @param page - Playwright page with established session
 * @param matchIds - Array of match IDs to fetch markets for
 * @returns Array of markets or null on error
 */
export async function fetchMarketsForMatches(
  page: Page,
  matchIds: string[]
): Promise<LVBetMarketsResponse | null> {
  if (matchIds.length === 0) {
    return [];
  }

  try {
    const apiUrl = lvbetMarketsSearchUrl(matchIds);
    console.log(`[LVBet/Navigation] Fetching markets for ${matchIds.length} matches`);

    const response = await page.request.fetch(apiUrl);
    const data = await response.json();

    if (!Array.isArray(data)) {
      console.warn(`[LVBet/Navigation] Unexpected markets response format`);
      return null;
    }

    return data as LVBetMarketsResponse;
  } catch (error) {
    console.error(`[LVBet/Navigation] Failed to fetch markets:`, error);
    return null;
  }
}

/**
 * Fetch markets for a single match
 *
 * @param page - Playwright page with established session
 * @param matchId - Single match ID
 * @returns Array of markets or null on error
 */
export async function fetchMarketsForMatch(
  page: Page,
  matchId: string
): Promise<LVBetMarketsResponse | null> {
  return fetchMarketsForMatches(page, [matchId]);
}

/**
 * Build the canonical event URL from match data
 *
 * @param match - LVBet match object
 * @param league - League slug for URL path
 * @returns Full event URL
 */
export function buildEventUrl(match: LVBetMatch, league: string): string {
  const homeTeam = match.home?.[0] || "";
  const awayTeam = match.away?.[0] || "";

  // Create URL-safe slugs
  const hSlug = homeTeam.replace(/\s+/g, "").toLowerCase();
  const aSlug = awayTeam.replace(/\s+/g, "").toLowerCase();
  const groupPath = (match.sports_groups_ids || []).join("/");

  return `${BASE_URL}/pl/zaklady-bukmacherskie/pilka-nozna/${league}/${hSlug}vs${aSlug}/--/${groupPath}/${match.match_id}/`;
}

/** A competition's match listing; template literal only, so nothing is percent-encoded. */
export function lvbetCompetitionViewUrl(tournamentId: number): string {
  return `${API_BASE_URL}/matches/competition-view/?sports_groups_ids=${tournamentId}&lang=pl`;
}

/** Markets of the given matches; the raw `bc:` ids are joined with commas, never encoded. */
export function lvbetMarketsSearchUrl(matchIds: readonly string[]): string {
  return `${API_BASE_URL}/markets/search/?matches_ids=${matchIds.join(",")}&lang=pl`;
}
