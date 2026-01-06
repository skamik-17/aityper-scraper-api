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
  LVBetMatchInfoResponse,
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
    const apiUrl = `${API_BASE_URL}/matches/competition-view/?sports_groups_ids=${tournamentId}&lang=pl`;
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
    const matchIdsParam = matchIds.join(",");
    const apiUrl = `${API_BASE_URL}/markets/search/?matches_ids=${matchIdsParam}&lang=pl`;
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
 * Fetch match info (team names) from single match endpoint
 *
 * @param page - Playwright page with established session
 * @param matchId - Match ID
 * @returns Match info response or null on error
 */
export async function fetchMatchInfo(
  page: Page,
  matchId: string
): Promise<LVBetMatchInfoResponse | null> {
  try {
    const apiUrl = `${API_BASE_URL}/matches/${matchId}/?lang=pl`;
    console.log(`[LVBet/Navigation] Fetching match info for: ${matchId}`);

    const response = await page.request.fetch(apiUrl);
    const data = await response.json();

    return data as LVBetMatchInfoResponse;
  } catch (error) {
    console.error(`[LVBet/Navigation] Failed to fetch match info:`, error);
    return null;
  }
}

/**
 * Extract match ID from an LVBet event URL
 * URL format: https://lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/.../match_id/
 *
 * @param eventUrl - Full URL to the event page
 * @returns Match ID string or null if not found
 */
export function extractMatchIdFromUrl(eventUrl: string): string | null {
  // Remove trailing slash and split by /
  const urlPath = eventUrl.replace(/\/$/, "");
  const segments = urlPath.split("/");
  const matchId = segments[segments.length - 1];

  // Match ID can be numeric or prefixed with "bc:"
  if (!matchId || !/^(bc:)?\d+$/.test(matchId)) {
    return null;
  }

  return matchId;
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

/**
 * Build a simplified event URL from match ID
 * Used when full match data is not available
 */
export function buildSimpleEventUrl(matchId: string): string {
  return `${BASE_URL}/pl/zaklady-bukmacherskie/pilka-nozna/--/${matchId}/`;
}
