/**
 * Superbet Playwright Scraper
 * Uses Network Interception to get odds directly from Superbet API.
 */

import type { Page, Response } from "playwright";
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

export class SuperbetPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "superbet";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.superbet, ...config, enabled: true };
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();
    let page: Page | null = null;
    const url = LEAGUE_URLS[league];
    if (!url) return this.createNotFoundResult(`Unknown league: ${league}`, Date.now() - startTime);

    try {
      page = await this.initBrowser();
      
      let apiData: any = null;
      page.on("response", async (response: Response) => {
        const reqUrl = response.url();
        if (reqUrl.includes("/events/by-date") && reqUrl.includes("tournamentIds=")) {
          try { 
            const json = await response.json();
            if (json && json.data) apiData = json;
          } catch {}
        }
      });

      console.log(`[Superbet] Navigating to league: ${url}`);
      // Use domcontentloaded + manual wait to be faster than networkidle
      await this.navigateWithRetry(page, url, { timeout: 60000, waitUntil: "domcontentloaded" });
      
      // Wait for API data to be captured (polling)
      for (let i = 0; i < 15; i++) {
        if (apiData) break;
        await this.delay(1000);
      }

      if (apiData && apiData.data) {
        const matches: RawScrapedOdds[] = apiData.data.map((m: any) => {
          const mainOdds = m.odds?.filter((o: any) => o.marketId === 547) || [];
          const home = mainOdds.find((o: any) => o.code === "1")?.price || 0;
          const draw = mainOdds.find((o: any) => o.code === "0")?.price || 0;
          const away = mainOdds.find((o: any) => o.code === "2")?.price || 0;
          
          const teams = m.matchName.split('·');
          const hName = teams[0] || "";
          const aName = teams[1] || "";

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
            eventUrl: `https://superbet.pl/kursy/pilka-nozna/${m.matchName.replace(/·/g, '-vs-').toLowerCase()}-${m.eventId}`
          };
        }).filter((m: any) => m.homeOdds > 0);

        console.log(`[Superbet] Found ${matches.length} matches via API`);
        return { status: "success", bookmaker: this.bookmaker, data: matches, duration: Date.now() - startTime, timestamp: new Date() };
      }

      return this.createNotFoundResult("Could not capture Superbet API data", Date.now() - startTime);
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
    if (!matchResult) return this.createNotFoundResult(`Match not found on Superbet: ${match.homeTeam} vs ${match.awayTeam}`, Date.now() - startTime);

    return { status: "success", bookmaker: this.bookmaker, data: [matchResult.event], duration: Date.now() - startTime, timestamp: new Date() };
  }

  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();
    let page: Page | null = null;
    try {
      page = await this.initBrowser();
      await page.setViewportSize({ width: 1920, height: 5000 });
      
      let detailApiData: any = null;
      page.on("response", async (response: Response) => {
        const reqUrl = response.url();
        if (reqUrl.includes("/events/") && reqUrl.match(/\/events\/\d+$/)) {
          try { 
            const json = await response.json();
            if (json && json.data) detailApiData = json;
          } catch {}
        }
      });

      console.log(`[Superbet] Navigating to details: ${eventUrl}`);
      await this.navigateWithRetry(page, eventUrl, { timeout: 60000, waitUntil: "domcontentloaded" });
      
      // Wait for API data (polling)
      for (let i = 0; i < 15; i++) {
        if (detailApiData) break;
        await this.delay(1000);
      }

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
      if (page) await page.close();
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
