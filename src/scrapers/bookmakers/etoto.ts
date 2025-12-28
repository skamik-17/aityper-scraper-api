/**
 * eToto Playwright Scraper
 * Scrapes odds from etoto.pl using headless Chromium
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

// League URLs for eToto
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: "https://www.etoto.pl/zaklady-bukmacherskie/pilka-nozna/polska/ekstraklasa/666",
  "premier-league": "https://www.etoto.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/206",
};

export class EtotoPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "etoto";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.etoto, ...config, enabled: true };
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();
    let page: Page | null = null;
    const url = LEAGUE_URLS[league];
    if (!url) return this.createNotFoundResult(`Unknown league: ${league}`, Date.now() - startTime);

    try {
      page = await this.initBrowser();
      await this.navigateWithRetry(page, url, { timeout: 30000, waitUntil: "domcontentloaded" });
      await this.delay(3000);

      // Handle cookies
      try {
        const cookieBtn = page.locator("button:has-text('Zezwól na wszystkie'), button:has-text('Akceptuję')").first();
        if (await cookieBtn.isVisible({ timeout: 5000 })) {
          await cookieBtn.click();
          await this.delay(1000);
        }
      } catch {}

      await page.setViewportSize({ width: 1920, height: 5000 });
      await this.delay(2000);

      const hasMatches = await this.waitForSelector(page, "a[href*='/zaklady-bukmacherskie/']", 15000);
      if (!hasMatches) return this.createNotFoundResult(`No ${league} matches found on page`, Date.now() - startTime);

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
    if (!matchResult) return this.createNotFoundResult(`Match not found on eToto: ${match.homeTeam} vs ${match.awayTeam}`, Date.now() - startTime);

    return { status: "success", bookmaker: this.bookmaker, data: [matchResult.event], duration: Date.now() - startTime, timestamp: new Date() };
  }

  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();
    let page: Page | null = null;
    try {
      page = await this.initBrowser();
      await this.navigateWithRetry(page, eventUrl, { timeout: 30000, waitUntil: "domcontentloaded" });
      await this.delay(4000);

      const hasOdds = await this.waitForSelector(page, "button", 10000);
      if (!hasOdds) return this.createMatchDetailNotFoundResult("No odds found", Date.now() - startTime);

      const matchData = await this.extractMatchDetailData(page, eventUrl);
      if (!matchData) return this.createMatchDetailNotFoundResult("Could not parse data", Date.now() - startTime);

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
      document.querySelectorAll("a[href*='/zaklady-bukmacherskie/']").forEach((link: any) => {
        const text = link.innerText.replace(/\n/g, " ");
        const teamMatch = text.match(/([A-ZĄąĆćĘęŁłŃńÓóŚśŹźŻż][^-\n]+)\s*[-–]\s*([A-ZĄąĆćĘęŁłŃńÓóŚśŹźŻż][^-\n]+)/);
        if (teamMatch && !/(boost|promo|banner|polecane|bonus|akcja)/i.test(link.href)) {
          const h = teamMatch[1].trim();
          const a = teamMatch[2].trim();
          if (h.length > 2 && a.length > 2) {
            entries.push({ matchKey: `${h} vs ${a}`, eventUrl: link.href });
          }
        }
      });
      return entries;
    });
  }

  private async extractMatchDetailData(page: Page, eventUrl: string): Promise<RawScrapedMatchOdds | null> {
    const data = await page.evaluate(() => {
      let hTeam = "", aTeam = "";
      const h1 = document.querySelector("h1")?.innerText || "";
      const h1Match = h1.match(/(.+?)\s*[-–vs.]+\s*(.+)/i);
      if (h1Match) { hTeam = h1Match[1].trim(); aTeam = h1Match[2].trim(); }
      if (!hTeam) return null;

      const m1X2 = { home: 0, draw: 0, away: 0 };
      const mDC = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
      const mOU: Record<string, { over: number; under: number }> = {};
      const mBTTS = { yes: 0, no: 0 };

      document.querySelectorAll("button").forEach((btn: any) => {
        const fullText = btn.innerText.replace(/\n/g, " ").toLowerCase();
        const valMatch = fullText.match(/(\d+[.,]\d+)/);
        const val = valMatch ? parseFloat(valMatch[1].replace(",", ".")) : 0;
        if (isNaN(val) || val <= 1) return;

        const label = fullText.replace(/(\d+[.,]\d+)/, "").trim();

        if (label === "1" || label === hTeam.toLowerCase()) m1X2.home = val;
        else if (label === "x" || label === "remis") m1X2.draw = val;
        else if (label === "2" || label === aTeam.toLowerCase()) m1X2.away = val;
        else if (label === "1x") mDC.homeOrDraw = val;
        else if (label === "x2") mDC.drawOrAway = val;
        else if (label === "12") mDC.homeOrAway = val;
        else if (label === "tak" || label.includes("tak")) mBTTS.yes = val;
        else if (label === "nie" || label.includes("nie")) mBTTS.no = val;

        const ouM = label.match(/(powyżej|poniżej|over|under|ponad)\s*(\d+[.,]5)/i);
        if (ouM) {
          const line = parseFloat(ouM[2].replace(",", ".")).toFixed(1);
          if (!mOU[line]) mOU[line] = { over: 0, under: 0 };
          if (ouM[1].includes("powyżej") || ouM[1] === "over" || ouM[1] === "ponad") mOU[line].over = val;
          else mOU[line].under = val;
        }
      });

      return { homeTeam: hTeam, awayTeam: aTeam, market1X2: m1X2, marketDoubleChance: mDC, marketOverUnder: mOU, marketBTTS: mBTTS };
    });

    if (!data) return null;
    return {
      bookmaker: "etoto", eventName: `${data.homeTeam} - ${data.awayTeam}`, homeTeam: data.homeTeam, awayTeam: data.awayTeam,
      eventUrl, hasNoTaxPromo: false, scrapedAt: new Date(),
      market1X2: data.market1X2,
      marketDoubleChance: data.marketDoubleChance.homeOrDraw > 0 ? data.marketDoubleChance : undefined,
      marketOverUnder: Object.keys(data.marketOverUnder).length > 0 ? data.marketOverUnder as Record<string, MarketOverUnderOdds> : undefined,
      marketBTTS: data.marketBTTS.yes > 0 ? data.marketBTTS : undefined,
    };
  }

  private async extractMatchData(page: Page, league: string): Promise<RawScrapedOdds[]> {
    const matchData = await page.evaluate(() => {
      const matches: any[] = [];
      const links = Array.from(document.querySelectorAll("a[href*='/zaklady-bukmacherskie/']"));
      
      links.forEach((link: any) => {
        const text = link.innerText.replace(/\n/g, " ");
        const teamMatch = text.match(/([A-ZĄąĆćĘęŁłŃńÓóŚśŹźŻż][^-\n]+)\s*[-–]\s*([A-ZĄąĆćĘęŁłŃńÓóŚśŹźŻż][^-\n]+)/);
        if (!teamMatch || /(boost|promo|banner|polecane|bonus|akcja)/i.test(link.href)) return;
        
        const h = teamMatch[1].trim();
        const a = teamMatch[2].trim();
        if (h.length < 3 || a.length < 3) return;

        // Find parent container to get odds
        let parent = link.parentElement;
        for (let i = 0; i < 5; i++) {
          if (!parent) break;
          const buttons = parent.querySelectorAll("button");
          if (buttons.length >= 3) {
            const odds = Array.from(buttons).map(b => {
              const m = b.innerText.match(/(\d+[.,]\d+)/);
              return m ? parseFloat(m[1].replace(",", ".")) : 0;
            }).filter(o => o > 1);
            if (odds.length >= 3) {
              matches.push({ h, a, homeOdds: odds[0], drawOdds: odds[1], awayOdds: odds[2], eventUrl: link.href });
              return;
            }
          }
          parent = parent.parentElement;
        }
      });
      return matches;
    });

    return matchData.map(m => ({
      bookmaker: "etoto", eventName: `${m.h} - ${m.a}`, homeTeam: getCanonicalTeamName(m.h, league), awayTeam: getCanonicalTeamName(m.a, league),
      homeOdds: m.homeOdds, drawOdds: m.drawOdds, awayOdds: m.awayOdds, hasNoTaxPromo: false, scrapedAt: new Date(), eventUrl: m.eventUrl
    }));
  }
}

export const etotoScraper = new EtotoPlaywrightScraper();
