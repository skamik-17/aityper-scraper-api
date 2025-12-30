/**
 * TOTALbet Playwright Scraper
 * Uses Network Interception to get odds directly from TOTALbet REST API.
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

// Category IDs for TOTALbet API
const CATEGORY_IDS: Record<string, number> = {
  ekstraklasa: 7023,
  "premier-league": 7124,
  laliga: 7110, // La Liga (correct ID from API categories)
};

// Cache for events data
let cachedEvents: Map<string, any> = new Map();
let cacheTimestamp: number = 0;
const CACHE_TTL = 60000;

export class TotalbetPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "totalbet";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.totalbet, ...config, enabled: true };
  }

  private async fetchEventsData(page: Page, categoryId: number): Promise<any[]> {
    const apiUrl = `https://totalbet.pl/rest/market/categories/multi/${categoryId}/events`;

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
      console.log(`[TOTALbet] Direct fetch failed:`, e);
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

      // 1X2 - gameType 1 (gameName "Wynik meczu")
      if (game.gameType === 1 && (gameName === "wynik meczu" || gameName === "1x2") && outcomes.length === 3 && m1X2.home === 0) {
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
      else if (game.gameType === 98 && (gameName.includes("obie") || gameName.includes("strzel"))) {
        for (const o of outcomes) {
          const name = (o.outcomeName || "").toLowerCase();
          if (name === "tak") mBTTS.yes = o.outcomeOdds;
          else if (name === "nie") mBTTS.no = o.outcomeOdds;
        }
      }
      // Over/Under - gameType 8 (has `argument` field with line value)
      else if (game.gameType === 8 && (gameName.includes("total") || gameName.includes("suma")) && outcomes.length === 2) {
        const lineVal = game.argument;
        if (typeof lineVal === "number" && lineVal % 1 === 0.5) {
          const line = lineVal.toFixed(1);
          if (!mOU[line]) mOU[line] = { over: 0, under: 0 };
          for (const o of outcomes) {
            const name = (o.outcomeName || "").toLowerCase();
            if (name.includes("ponad") || name.includes("powyżej")) {
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
    let sessionCleanup: (() => Promise<void>) | null = null;
    const categoryId = CATEGORY_IDS[league];

    if (!categoryId) {
      return this.createNotFoundResult(`Unknown league: ${league}`, Date.now() - startTime);
    }

    try {
      const { page, cleanup } = await this.initBrowser();
      sessionCleanup = cleanup;

      // Navigate and fetch in one operation to avoid browser closure
      console.log(`[TOTALbet] Fetching data for category: ${categoryId}`);
      await this.navigateWithRetry(page, "https://totalbet.pl", { timeout: 30000, waitUntil: "domcontentloaded" });

      // Fetch events directly via API
      const events = await page.evaluate(async (catId) => {
        try {
          const res = await fetch(`https://totalbet.pl/rest/market/categories/multi/${catId}/events`);
          const data = await res.json();
          return data?.data || [];
        } catch {
          return [];
        }
      }, categoryId);

      // Update cache and process events
      if (events.length > 0) {
        cacheTimestamp = Date.now();
        for (const event of events) {
          cachedEvents.set(String(event.eventId), event);
        }
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
            eventUrl: `https://totalbet.pl/sports/event/${event.eventId}`,
          });
        }

        console.log(`[TOTALbet] Found ${matches.length} matches via API`);
        return {
          status: "success",
          bookmaker: this.bookmaker,
          data: matches,
          duration: Date.now() - startTime,
          timestamp: new Date(),
        };
      }

      return this.createNotFoundResult("Could not fetch TOTALbet API data", Date.now() - startTime);
    } catch (error) {
      return this.createErrorResult(error, Date.now() - startTime);
    } finally {
      if (sessionCleanup) await sessionCleanup();
    }
  }

  async scrapeMatch(match: MatchIdentifier): Promise<ScraperResult> {
    const startTime = Date.now();
    const league = match.leagueId ?? "ekstraklasa";
    const allMatches = await this.scrapeLeague(league);
    if (allMatches.status !== "success" || !allMatches.data) return allMatches;

    const matchResult = findMatchingEvent({ homeTeam: match.homeTeam, awayTeam: match.awayTeam }, allMatches.data, league);
    if (!matchResult) return this.createNotFoundResult(`Match not found on TOTALbet: ${match.homeTeam} vs ${match.awayTeam}`, Date.now() - startTime);

    return { status: "success", bookmaker: this.bookmaker, data: [matchResult.event], duration: Date.now() - startTime, timestamp: new Date() };
  }

  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();
    let sessionCleanup: (() => Promise<void>) | null = null;

    try {
      // Extract event ID from URL
      const eventIdMatch = eventUrl.match(/\/event\/(\d+)/) || eventUrl.match(/\/(\d+)$/);
      if (!eventIdMatch) {
        return this.createMatchDetailNotFoundResult("Invalid TOTALbet event URL", Date.now() - startTime);
      }
      const eventId = eventIdMatch[1];

      // Check cache first
      const isCacheValid = Date.now() - cacheTimestamp < CACHE_TTL;
      let event = isCacheValid ? cachedEvents.get(eventId) : null;

      // If not in cache, fetch fresh data from all leagues
      if (!event) {
        const { page, cleanup } = await this.initBrowser();
        sessionCleanup = cleanup;

        await this.navigateWithRetry(page, "https://totalbet.pl", { timeout: 30000, waitUntil: "domcontentloaded" });

        // Fetch all leagues and find the event
        const categoryIds = Object.values(CATEGORY_IDS);
        for (const categoryId of categoryIds) {
          const events = await page.evaluate(async (catId) => {
            try {
              const res = await fetch(`https://totalbet.pl/rest/market/categories/multi/${catId}/events`);
              const data = await res.json();
              return data?.data || [];
            } catch {
              return [];
            }
          }, categoryId);

          // Update cache
          cacheTimestamp = Date.now();
          for (const e of events) {
            cachedEvents.set(String(e.eventId), e);
          }

          event = events.find((e: any) => String(e.eventId) === eventId);
          if (event) break;
        }
      }

      if (!event) {
        return this.createMatchDetailNotFoundResult("Event not found in TOTALbet API", Date.now() - startTime);
      }

      // Parse all markets from event
      const { m1X2, mDC, mBTTS, mOU } = this.parseEventMarkets(event);

      // Get team names
      const eventNameParts = event.eventName?.split(" - ") || [];
      const homeTeam = eventNameParts[0]?.trim() || "";
      const awayTeam = eventNameParts[1]?.trim() || "";

      console.log(`[TOTALbet] Parsed match details for: ${homeTeam} vs ${awayTeam}`);
      console.log(`[TOTALbet] Markets: 1X2=${m1X2.home > 0}, DC=${mDC.homeOrDraw > 0}, BTTS=${mBTTS.yes > 0}, O/U lines=${Object.keys(mOU).length}`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data: {
          bookmaker: "totalbet",
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
      if (sessionCleanup) await sessionCleanup();
    }
  }

  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    return [];
  }
}

export const totalbetScraper = new TotalbetPlaywrightScraper();
