/**
 * eToto Playwright Scraper
 * Uses Network Interception to get odds directly from eToto REST API.
 * All markets (1X2, DC, BTTS, O/U) are available in the events endpoint.
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

// Category IDs for eToto API
const CATEGORY_IDS: Record<string, number> = {
  ekstraklasa: 666,
  "premier-league": 206,
  laliga: 1165, // La Liga (from URL pattern)
};

// Cache for events data
let cachedEvents: Map<string, any> = new Map();
let cacheTimestamp: number = 0;
const CACHE_TTL = 60000;

export class EtotoPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "etoto";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.etoto, ...config, enabled: true };
  }

  private async fetchEventsData(page: Page, categoryId: number): Promise<any[]> {
    const apiUrl = `https://api.etoto.pl/rest/market/categories/multi/${categoryId}/events`;

    try {
      const response = await page.evaluate(async (url) => {
        const res = await fetch(url);
        return res.json();
      }, apiUrl);

      if (response && response.data) {
        const events = response.data;
        // Update cache
        cacheTimestamp = Date.now();
        for (const event of events) {
          cachedEvents.set(String(event.eventId), event);
        }
        return events;
      }
    } catch (e) {
      console.log(`[eToto] Direct fetch failed:`, e);
    }

    return [];
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

    for (const game of event.eventGames || []) {
      const gameName = (game.gameName || "").toLowerCase();
      const outcomes = game.outcomes || [];

      // 1X2 - gameType 1
      if (game.gameType === 1 && gameName === "1x2" && outcomes.length === 3 && m1X2.home === 0) {
        const sorted = [...outcomes].sort((a: any, b: any) => a.outcomePosition - b.outcomePosition);
        m1X2.home = sorted[0]?.outcomeOdds || 0;
        m1X2.draw = sorted[1]?.outcomeOdds || 0;
        m1X2.away = sorted[2]?.outcomeOdds || 0;
      }
      // Double Chance - gameType 4
      else if (game.gameType === 4 && gameName.includes("szansa") && outcomes.length === 3) {
        for (const o of outcomes) {
          const name = (o.outcomeName || "").toUpperCase();
          if (name === "1X") mDC.homeOrDraw = o.outcomeOdds;
          else if (name === "X2") mDC.drawOrAway = o.outcomeOdds;
          else if (name === "12") mDC.homeOrAway = o.outcomeOdds;
        }
      }
      // BTTS - gameType 98
      else if (game.gameType === 98 && gameName.includes("obie") && gameName.includes("strzel")) {
        for (const o of outcomes) {
          const name = (o.outcomeName || "").toLowerCase();
          if (name === "tak") mBTTS.yes = o.outcomeOdds;
          else if (name === "nie") mBTTS.no = o.outcomeOdds;
        }
      }
      // Over/Under - gameType 8 (has `argument` field with line value)
      else if (game.gameType === 8 && gameName.includes("suma") && gameName.includes("gol") && outcomes.length === 2) {
        const lineVal = game.argument;
        if (typeof lineVal === "number" && lineVal % 1 === 0.5) {
          const line = lineVal.toFixed(1);
          if (!mOU[line]) mOU[line] = { over: 0, under: 0 };
          for (const o of outcomes) {
            const name = (o.outcomeName || "").toLowerCase();
            if (name.includes("powyżej")) {
              mOU[line].over = o.outcomeOdds;
            } else if (name.includes("poniżej")) {
              mOU[line].under = o.outcomeOdds;
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
    const categoryId = CATEGORY_IDS[league];

    if (!categoryId) {
      return this.createNotFoundResult(`Unknown league: ${league}`, Date.now() - startTime);
    }

    try {
      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      // Go to eToto to establish session
      console.log(`[eToto] Fetching data for category: ${categoryId}`);
      await this.navigateWithRetry(page, "https://www.etoto.pl", { timeout: 30000, waitUntil: "domcontentloaded" });
      await this.delay(500); // Reduced from 2000ms - session established quickly

      // Fetch events data
      const events = await this.fetchEventsData(page, categoryId);

      if (events.length > 0) {
        const matches: RawScrapedOdds[] = [];

        for (const event of events) {
          // Get team names from eventName
          const eventNameParts = event.eventName?.split(" - ") || [];
          const homeTeamName = eventNameParts[0]?.trim() || "";
          const awayTeamName = eventNameParts[1]?.trim() || "";

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
            eventUrl: `https://www.etoto.pl/zaklady-bukmacherskie/wydarzenie/${event.eventId}`,
          });
        }

        console.log(`[eToto] Found ${matches.length} matches via API`);
        return {
          status: "success",
          bookmaker: this.bookmaker,
          data: matches,
          duration: Date.now() - startTime,
          timestamp: new Date(),
        };
      }

      return this.createNotFoundResult("Could not fetch eToto API data", Date.now() - startTime);
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
    if (!matchResult) return this.createNotFoundResult(`Match not found on eToto: ${match.homeTeam} vs ${match.awayTeam}`, Date.now() - startTime);

    return { status: "success", bookmaker: this.bookmaker, data: [matchResult.event], duration: Date.now() - startTime, timestamp: new Date() };
  }

  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();
    let cleanup: (() => Promise<void>) | null = null;

    try {
      // Extract event ID from URL
      const eventIdMatch = eventUrl.match(/\/wydarzenie\/(\d+)/) || eventUrl.match(/\/(\d+)$/);
      if (!eventIdMatch) {
        return this.createMatchDetailNotFoundResult("Invalid eToto event URL", Date.now() - startTime);
      }
      const eventId = eventIdMatch[1];

      // Check cache first
      const isCacheValid = Date.now() - cacheTimestamp < CACHE_TTL;
      let event = isCacheValid ? cachedEvents.get(eventId) : null;

      // If not in cache, fetch fresh data from all leagues in parallel
      if (!event) {
        const { page, cleanup: sessionCleanup } = await this.initBrowser();
        cleanup = sessionCleanup;
        await this.navigateWithRetry(page, "https://www.etoto.pl", { timeout: 30000, waitUntil: "domcontentloaded" });
        await this.delay(2000);

        // Fetch all leagues in parallel and find the event
        const allEventsPromises = Object.values(CATEGORY_IDS).map(categoryId =>
          this.fetchEventsData(page!, categoryId)
        );
        const allEventsArrays = await Promise.all(allEventsPromises);
        for (const events of allEventsArrays) {
          event = events.find((e: any) => String(e.eventId) === eventId);
          if (event) break;
        }
      }

      if (!event) {
        return this.createMatchDetailNotFoundResult("Event not found in eToto API", Date.now() - startTime);
      }

      // Parse all markets from event
      const { m1X2, mDC, mBTTS, mOU } = this.parseEventMarkets(event);

      // Get team names
      const eventNameParts = event.eventName?.split(" - ") || [];
      const homeTeam = eventNameParts[0]?.trim() || "";
      const awayTeam = eventNameParts[1]?.trim() || "";

      console.log(`[eToto] Parsed match details for: ${homeTeam} vs ${awayTeam}`);
      console.log(`[eToto] Markets: 1X2=${m1X2.home > 0}, DC=${mDC.homeOrDraw > 0}, BTTS=${mBTTS.yes > 0}, O/U lines=${Object.keys(mOU).length}`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data: {
          bookmaker: "etoto",
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

export const etotoScraper = new EtotoPlaywrightScraper();
