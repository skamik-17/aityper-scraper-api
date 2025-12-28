/**
 * BETFAN Playwright Scraper
 * Uses Network Interception to get odds directly from BETFAN REST API.
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
  RawScrapedMatchOdds,
  EventUrlEntry,
} from "../../types/scraper.js";
import type { MarketOverUnderOdds } from "../../types/markets.js";
import { DEFAULT_SCRAPER_CONFIGS } from "../../types/scraper.js";
import { PlaywrightScraper } from "../base/playwright-base.js";
import { findMatchingEvent, getCanonicalTeamName } from "../team-matcher.js";

// Category IDs for BETFAN API
const CATEGORY_IDS: Record<string, number> = {
  ekstraklasa: 294,
  "premier-league": 244,
};

// Cache for events data
let cachedEvents: Map<string, any> = new Map();
let cacheTimestamp: number = 0;
const CACHE_TTL = 60000;

export class BetfanPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "betfan";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.betfan, ...config, enabled: true };
  }

  private async fetchEventsData(page: Page, categoryId: number): Promise<any[]> {
    const apiUrl = `https://betfan.pl/api/v1/market/categories/${categoryId}/events`;

    try {
      const response = await page.evaluate(async (url) => {
        const res = await fetch(url);
        return res.json();
      }, apiUrl);

      if (response && response.data && response.data.categories) {
        const events = response.data.categories[0]?.events || [];
        // Update cache
        cacheTimestamp = Date.now();
        for (const event of events) {
          cachedEvents.set(String(event.eventId), event);
        }
        return events;
      }
    } catch (e) {
      console.log(`[BETFAN] Direct fetch failed:`, e);
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

    for (const game of event.games || []) {
      const gameName = (game.gameName || "").toLowerCase();
      const outcomes = game.outcomes || [];

      // 1X2 - gameType 1, gameName "Mecz"
      if (game.gameType === 1 && gameName === "mecz" && outcomes.length === 3 && m1X2.home === 0) {
        const sorted = [...outcomes].sort((a: any, b: any) => a.outcomePosition - b.outcomePosition);
        m1X2.home = sorted[0]?.outcomeOdds || 0;
        m1X2.draw = sorted[1]?.outcomeOdds || 0;
        m1X2.away = sorted[2]?.outcomeOdds || 0;
      }
      // Double Chance - gameType 4
      else if (game.gameType === 4 && gameName.includes("szansa") && outcomes.length === 3) {
        for (const o of outcomes) {
          const name = (o.outcomeName || "").toLowerCase();
          if (name === "1x") mDC.homeOrDraw = o.outcomeOdds;
          else if (name === "x2") mDC.drawOrAway = o.outcomeOdds;
          else if (name === "12") mDC.homeOrAway = o.outcomeOdds;
        }
      }
      // BTTS - gameType 98
      else if (game.gameType === 98 && gameName.includes("obie") && gameName.includes("strzelą")) {
        for (const o of outcomes) {
          const name = (o.outcomeName || "").toLowerCase();
          if (name === "tak") mBTTS.yes = o.outcomeOdds;
          else if (name === "nie") mBTTS.no = o.outcomeOdds;
        }
      }
      // Over/Under - gameType 8
      else if (game.gameType === 8 && gameName === "liczba goli" && outcomes.length === 2) {
        for (const o of outcomes) {
          const name = (o.outcomeName || "").toLowerCase();
          const lineMatch = name.match(/(\d+[.,]?\d*)/);
          if (lineMatch) {
            const lineVal = parseFloat(lineMatch[1].replace(",", "."));
            if (lineVal % 1 === 0.5) {
              const line = lineVal.toFixed(1);
              if (!mOU[line]) mOU[line] = { over: 0, under: 0 };
              if (name.includes("powyżej")) {
                mOU[line].over = o.outcomeOdds;
              } else if (name.includes("poniżej")) {
                mOU[line].under = o.outcomeOdds;
              }
            }
          }
        }
      }
    }

    return { m1X2, mDC, mBTTS, mOU };
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();
    let page: Page | null = null;
    const categoryId = CATEGORY_IDS[league];

    if (!categoryId) {
      return this.createNotFoundResult(`Unknown league: ${league}`, Date.now() - startTime);
    }

    try {
      page = await this.initBrowser();

      // Go to betfan to establish session
      console.log(`[BETFAN] Fetching data for category: ${categoryId}`);
      await this.navigateWithRetry(page, "https://betfan.pl", { timeout: 30000, waitUntil: "domcontentloaded" });
      await this.delay(2000);

      // Fetch events data
      const events = await this.fetchEventsData(page, categoryId);

      if (events.length > 0) {
        const matches: RawScrapedOdds[] = [];

        for (const event of events) {
          // Get team names from participants
          const homePart = event.participants?.find((p: any) => p.number === 1);
          const awayPart = event.participants?.find((p: any) => p.number === 2);
          const homeTeamName = homePart?.participantName || "";
          const awayTeamName = awayPart?.participantName || "";

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
            eventUrl: `https://betfan.pl/wydarzenie/${event.eventId}`,
          });
        }

        console.log(`[BETFAN] Found ${matches.length} matches via API`);
        return {
          status: "success",
          bookmaker: this.bookmaker,
          data: matches,
          duration: Date.now() - startTime,
          timestamp: new Date(),
        };
      }

      return this.createNotFoundResult("Could not fetch BETFAN API data", Date.now() - startTime);
    } catch (error) {
      return this.createErrorResult(error, Date.now() - startTime);
    } finally {
      if (page) await page.close();
    }
  }

  async scrapeMatch(match: MatchIdentifier): Promise<ScraperResult> {
    const startTime = Date.now();
    const league = match.leagueId ?? "ekstraklasa";
    const allMatches = await this.scrapeLeague(league);
    if (allMatches.status !== "success" || !allMatches.data) return allMatches;

    const matchResult = findMatchingEvent({ homeTeam: match.homeTeam, awayTeam: match.awayTeam }, allMatches.data, league);
    if (!matchResult) return this.createNotFoundResult(`Match not found on BETFAN: ${match.homeTeam} vs ${match.awayTeam}`, Date.now() - startTime);

    return { status: "success", bookmaker: this.bookmaker, data: [matchResult.event], duration: Date.now() - startTime, timestamp: new Date() };
  }

  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();
    let page: Page | null = null;

    try {
      // Extract event ID from URL
      const eventIdMatch = eventUrl.match(/\/wydarzenie\/(\d+)/);
      if (!eventIdMatch) {
        return this.createMatchDetailNotFoundResult("Invalid BETFAN event URL", Date.now() - startTime);
      }
      const eventId = eventIdMatch[1];

      // Check cache first
      const isCacheValid = Date.now() - cacheTimestamp < CACHE_TTL;
      let event = isCacheValid ? cachedEvents.get(eventId) : null;

      // If not in cache, fetch fresh data
      if (!event) {
        page = await this.initBrowser();
        await this.navigateWithRetry(page, "https://betfan.pl", { timeout: 30000, waitUntil: "domcontentloaded" });
        await this.delay(2000);

        // Try to find which league this event belongs to
        for (const [, categoryId] of Object.entries(CATEGORY_IDS)) {
          const events = await this.fetchEventsData(page, categoryId);
          event = events.find((e: any) => String(e.eventId) === eventId);
          if (event) break;
        }
      }

      if (!event) {
        return this.createMatchDetailNotFoundResult("Event not found in BETFAN API", Date.now() - startTime);
      }

      // Parse all markets from event
      const { m1X2, mDC, mBTTS, mOU } = this.parseEventMarkets(event);

      // Get team names
      const homePart = event.participants?.find((p: any) => p.number === 1);
      const awayPart = event.participants?.find((p: any) => p.number === 2);
      const homeTeam = homePart?.participantName || "";
      const awayTeam = awayPart?.participantName || "";

      console.log(`[BETFAN] Parsed match details for: ${homeTeam} vs ${awayTeam}`);
      console.log(`[BETFAN] Markets: 1X2=${m1X2.home > 0}, DC=${mDC.homeOrDraw > 0}, BTTS=${mBTTS.yes > 0}, O/U lines=${Object.keys(mOU).length}`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data: {
          bookmaker: "betfan",
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
      if (page) await page.close();
    }
  }

  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    return [];
  }
}

export const betfanScraper = new BetfanPlaywrightScraper();
