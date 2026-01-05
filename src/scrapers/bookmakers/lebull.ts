/**
 * Le Bull Playwright Scraper
 * Uses Network Interception to capture odds from sbteam.xyz API responses.
 * All markets (1X2, DC, BTTS, O/U) are available in the upcoming endpoint.
 */

import type { Page } from "playwright";
import type { PolishBookmaker } from "../../config/index.js";
import type {
  ScraperConfig,
  ScraperResult,
  RawScrapedOdds,
  MatchIdentifier,
  MatchDetailResult,
  EventUrlEntry,
} from "../../types/scraper.js";
import type { MarketOverUnderOdds } from "../../types/markets.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../types/scraper.js";
import { PlaywrightScraper } from "../base/playwright-base.js";
import { findMatchingEvent, getCanonicalTeamName } from "../team-matcher.js";

// League IDs for LeBull
const LEAGUE_IDS: Record<string, number> = {
  ekstraklasa: 4847,
  "premier-league": 4485,
  laliga: 4486, // La Liga (confirmed from URL)
  "serie-a": 4484, // Serie A (confirmed from sbteam.xyz API)
  "ligue-1": 4610, // Ligue 1 (confirmed - same as Betters)
};

// stakeType IDs for market parsing (same as Betters - shared sbteam.xyz backend)
const STAKE_TYPES = {
  match: 1, // 1X2
  doubleChance: 37, // DC
  overUnder: 3, // O/U
  btts: 26, // BTTS
};

// Cache for events data
let cachedEvents: Map<string, any> = new Map();
let cacheTimestamp: number = 0;
const CACHE_TTL = 60000;

