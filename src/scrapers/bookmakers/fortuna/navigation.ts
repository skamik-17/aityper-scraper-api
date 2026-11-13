/**
 * Fortuna Navigation Module
 *
 * Handles all Playwright interactions for the Fortuna scraper.
 * Responsible for:
 * - Establishing browser sessions
 * - Navigating to pages to set cookies
 * - Fetching data from the Fortuna API
 *
 * NOTE: Fortuna uses a REST API (api.efortuna.pl) for data.
 * We need Playwright to execute requests within browser context
 * to handle any CORS or session requirements.
 */

import type { Page } from "playwright";
import {
  BASE_URL,
  API_STRUCTURE_URL,
  API_MARKETS_URL,
  TOURNAMENT_IDS,
  REQUEST_TIMEOUT,
} from "./constants.js";
import type {
  FortunaMarketsResponse,
  FortunaLeagueData,
} from "./types.js";

/**
 * Navigate to the base site to establish session
 * This is required before making API requests
 */
export async function navigateToBaseSite(page: Page): Promise<boolean> {
  try {
    console.log(`[Fortuna/Navigation] Navigating to base site: ${BASE_URL}`);
    await page.goto(BASE_URL, {
      timeout: REQUEST_TIMEOUT,
      waitUntil: "domcontentloaded",
    });
    return true;
  } catch (error) {
    console.error(`[Fortuna/Navigation] Failed to navigate to base site:`, error);
    return false;
  }
}

/**
 * Fetch ALL markets for a single fixture (for full offer scraping)
 * Returns the complete market list including all available betting options
 *
 * @param page - Playwright page with established session
 * @param fixtureId - Single fixture ID
 * @returns Array of all markets for the fixture
 */
export async function fetchAllMarketsForFixture(
  page: Page,
  fixtureId: string
): Promise<FortunaMarketsResponse> {
  try {
    const markets = await page.evaluate(
      async ({ marketsUrl, fid }) => {
        try {
          // Use the full markets endpoint (not overview) for complete data
          const url = `${marketsUrl}/fixture/${fid}/markets`;
          const res = await fetch(url);
          if (!res.ok) return [];
          const data = await res.json();
          return Array.isArray(data) ? data : [];
        } catch {
          return [];
        }
      },
      { marketsUrl: API_MARKETS_URL, fid: fixtureId }
    );

    return markets as FortunaMarketsResponse;
  } catch (error) {
    console.error(`[Fortuna/Navigation] Failed to fetch all markets for fixture:`, error);
    return [];
  }
}

/**
 * Fetch fixtures and overview markets for a league in a single operation
 * Optimized for league listing scraping
 *
 * @param page - Playwright page with established session
 * @param league - League slug (e.g., "ekstraklasa")
 * @returns Combined fixtures and markets data
 */
export async function fetchLeagueData(
  page: Page,
  league: string
): Promise<FortunaLeagueData | null> {
  const tournamentId = TOURNAMENT_IDS[league];
  if (!tournamentId) {
    console.error(`[Fortuna/Navigation] Unknown league: ${league}`);
    return null;
  }

  try {
    console.log(`[Fortuna/Navigation] Fetching league data for: ${league} (${tournamentId})`);

    // Fetch fixtures and markets in one page.evaluate to minimize browser calls
    const result = await page.evaluate(
      async ({ structureUrl, marketsUrl, tid }) => {
        try {
          // Step 1: Fetch fixtures
          const fixturesRes = await fetch(
            `${structureUrl}/prematch/tournament/${tid}/fixtures`
          );
          const fixturesData = await fixturesRes.json();
          const fixtures = fixturesData.fixtures || [];

          if (fixtures.length === 0) {
            return { fixtures: [], markets: [] };
          }

          // Step 2: Fetch markets for all fixtures in parallel
          const fixtureIds = fixtures.map((f: any) => f.id);
          const marketPromises = fixtureIds.map(async (id: string) => {
            try {
              const res = await fetch(
                `${marketsUrl}/fixture/${id}/markets/overview`
              );
              const data = await res.json();
              return Array.isArray(data) ? data : [];
            } catch {
              return [];
            }
          });
          const marketsArrays = await Promise.all(marketPromises);
          const markets = marketsArrays.flat();

          return { fixtures, markets };
        } catch {
          return null;
        }
      },
      { structureUrl: API_STRUCTURE_URL, marketsUrl: API_MARKETS_URL, tid: tournamentId }
    );

    return result as FortunaLeagueData | null;
  } catch (error) {
    console.error(`[Fortuna/Navigation] Failed to fetch league data:`, error);
    return null;
  }
}

/**
 * Build the canonical event URL from fixture data
 */
export function buildEventUrl(fixtureId: string, seoName: string): string {
  return `${BASE_URL}/zaklady-bukmacherskie/pilka-nozna/${seoName}-${fixtureId}`;
}

/** A tournament's fixture listing; the `:` in the id stays literal, as in the browser's request. */
export function fortunaFixturesUrl(tournamentId: string): string {
  return `${API_STRUCTURE_URL}/prematch/tournament/${tournamentId}/fixtures`;
}

/** One fixture's full market list (not the overview). */
export function fortunaFixtureMarketsUrl(fixtureId: string): string {
  return `${API_MARKETS_URL}/fixture/${fixtureId}/markets`;
}
