/**
 * BETFAN Playwright Scraper
 * Scrapes odds from betfan.pl using headless Chromium
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

// League URLs for BETFAN
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: "https://betfan.pl/lista-zakladow/pilka-nozna/polska/ekstraklasa/294",
  "premier-league": "https://betfan.pl/lista-zakladow/pilka-nozna/anglia/premier-league/244",
};

// CSS selectors for BETFAN
const SELECTORS = {
  matchCard: ".eventCardHome__card, [class*='eventCard'], .event-card",
  teamNames: ".eventCardHome__info__participants__participant",
  oddsButton: ".oddsButton, [class*='oddsButton']",
  oddsValue: ".oddsButton__odds, [class*='oddsValue']",
  marketOddsLabel: ".oddsButton__label",
};

export class BetfanPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "betfan";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.betfan, ...config, enabled: true };
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
        const teamElements = card.querySelectorAll(selectors.teamNames);
        if (teamElements.length < 2) return;
        const home = teamElements[0]?.textContent?.trim() || "";
        const away = teamElements[1]?.textContent?.trim() || "";
        if (!home || !away) return;
        const link = card.querySelector("a[href*='/lista-zakladow/']") as HTMLAnchorElement || card.closest("a") as HTMLAnchorElement;
        if (link?.href) entries.push({ matchKey: `${home} vs ${away}`, eventUrl: link.href });
      });
      return entries;
    }, SELECTORS);
  }

  private async extractMatchDetailData(page: Page, eventUrl: string): Promise<RawScrapedMatchOdds | null> {
    const data = await page.evaluate((selectors) => {
      let hTeam = "", aTeam = "";
      const teamElements = document.querySelectorAll(".eventHeader__participants__participant, .eventCardHome__info__participants__participant, h1");
      
      // If h1 contains the match name
      const h1Text = document.querySelector("h1")?.innerText || "";
      const h1Match = h1Text.match(/^(.+?)\s*[-–vs.]+\s*(.+)$/i);
      if (h1Match) {
        hTeam = h1Match[1].trim();
        aTeam = h1Match[2].trim();
      } else if (teamElements.length >= 2) {
        hTeam = teamElements[0]?.textContent?.trim() || "";
        aTeam = teamElements[1]?.textContent?.trim() || "";
      }

      if (!hTeam) return null;

      const m1X2 = { home: 0, draw: 0, away: 0 };
      const mDC = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
      const mOU: Record<string, { over: number; under: number }> = {};
      const mBTTS = { yes: 0, no: 0 };

      document.querySelectorAll(selectors.oddsButton).forEach((btn: any) => {
        const label = (btn.querySelector(selectors.marketOddsLabel)?.textContent?.trim() || btn.textContent?.trim() || "").toLowerCase();
        const valueText = btn.querySelector(selectors.oddsValue)?.textContent?.trim() || "";
        const valMatch = valueText.match(/(\d+[.,]\d+)/) || btn.textContent?.match(/(\d+[.,]\d+)/);
        const val = valMatch ? parseFloat(valMatch[1].replace(",", ".")) : 0;
        
        if (isNaN(val) || val <= 1) return;

        if (label === "1" || label === hTeam.toLowerCase()) m1X2.home = val;
        else if (label === "x" || label === "remis") m1X2.draw = val;
        else if (label === "2" || label === aTeam.toLowerCase()) m1X2.away = val;
        else if (label === "1x") mDC.homeOrDraw = val;
        else if (label === "x2") mDC.drawOrAway = val;
        else if (label === "12") mDC.homeOrAway = val;
        else if (label === "tak" || label === "yes") mBTTS.yes = val;
        else if (label === "nie" || label === "no") mBTTS.no = val;

        const ouM = label.match(/(ponad|poniżej|over|under)\s*(\d+[.,]?\d*)/i);
        if (ouM) {
          const line = parseFloat(ouM[2].replace(",", ".")).toFixed(1);
          if (!mOU[line]) mOU[line] = { over: 0, under: 0 };
          if (ouM[1].startsWith("po") || ouM[1] === "over") mOU[line].over = val;
          else mOU[line].under = val;
        }
      });

      return { homeTeam: hTeam, awayTeam: aTeam, market1X2: m1X2, marketDoubleChance: mDC, marketOverUnder: mOU, marketBTTS: mBTTS };
    }, SELECTORS);

    if (!data) return null;
    return {
      bookmaker: "betfan", eventName: `${data.homeTeam} - ${data.awayTeam}`, homeTeam: data.homeTeam, awayTeam: data.awayTeam,
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
        const teamElements = card.querySelectorAll(selectors.teamNames);
        if (teamElements.length < 2) return;
        const home = teamElements[0]?.textContent?.trim() || "";
        const away = teamElements[1]?.textContent?.trim() || "";
        if (!home || !away) return;
        
        const oddsNodes = Array.from(card.querySelectorAll(selectors.oddsValue));
        const odds = oddsNodes.slice(0, 3).map(el => parseFloat(el.textContent?.trim()?.replace(",", ".") || "0"));
        
        if (odds.length === 3 && !odds.some(isNaN) && odds.every(o => o > 1)) {
          const link = card.querySelector("a[href*='/lista-zakladow/']") as HTMLAnchorElement || card.closest("a") as HTMLAnchorElement;
          matches.push({ homeTeam: home, awayTeam: away, homeOdds: odds[0], drawOdds: odds[1], awayOdds: odds[2], eventUrl: link?.href });
        }
      });
      return matches;
    }, SELECTORS);

    return matchData.map(m => ({
      bookmaker: "betfan", eventName: `${m.homeTeam} - ${m.awayTeam}`, homeTeam: getCanonicalTeamName(m.homeTeam, league), awayTeam: getCanonicalTeamName(m.awayTeam, league),
      homeOdds: m.homeOdds, drawOdds: m.drawOdds, awayOdds: m.awayOdds, hasNoTaxPromo: false, scrapedAt: new Date(), eventUrl: m.eventUrl
    }));
  }
}

export const betfanScraper = new BetfanPlaywrightScraper();
