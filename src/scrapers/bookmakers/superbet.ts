/**
 * Superbet Playwright Scraper
 * Uses Network Interception to get odds directly from Superbet API.
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

// League URLs for Superbet
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: "https://www.superbet.pl/zaklady-bukmacherskie/pilka-nozna/polska/ekstraklasa",
  "premier-league": "https://www.superbet.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league",
};

// Tournament IDs for Superbet API (found from network inspection)
const TOURNAMENT_IDS: Record<string, number[]> = {
  ekstraklasa: [644], // Ekstraklasa (updated Dec 2025)
  "premier-league": [106], // Premier League
};

export class SuperbetPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "superbet";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.superbet, ...config, enabled: true };
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();
    let cleanup: (() => Promise<void>) | null = null;
    const url = LEAGUE_URLS[league];
    const tournamentIds = TOURNAMENT_IDS[league];
    if (!url || !tournamentIds) return this.createNotFoundResult(`Unknown league: ${league}`, Date.now() - startTime);

    try {
      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      // Navigate to establish session cookies
      console.log(`[Superbet] Navigating to: ${url}`);
      await this.navigateWithRetry(page, url, { timeout: 30000, waitUntil: "domcontentloaded" });

      // Fetch events directly via API
      const tournamentId = tournamentIds[0];
      const apiData = await page.evaluate(async (tid: number) => {
        try {
          const today = new Date().toISOString().split('T')[0];
          const apiUrl = `https://production-superbet-offer-pl.freetls.fastly.net/v2/pl-PL/events/by-date?offerState=prematch&startDate=${today}+00:00:00&endDate=2027-12-30+00:00:00&sportId=5&tournamentIds=${tid}`;
          const res = await fetch(apiUrl);
          const json = await res.json();
          return json;
        } catch {
          return null;
        }
      }, tournamentId);

      if (apiData && apiData.data && apiData.data.length > 0) {
        console.log(`[Superbet] Captured ${apiData.data.length} events from API`);
        const matches: RawScrapedOdds[] = apiData.data.map((m: any) => {
          const mainOdds = m.odds?.filter((o: any) => o.marketId === 547) || [];
          const home = mainOdds.find((o: any) => o.code === "1")?.price || 0;
          const draw = mainOdds.find((o: any) => o.code === "0")?.price || 0;
          const away = mainOdds.find((o: any) => o.code === "2")?.price || 0;

          const teams = (m.matchName || "").split('·');
          const hName = (teams[0] || "").trim();
          const aName = (teams[1] || "").trim();

          return {
            bookmaker: this.bookmaker,
            eventName: `${hName} - ${aName}`,
            homeTeam: getCanonicalTeamName(hName, league),
            awayTeam: getCanonicalTeamName(aName, league),
            homeOdds: home,
            drawOdds: draw,
            awayOdds: away,
            hasNoTaxPromo: false,
            scrapedAt: new Date(),
            eventUrl: `https://superbet.pl/zaklady-bukmacherskie/pilka-nozna/${m.eventId}`
          };
        }).filter((m: any) => m.homeOdds > 0);

        console.log(`[Superbet] Found ${matches.length} matches via API`);
        return { status: "success", bookmaker: this.bookmaker, data: matches, duration: Date.now() - startTime, timestamp: new Date() };
      }

      return this.createNotFoundResult("Could not capture Superbet API data", Date.now() - startTime);
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
    if (!matchResult) return this.createNotFoundResult(`Match not found on Superbet: ${match.homeTeam} vs ${match.awayTeam}`, Date.now() - startTime);

    return { status: "success", bookmaker: this.bookmaker, data: [matchResult.event], duration: Date.now() - startTime, timestamp: new Date() };
  }

  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();
    let cleanup: (() => Promise<void>) | null = null;
    try {
      // Extract event ID from URL
      const eventIdMatch = eventUrl.match(/\/(\d+)$/);
      if (!eventIdMatch) {
        return this.createMatchDetailNotFoundResult("Invalid Superbet event URL", Date.now() - startTime);
      }
      const eventId = eventIdMatch[1];

      const { page, cleanup: sessionCleanup } = await this.initBrowser();
      cleanup = sessionCleanup;

      // Navigate to establish session
      console.log(`[Superbet] Fetching details for event: ${eventId}`);
      await this.navigateWithRetry(page, "https://www.superbet.pl", { timeout: 30000, waitUntil: "domcontentloaded" });

      // Fetch event details directly via API
      const detailApiData = await page.evaluate(async (eid: string) => {
        try {
          const apiUrl = `https://production-superbet-offer-pl.freetls.fastly.net/v2/pl-PL/events/${eid}`;
          const res = await fetch(apiUrl);
          const json = await res.json();
          return json;
        } catch {
          return null;
        }
      }, eventId);

      if (detailApiData && detailApiData.data && detailApiData.data.length > 0) {
        const matchInfo = detailApiData.data[0];
        const odds = matchInfo.odds || [];
        const m1X2 = { home: 0, draw: 0, away: 0 };
        const mDC = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
        const mBTTS = { yes: 0, no: 0 };
        const mOU: Record<string, MarketOverUnderOdds> = {};

        odds.forEach((o: any) => {
          const p = o.price || 0;
          if (o.marketId === 547) {
            if (o.code === "1") m1X2.home = p;
            else if (o.code === "0") m1X2.draw = p;
            else if (o.code === "2") m1X2.away = p;
          }
          else if (o.marketId === 548 || o.marketId === 531) {
            if (o.code === "10" || o.code === "1X") mDC.homeOrDraw = p;
            else if (o.code === "02" || o.code === "X2") mDC.drawOrAway = p;
            else if (o.code === "12") mDC.homeOrAway = p;
          }
          else if (o.marketId === 539 || o.marketId === 559) {
            if (o.code === "1" || o.code === "GG" || o.name?.toLowerCase().includes("tak")) mBTTS.yes = p;
            else if (o.code === "2" || o.code === "NG" || o.name?.toLowerCase().includes("nie")) mBTTS.no = p;
          }
          else if (o.marketId === 200734 || o.marketId === 551 || o.marketId === 552) {
            const line = o.specialBetValue;
            if (line && line.includes('.')) {
              const lineStr = parseFloat(line).toFixed(1);
              if (!mOU[lineStr]) mOU[lineStr] = { over: 0, under: 0 };
              if (o.code === "O" || o.name?.toLowerCase().includes("powyżej")) mOU[lineStr].over = p;
              else if (o.code === "U" || o.name?.toLowerCase().includes("poniżej")) mOU[lineStr].under = p;
            }
          }
        });

        const teams = (matchInfo.matchName || "").split('·');
        return {
          status: "success",
          bookmaker: this.bookmaker,
          data: {
            bookmaker: "superbet",
            eventName: matchInfo.matchName || "",
            homeTeam: teams[0] || "",
            awayTeam: teams[1] || "",
            eventUrl,
            hasNoTaxPromo: false,
            scrapedAt: new Date(),
            market1X2: m1X2,
            marketDoubleChance: mDC.homeOrDraw > 0 ? mDC : undefined,
            marketBTTS: mBTTS.yes > 0 ? mBTTS : undefined,
            marketOverUnder: Object.keys(mOU).length > 0 ? mOU : undefined
          },
          duration: Date.now() - startTime,
          timestamp: new Date()
        };
      }

      return this.createMatchDetailNotFoundResult("Could not capture Superbet detail API data", Date.now() - startTime);
    } catch (error) {
      return this.createMatchDetailErrorResult(error, Date.now() - startTime);
    } finally {
      if (cleanup) await cleanup();
    }
  }

  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    return [];
  }

  private async extractMatchData(page: Page, league: string): Promise<RawScrapedOdds[]> {
    return [];
  }
}

export const superbetScraper = new SuperbetPlaywrightScraper();
