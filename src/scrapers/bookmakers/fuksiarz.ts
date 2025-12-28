/**
 * Fuksiarz Playwright Scraper
 * Scrapes odds from fuksiarz.pl using headless Chromium
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

// League URLs for Fuksiarz
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: "https://fuksiarz.pl/zaklady-bukmacherskie/pilka-nozna/polska/ekstraklasa",
  "premier-league": "https://fuksiarz.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league",
};

export class FuksiarzPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "fuksiarz";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.fuksiarz, ...config, enabled: true };
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();
    let page: Page | null = null;
    const url = LEAGUE_URLS[league];
    if (!url) return this.createNotFoundResult(`Unknown league: ${league}`, Date.now() - startTime);

    try {
      page = await this.initBrowser();
      await this.navigateWithRetry(page, url, { timeout: 30000, waitUntil: "domcontentloaded" });
      await this.delay(5000);

      const hasEvents = await this.waitForSelector(page, ".event-tile, [class*='eventTile'], a[href*='/szczegoly/']", 15000);
      if (!hasEvents) return this.createNotFoundResult(`No matches found for ${league}`, Date.now() - startTime);

      const data = await this.extractMatchData(page, league);
      return { status: "success", bookmaker: this.bookmaker, data, duration: Date.now() - startTime, timestamp: new Date() };
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
    if (!matchResult) return this.createNotFoundResult(`Match not found on Fuksiarz: ${match.homeTeam} vs ${match.awayTeam}`, Date.now() - startTime);

    return { status: "success", bookmaker: this.bookmaker, data: [matchResult.event], duration: Date.now() - startTime, timestamp: new Date() };
  }

  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();
    let page: Page | null = null;
    try {
      page = await this.initBrowser();
      await page.setViewportSize({ width: 1920, height: 5000 });
      await this.navigateWithRetry(page, eventUrl, { timeout: 45000, waitUntil: "domcontentloaded" });
      await this.delay(8000);

      const matchData = await this.extractMatchDetailData(page, eventUrl);
      if (!matchData || matchData.market1X2.home === 0) return this.createMatchDetailNotFoundResult("Could not parse data", Date.now() - startTime);

      return { status: "success", bookmaker: this.bookmaker, data: matchData, duration: Date.now() - startTime, timestamp: new Date() };
    } catch (error) {
      return this.createMatchDetailErrorResult(error, Date.now() - startTime);
    } finally {
      if (page) await page.close();
    }
  }

  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    return page.evaluate(() => {
      const entries: EventUrlEntry[] = [];
      const seen = new Set();
      document.querySelectorAll("a[href*='/szczegoly/']").forEach((link: any) => {
        const text = link.innerText.replace(/\n/g, " ");
        const teamMatch = text.match(/([A-ZĄąĆćĘęŁłŃńÓóŚśŹźŻż][^-\n]+)\s*[-–]\s*([A-ZĄąĆćĘęŁłŃńÓóŚśŹźŻż][^-\n]+)/);
        if (teamMatch) {
          const key = `${teamMatch[1].trim()} vs ${teamMatch[2].trim()}`;
          if (!seen.has(key)) {
            seen.add(key);
            entries.push({ matchKey: key, eventUrl: link.href });
          }
        }
      });
      return entries;
    });
  }

  private async extractMatchDetailData(page: Page, eventUrl: string): Promise<RawScrapedMatchOdds | null> {
    const data = await page.evaluate(() => {
      let hT = "", aT = "";
      const h1 = document.querySelector("h1");
      if (h1) {
        const m = h1.innerText.match(/(.+?)\s*[-–]\s*(.+)/);
        if (m) { hT = m[1].trim(); aT = m[2].trim(); } 
      }
      if (!hT) return null;

      const m1X2 = { home: 0, draw: 0, away: 0 };
      const mDC = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
      const mBTTS = { yes: 0, no: 0 };
      const mOU: Record<string, { over: number; under: number }> = {};

      const sections = document.querySelectorAll(".market-row, [class*='market'], .event-details-market");
      sections.forEach((sec: any) => {
        const text = sec.innerText.replace(/\n/g, " ").toLowerCase();
        const btns = Array.from(sec.querySelectorAll("button, .odds-button"));
        
        if ((text.includes("wynik") || text.includes("mecz")) && btns.length === 3 && m1X2.home === 0) {
          const vals = btns.map((b: any) => parseFloat(b.innerText.match(/(\d+[.,]\d+)/)?.[1]?.replace(",", ".") || "0"));
          if (vals[0] > 1) { m1X2.home = vals[0]; m1X2.draw = vals[1]; m1X2.away = vals[2]; }
        }
        else if (text.includes("szansa") && btns.length === 3) {
          const vals = btns.map((b: any) => parseFloat(b.innerText.match(/(\d+[.,]\d+)/)?.[1]?.replace(",", ".") || "0"));
          if (vals[0] > 1) { mDC.homeOrDraw = vals[0]; mDC.homeOrAway = vals[1]; mDC.drawOrAway = vals[2]; }
        }
        else if (text.includes("obie") && text.includes("strzelą")) {
          const vals = btns.map((b: any) => parseFloat(b.innerText.match(/(\d+[.,]\d+)/)?.[1]?.replace(",", ".") || "0"));
          if (vals[0] > 1) { mBTTS.yes = vals[0]; mBTTS.no = vals[1]; }
        }
        else if (text.includes("liczba goli")) {
          const lineM = text.match(/(\d+[.,]5)/);
          if (lineM && btns.length === 2) {
            const line = parseFloat(lineM[1].replace(",", ".")).toFixed(1);
            const vals = btns.map((b: any) => parseFloat(b.innerText.match(/(\d+[.,]\d+)/)?.[1]?.replace(",", ".") || "0"));
            if (vals[0] > 1 && vals[1] > 1) {
              mOU[line] = { under: vals[0], over: vals[1] };
            }
          }
        }
      });

      return { homeTeam: hT, awayTeam: aT, market1X2: m1X2, marketDoubleChance: mDC, marketBTTS: mBTTS, marketOverUnder: mOU };
    });

    if (!data) return null;
    return {
      bookmaker: "fuksiarz", eventName: `${data.homeTeam} - ${data.awayTeam}`, homeTeam: data.homeTeam, awayTeam: data.awayTeam,
      eventUrl, hasNoTaxPromo: false, scrapedAt: new Date(),
      market1X2: data.market1X2,
      marketDoubleChance: data.marketDoubleChance.homeOrDraw > 0 ? data.marketDoubleChance : undefined,
      marketBTTS: data.marketBTTS.yes > 0 ? data.marketBTTS : undefined,
      marketOverUnder: Object.keys(data.marketOverUnder).length > 0 ? data.marketOverUnder as Record<string, MarketOverUnderOdds> : undefined,
    };
  }

  private async extractMatchData(page: Page, league: string): Promise<RawScrapedOdds[]> {
    const matchData = await page.evaluate(() => {
      const matches: any[] = [];
      const seen = new Set();
      document.querySelectorAll("a[href*='/szczegoly/']").forEach((link: any) => {
        const text = link.innerText.replace(/\n/g, " ");
        const teamMatch = text.match(/([A-ZĄąĆćĘęŁłŃńÓóŚśŹźŻż][^-\n]+)\s*[-–]\s*([A-ZĄąĆćĘęŁłŃńÓóŚśŹźŻż][^-\n]+)/);
        if (!teamMatch) return;
        
        const h = teamMatch[1].trim();
        const a = teamMatch[2].trim();
        const key = `${h} vs ${a}`;
        if (seen.has(key)) return;

        // Try to find odds in nearby buttons
        let parent = link.parentElement;
        for (let i = 0; i < 4; i++) {
          if (!parent) break;
          const btns = Array.from(parent.querySelectorAll("button, .odds-button"));
          if (btns.length >= 3) {
            const odds = btns.map((b: any) => parseFloat(b.innerText.match(/(\d+[.,]\d+)/)?.[1]?.replace(",", ".") || "0")).filter(o => o > 1);
            if (odds.length >= 3) {
              seen.add(key);
              matches.push({ h, a, homeOdds: odds[0], drawOdds: odds[1], awayOdds: odds[2], url: link.href });
              return;
            }
          }
          parent = parent.parentElement;
        }
      });
      return matches;
    });

    return matchData.map(m => ({
      bookmaker: "fuksiarz", eventName: `${m.h} - ${m.a}`, homeTeam: getCanonicalTeamName(m.h, league), awayTeam: getCanonicalTeamName(m.a, league),
      homeOdds: m.homeOdds, drawOdds: m.drawOdds, awayOdds: m.awayOdds, hasNoTaxPromo: false, scrapedAt: new Date(), eventUrl: m.url
    }));
  }
}

export const fuksiarzScraper = new FuksiarzPlaywrightScraper();