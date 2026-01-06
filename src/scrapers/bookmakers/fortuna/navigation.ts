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
  FortunaFixturesResponse,
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
 * Fetch fixtures for a tournament from the Fortuna API
 * Executes the API request within the browser context
 *
 * @param page - Playwright page with established session
 * @param tournamentId - Fortuna tournament ID (e.g., "ufo:tour:00-0b9")
 * @returns API response with fixtures or null on error
 */
export async function fetchFixtures(
  page: Page,
  tournamentId: string
): Promise<FortunaFixturesResponse | null> {
  try {
    console.log(`[Fortuna/Navigation] Fetching fixtures for tournament: ${tournamentId}`);

    const apiData = await page.evaluate(
      async ({ structureUrl, tid }) => {
        try {
          const url = `${structureUrl}/prematch/tournament/${tid}/fixtures`;
          const res = await fetch(url);
          if (!res.ok) {
            return { fixtures: [], error: `HTTP ${res.status}` };
          }
          const json = await res.json();
          return json;
        } catch (err) {
          return { fixtures: [], error: String(err) };
        }
      },
      { structureUrl: API_STRUCTURE_URL, tid: tournamentId }
    );

    if ((apiData as any)?.error) {
      console.error(`[Fortuna/Navigation] API error: ${(apiData as any).error}`);
    }

    return apiData as FortunaFixturesResponse;
  } catch (error) {
    console.error(`[Fortuna/Navigation] Failed to fetch fixtures:`, error);
    return null;
  }
}

/**
 * Fetch overview markets for multiple fixtures (used for league listing)
 * Returns basic markets like 1X2 for each fixture
 *
 * @param page - Playwright page with established session
 * @param fixtureIds - Array of fixture IDs
 * @returns Combined array of all markets
 */
export async function fetchMarketsOverview(
  page: Page,
  fixtureIds: string[]
): Promise<FortunaMarketsResponse> {
  try {
    console.log(`[Fortuna/Navigation] Fetching markets overview for ${fixtureIds.length} fixtures`);

    const allMarkets = await page.evaluate(
      async ({ marketsUrl, fids }) => {
        const results: any[] = [];

        // Fetch markets for all fixtures in parallel
        const promises = fids.map(async (id: string) => {
          try {
            const url = `${marketsUrl}/fixture/${id}/markets/overview`;
            const res = await fetch(url);
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data) ? data : [];
          } catch {
            return [];
          }
        });

        const arrays = await Promise.all(promises);
        for (const arr of arrays) {
          results.push(...arr);
        }

        return results;
      },
      { marketsUrl: API_MARKETS_URL, fids: fixtureIds }
    );

    return allMarkets as FortunaMarketsResponse;
  } catch (error) {
    console.error(`[Fortuna/Navigation] Failed to fetch markets overview:`, error);
    return [];
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
 * Fetch fixture info by ID (for match details)
 *
 * @param page - Playwright page with established session
 * @param fixtureId - Fixture ID
 * @returns Fixture data or null
 */
export async function fetchFixtureById(
  page: Page,
  fixtureId: string
): Promise<any | null> {
  try {
    const fixture = await page.evaluate(
      async ({ structureUrl, fid }) => {
        try {
          const url = `${structureUrl}/fixture/${fid}`;
          const res = await fetch(url);
          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        }
      },
      { structureUrl: API_STRUCTURE_URL, fid: fixtureId }
    );

    return fixture;
  } catch (error) {
    console.error(`[Fortuna/Navigation] Failed to fetch fixture by ID:`, error);
    return null;
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
 * Extract fixture ID from a Fortuna event URL
 *
 * @param eventUrl - Full URL to the event page
 * @returns Fixture ID string or null if not found
 */
export function extractFixtureIdFromUrl(eventUrl: string): string | null {
  // URL format: https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/{seo-name}-{fixture-id}
  // Fixture ID format: ufo:mtch:XX-XXX
  const match = eventUrl.match(/ufo:mtch:[a-z0-9-]+/i);
  return match ? match[0] : null;
}

/**
 * Build the canonical event URL from fixture data
 */
export function buildEventUrl(fixtureId: string, seoName: string): string {
  return `${BASE_URL}/zaklady-bukmacherskie/pilka-nozna/${seoName}-${fixtureId}`;
}
