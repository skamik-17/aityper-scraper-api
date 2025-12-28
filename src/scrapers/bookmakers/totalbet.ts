/**
 * TOTALbet Playwright Scraper
 * Scrapes odds from totalbet.pl using headless Chromium
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

// League URLs for TOTALbet
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: "https://totalbet.pl/sports/events/Pi%C5%82ka-no%C5%BCna/7023?uncheckAll=true",
  "premier-league": "https://totalbet.pl/sports/events/Pi%C5%82ka-no%C5%BCna/7124?uncheckAll=true",
};

// CSS selectors for TOTALbet
const SELECTORS = {
  matchCard: "li.eventListPeriodItemPartial, [class*='eventListPeriodItem']",
  eventName: "span.event-name, .name, [class*='eventName']",
  oddsButton: "button.outcomeButtonPartial.btn-odd, button.btn-odd",
  marketOddsLabel: ".btn-odd__label, .outcome-name",
};

export class TotalbetPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "totalbet";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.totalbet, ...config, enabled: true };
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();
    let page: Page | null = null;
    const url = LEAGUE_URLS[league];
    if (!url) return this.createNotFoundResult(`Unknown league: ${league}`, Date.now() - startTime);

    try {
      page = await this.initBrowser();
      await this.navigateWithRetry(page, url, { timeout: 30000, waitUntil: "domcontentloaded" });
      await this.delay(4000);

      const hasMatches = await this.waitForSelector(page, SELECTORS.matchCard, 15000);
      if (!hasMatches) return this.createNotFoundResult(`No matches found for ${league}`, Date.now() - startTime);

      const data = await this.extractMatchData(page, league);
      console.log(`[TOTALbet] Scraped ${data.length} matches for ${league}`);
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
    if (!matchResult) return this.createNotFoundResult(`Match not found: ${match.homeTeam} vs ${match.awayTeam}`, Date.now() - startTime);

    return { status: "success", bookmaker: this.bookmaker, data: [matchResult.event], duration: Date.now() - startTime, timestamp: new Date() };
  }

  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();
    let page: Page | null = null;
    try {
      page = await this.initBrowser();
      await this.navigateWithRetry(page, eventUrl, { timeout: 30000, waitUntil: "domcontentloaded" });
      await this.delay(4000);

      const hasOdds = await this.waitForSelector(page, SELECTORS.oddsButton, 10000);
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
    return page.evaluate((selectors) => {
      const entries: EventUrlEntry[] = [];
      document.querySelectorAll(selectors.matchCard).forEach((card) => {
        const nameText = card.querySelector(selectors.eventName)?.textContent?.trim() || "";
        const teamMatch = nameText.match(/^(.+?)\s*-\s*(.+)$/);
        if (!teamMatch) return;
        
        const eventId = (card as HTMLElement).dataset.eventId || "";
        let eventUrl = "";
        if (eventId) eventUrl = `https://totalbet.pl/sports/event/${eventId}`;
        else {
          const link = card.querySelector("a[href*='/sports/event/']") as HTMLAnchorElement;
          if (link?.href) eventUrl = link.href;
        }
        
        if (eventUrl) entries.push({ matchKey: `${teamMatch[1].trim()} vs ${teamMatch[2].trim()}`, eventUrl });
      });
      return entries;
    }, SELECTORS);
  }

  private async extractMatchDetailData(page: Page, eventUrl: string): Promise<RawScrapedMatchOdds | null> {
    const data = await page.evaluate((selectors) => {
      let hTeam = "", aTeam = "";
      const nameEl = document.querySelector(selectors.eventName);
      if (nameEl) {
        const teamMatch = nameEl.textContent?.trim()?.match(/^(.+?)\s*-\s*(.+)$/);
        if (teamMatch) { hTeam = teamMatch[1].trim(); aTeam = teamMatch[2].trim(); }
      }
      if (!hTeam) {
        const h1 = document.querySelector("h1")?.innerText;
        const teamMatch = h1?.match(/^(.+?)\s*[-–vs.]+\s*(.+)$/i);
        if (teamMatch) { hTeam = teamMatch[1].trim(); aTeam = teamMatch[2].trim(); }
      }
      if (!hTeam) return null;

      const m1X2 = { home: 0, draw: 0, away: 0 };
      const mDC = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
      const mOU: Record<string, { over: number; under: number }> = {};
      const mBTTS = { yes: 0, no: 0 };

      document.querySelectorAll(selectors.oddsButton).forEach((btn: any) => {
        const label = (btn.querySelector(selectors.marketOddsLabel)?.textContent?.trim() || btn.textContent?.trim() || "").toLowerCase();
        const valueMatch = btn.textContent?.match(/(\d+[.,]?\d*)/);
        const value = valueMatch ? parseFloat(valueMatch[1].replace(",", ".")) : 0;
        if (isNaN(value) || value <= 1) return;

        if (label === "1" || label === hTeam.toLowerCase()) m1X2.home = value;
        else if (label === "x" || label === "remis") m1X2.draw = value;
        else if (label === "2" || label === aTeam.toLowerCase()) m1X2.away = value;
        else if (label === "1x") mDC.homeOrDraw = value;
        else if (label === "x2") mDC.drawOrAway = value;
        else if (label === "12") mDC.homeOrAway = value;
        else if (label === "tak" || label === "yes") mBTTS.yes = value;
        else if (label === "nie" || label === "no") mBTTS.no = value;

        const ouMatch = label.match(/(powyżej|poniżej|over|under)\s*(\d+[.,]?\d*)/i);
        if (ouMatch) {
          const line = parseFloat(ouMatch[2].replace(",", ".")).toFixed(1);
          if (!mOU[line]) mOU[line] = { over: 0, under: 0 };
          if (ouMatch[1].startsWith("po") || ouMatch[1] === "over") mOU[line].over = value;
          else mOU[line].under = value;
        }
      });

      return { homeTeam: hTeam, awayTeam: aTeam, market1X2: m1X2, marketDoubleChance: mDC, marketOverUnder: mOU, marketBTTS: mBTTS };
    }, SELECTORS);

    if (!data) return null;
    return {
      bookmaker: "totalbet", eventName: `${data.homeTeam} - ${data.awayTeam}`, homeTeam: data.homeTeam, awayTeam: data.awayTeam,
      eventUrl, hasNoTaxPromo: false, scrapedAt: new Date(),
      market1X2: data.market1X2,
      marketDoubleChance: data.marketDoubleChance.homeOrDraw > 0 ? data.marketDoubleChance : undefined,
      marketOverUnder: Object.keys(data.marketOverUnder).length > 0 ? data.marketOverUnder as Record<string, MarketOverUnderOdds> : undefined,
      marketBTTS: data.marketBTTS.yes > 0 ? data.marketBTTS : undefined,
    };
  }

  private async extractMatchData(page: Page, league: string): Promise<RawScrapedOdds[]> {
    const matchData = await page.evaluate((selectors) => {
      const matches: any[] = [];
      document.querySelectorAll(selectors.matchCard).forEach((card) => {
        const nameText = card.querySelector(selectors.eventName)?.textContent?.trim() || "";
        const teamMatch = nameText.match(/^(.+?)\s*-\s*(.+)$/);
        if (!teamMatch) return;
        const odds = Array.from(card.querySelectorAll(selectors.oddsButton)).slice(0, 3).map(el => parseFloat(el.textContent?.trim()?.replace(",", ".") || "0"));
        if (odds.length === 3) {
          const eventId = (card as HTMLElement).dataset.eventId || "";
          let eventUrl = "";
          if (eventId) eventUrl = `https://totalbet.pl/sports/event/${eventId}`;
          else {
            const link = card.querySelector("a[href*='/sports/event/']") as HTMLAnchorElement;
            if (link?.href) eventUrl = link.href;
          }
          matches.push({ homeTeam: teamMatch[1].trim(), awayTeam: teamMatch[2].trim(), homeOdds: odds[0], drawOdds: odds[1], awayOdds: odds[2], eventUrl });
        }
      });
      return matches;
    }, SELECTORS);

    return matchData.map(m => ({
      bookmaker: "totalbet", eventName: `${m.homeTeam} - ${m.awayTeam}`, homeTeam: getCanonicalTeamName(m.homeTeam, league), awayTeam: getCanonicalTeamName(m.awayTeam, league),
      homeOdds: m.homeOdds, drawOdds: m.drawOdds, awayOdds: m.awayOdds, hasNoTaxPromo: false, scrapedAt: new Date(), eventUrl: m.eventUrl
    }));
  }
}

export const totalbetScraper = new TotalbetPlaywrightScraper();