export class LebullPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "lebull";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.lebull, ...config, enabled: true };
  }

  private async captureEventsData(page: Page, leagueId: number): Promise<any[]> {
    let capturedData: any[] = [];

    // Set up response interception with reduced timeout for faster failure
    const capturePromise = new Promise<any[]>((resolve) => {
      const timeout = setTimeout(() => resolve([]), 8000);

      page.on("response", async (response) => {
        const url = response.url();
        if (url.includes(`/leagues/${leagueId}/upcoming`)) {
          try {
            const data = await response.json();
            if (data && Array.isArray(data) && data.length > 0) {
              clearTimeout(timeout);
              resolve(data[0].games || []);
            }
          } catch {}
        }
      });
    });

    // Navigate to the league page to trigger the API call
    await this.navigateWithRetry(page, `https://lebullpl-ssr.boxwebcdn.work/pl/league/1/${leagueId}`, {
      timeout: 30000,
      waitUntil: "domcontentloaded",
    });

    capturedData = await capturePromise;

    // Update cache
    if (capturedData.length > 0) {
      cacheTimestamp = Date.now();
      for (const event of capturedData) {
        cachedEvents.set(String(event.eventId), event);
      }
    }

    return capturedData;
  }

  private parseEventMarkets(event: any): {
    m1X2: { home: number; draw: number; away: number };
    mDC: { homeOrDraw: number; drawOrAway: number; homeOrAway: number };
    mBTTS: { yes: number; no: number };
    mOU: Record<string, MarketOverUnderOdds>;
  } {
    const m1X2 = { home: 0, draw: 0, away: 0 };
    const mDC = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
    const mBTTS = { yes: 0, no: 0 };
    const mOU: Record<string, MarketOverUnderOdds> = {};

    for (const stakeType of event.stakeTypes || []) {
      const stakes = stakeType.stakes || [];

      // 1X2 - stakeTypeId 1
      if (stakeType.stakeTypeId === STAKE_TYPES.match && stakes.length >= 3 && m1X2.home === 0) {
        for (const s of stakes) {
          if (s.stakeCode === 1) m1X2.home = s.betFactor;
          else if (s.stakeCode === 2) m1X2.draw = s.betFactor;
          else if (s.stakeCode === 3) m1X2.away = s.betFactor;
        }
      }
      // Double Chance - stakeTypeId 37
      else if (stakeType.stakeTypeId === STAKE_TYPES.doubleChance && stakes.length >= 3) {
        for (const s of stakes) {
          const name = (s.stakeName || "").toUpperCase();
          if (name === "1X") mDC.homeOrDraw = s.betFactor;
          else if (name === "X2") mDC.drawOrAway = s.betFactor;
          else if (name === "12") mDC.homeOrAway = s.betFactor;
        }
      }
      // BTTS - stakeTypeId 26
      else if (stakeType.stakeTypeId === STAKE_TYPES.btts) {
        for (const s of stakes) {
          const name = (s.stakeName || "").toLowerCase();
          if (name === "tak") mBTTS.yes = s.betFactor;
          else if (name === "nie") mBTTS.no = s.betFactor;
        }
      }
      // Over/Under - stakeTypeId 3
      else if (stakeType.stakeTypeId === STAKE_TYPES.overUnder) {
        for (const s of stakes) {
          const lineVal = s.stakeArgument;
          if (typeof lineVal === "number" && lineVal % 1 === 0.5) {
            const line = lineVal.toFixed(1);
            const name = (s.stakeName || "").toLowerCase();
            if (!mOU[line]) mOU[line] = { over: 0, under: 0 };
            if (name.includes("powyżej")) {
              mOU[line].over = s.betFactor;
            } else if (name.includes("poniżej")) {
              mOU[line].under = s.betFactor;
            }
          }
        }
      }
    }

    return { m1X2, mDC, mBTTS, mOU };
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();
    let cleanup: (() => Promise<void>) | null = null;
    const leagueId = LEAGUE_IDS[league];

    if (!leagueId) {
      return this.createNotFoundResult(`Unknown league: ${league}`, Date.now() - startTime);
    }

    try {
      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      console.log(`[LeBull] Capturing data for league: ${leagueId}`);
      const events = await this.captureEventsData(page, leagueId);

      if (events.length > 0) {
        const matches: RawScrapedOdds[] = [];

        for (const event of events) {
          const homeTeamName = event.teamA || "";
          const awayTeamName = event.teamB || "";

          if (!homeTeamName || !awayTeamName) continue;

          // Parse markets
          const { m1X2 } = this.parseEventMarkets(event);

          if (m1X2.home <= 1 || m1X2.draw <= 1 || m1X2.away <= 1) continue;

          matches.push({
            bookmaker: this.bookmaker,
            eventName: `${homeTeamName} - ${awayTeamName}`,
            homeTeam: getCanonicalTeamName(homeTeamName, league),
            awayTeam: getCanonicalTeamName(awayTeamName, league),
            homeOdds: m1X2.home,
            drawOdds: m1X2.draw,
            awayOdds: m1X2.away,
            hasNoTaxPromo: false,
            scrapedAt: new Date(),
            eventUrl: `https://lebullpl-ssr.boxwebcdn.work/pl/event/1/${leagueId}/${event.eventId}`,
          });
        }

        console.log(`[LeBull] Found ${matches.length} matches via API`);
        return {
          status: "success",
          bookmaker: this.bookmaker,
          data: matches,
          duration: Date.now() - startTime,
          timestamp: new Date(),
        };
      }

      return this.createNotFoundResult("Could not capture LeBull API data", Date.now() - startTime);
    } catch (error) {
      return this.createErrorResult(error, Date.now() - startTime);
    } finally {
      if (cleanup) await cleanup();
    }
  }

  async scrapeMatch(match: MatchIdentifier): Promise<ScraperResult> {
    const startTime = Date.now();
    const league = match.leagueId ?? "ekstraklasa";
    const allMatches = await this.scrapeLeague(league);
    if (allMatches.status !== "success" || !allMatches.data) return allMatches;

    const matchResult = findMatchingEvent({ homeTeam: match.homeTeam, awayTeam: match.awayTeam }, allMatches.data, league);
    if (!matchResult) return this.createNotFoundResult(`Match not found on LeBull: ${match.homeTeam} vs ${match.awayTeam}`, Date.now() - startTime);

    return { status: "success", bookmaker: this.bookmaker, data: [matchResult.event], duration: Date.now() - startTime, timestamp: new Date() };
  }

  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();
    let cleanup: (() => Promise<void>) | null = null;

    try {
      // Extract event ID from URL
      const eventIdMatch = eventUrl.match(/\/event\/\d+\/\d+\/(\d+)/);
      if (!eventIdMatch) {
        return this.createMatchDetailNotFoundResult("Invalid LeBull event URL", Date.now() - startTime);
      }
      const eventId = eventIdMatch[1];

      // Check cache first
      const isCacheValid = Date.now() - cacheTimestamp < CACHE_TTL;
      let event = isCacheValid ? cachedEvents.get(eventId) : null;

      // If not in cache, fetch fresh data
      if (!event) {
        const { page, cleanup: sessionCleanup } = await this.initBrowser();
        cleanup = sessionCleanup;

        // Try to find which league this event belongs to
        for (const [, leagueId] of Object.entries(LEAGUE_IDS)) {
          const events = await this.captureEventsData(page, leagueId);
          event = events.find((e: any) => String(e.eventId) === eventId);
          if (event) break;
        }
      }

      if (!event) {
        return this.createMatchDetailNotFoundResult("Event not found in LeBull API", Date.now() - startTime);
      }

      // Parse all markets from event
      const { m1X2, mDC, mBTTS, mOU } = this.parseEventMarkets(event);

      const homeTeam = event.teamA || "";
      const awayTeam = event.teamB || "";

      console.log(`[LeBull] Parsed match details for: ${homeTeam} vs ${awayTeam}`);
      console.log(`[LeBull] Markets: 1X2=${m1X2.home > 0}, DC=${mDC.homeOrDraw > 0}, BTTS=${mBTTS.yes > 0}, O/U lines=${Object.keys(mOU).length}`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data: {
          bookmaker: "lebull",
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          eventUrl,
          hasNoTaxPromo: false,
          scrapedAt: new Date(),
          market1X2: m1X2,
          marketDoubleChance: mDC.homeOrDraw > 0 ? mDC : undefined,
          marketBTTS: mBTTS.yes > 0 ? mBTTS : undefined,
          marketOverUnder: Object.keys(mOU).length > 0 ? mOU : undefined,
        },
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      return this.createMatchDetailErrorResult(error, Date.now() - startTime);
    } finally {
      if (cleanup) await cleanup();
    }
  }

  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    return [];
  }
}

export const lebullScraper = new LebullPlaywrightScraper();
