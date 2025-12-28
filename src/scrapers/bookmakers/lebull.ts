/**
 * Le Bull Playwright Scraper
 * Scrapes odds from lebull.pl using headless Chromium
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

// Le Bull League URLs (direct iframe URLs)
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: "https://lebullpl-ssr.boxwebcdn.work/pl/league/1/4847",
  "premier-league": "https://lebullpl-ssr.boxwebcdn.work/pl/league/1/4485",
};

// CSS selectors for Le Bull
const SELECTORS = {
  matchWrapper: ".game-row-wrapper",
  teamName: ".team-column-name",
  oddsValue: ".rank-arrow",
  marketOddsLabel: ".outcome-name, .market-outcome-name",
};

export class LebullPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "lebull";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.lebull, ...config, enabled: true };
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

      await page.setViewportSize({ width: 1920, height: 5000 });
      await this.delay(2000);

      const hasMatches = await this.waitForSelector(page, SELECTORS.matchWrapper, 15000);
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

      const hasOdds = await this.waitForSelector(page, ".outcome-wrapper", 10000);
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
      document.querySelectorAll(selectors.matchWrapper).forEach((wrapper) => {
        const teamElements = wrapper.querySelectorAll(selectors.teamName);
        if (teamElements.length < 2) return;
        const home = teamElements[0]?.textContent?.trim() || "";
        const away = teamElements[1]?.textContent?.trim() || "";
        const link = wrapper.querySelector("a[href*='/event/']") as HTMLAnchorElement;
        if (link?.href) entries.push({ matchKey: `${home} vs ${away}`, eventUrl: link.href });
      });
      return entries;
    }, SELECTORS);
  }

  private async extractMatchDetailData(page: Page, eventUrl: string): Promise<RawScrapedMatchOdds | null> {
    const data = await page.evaluate((selectors) => {
      const teamElements = document.querySelectorAll(selectors.teamName);
      if (teamElements.length < 2) return null;
      const homeTeam = teamElements[0]?.textContent?.trim() || "", awayTeam = teamElements[1]?.textContent?.trim() || "";

      const market1X2 = { home: 0, draw: 0, away: 0 };
      const marketDoubleChance = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
      const marketOverUnder: Record<string, { over: number; under: number }> = {};
      const marketBTTS = { yes: 0, no: 0 };

      document.querySelectorAll(".outcome-wrapper").forEach((btn: any) => {
        const label = (btn.querySelector(selectors.marketOddsLabel)?.textContent?.trim() || "").toLowerCase();
        const valueText = btn.querySelector(".rank-arrow")?.textContent?.trim() || btn.textContent?.trim() || "";
        const value = parseFloat(valueText.replace(",", "."));
        if (isNaN(value) || value <= 1) return;

        if (label === "1" || label === homeTeam.toLowerCase()) market1X2.home = value;
        else if (label === "x" || label === "remis") market1X2.draw = value;
        else if (label === "2" || label === awayTeam.toLowerCase()) market1X2.away = value;
        else if (label === "1x") marketDoubleChance.homeOrDraw = value;
        else if (label === "x2") marketDoubleChance.drawOrAway = value;
        else if (label === "12") marketDoubleChance.homeOrAway = value;
        else if (label === "tak" || label === "yes") marketBTTS.yes = value;
        else if (label === "nie" || label === "no") marketBTTS.no = value;

        const ouMatch = label.match(/(ponad|poniżej|over|under)\s*(\d+[.,]?\d*)/i);
        if (ouMatch) {
          const line = parseFloat(ouMatch[2].replace(",", ".")).toFixed(1);
          if (!marketOverUnder[line]) marketOverUnder[line] = { over: 0, under: 0 };
          if (ouMatch[1].startsWith("po") || ouMatch[1] === "over") marketOverUnder[line].over = value;
          else marketOverUnder[line].under = value;
        }
      });

      return { homeTeam, awayTeam, market1X2, marketDoubleChance, marketOverUnder, marketBTTS };
    }, SELECTORS);

    if (!data) return null;
    return {
      bookmaker: "lebull", eventName: `${data.homeTeam} - ${data.awayTeam}`, homeTeam: data.homeTeam, awayTeam: data.awayTeam,
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
      document.querySelectorAll(selectors.matchWrapper).forEach((wrapper) => {
        const teamElements = wrapper.querySelectorAll(selectors.teamName);
        if (teamElements.length < 2) return;
        const home = teamElements[0]?.textContent?.trim() || "";
        const away = teamElements[1]?.textContent?.trim() || "";
        const odds = Array.from(wrapper.querySelectorAll(selectors.oddsValue)).slice(0, 3).map(el => parseFloat(el.textContent?.trim()?.replace(",", ".") || "0"));
        if (odds.length >= 3) {
          const link = wrapper.querySelector("a[href*='/event/']") as HTMLAnchorElement;
          matches.push({ homeTeam: home, awayTeam: away, homeOdds: odds[0], drawOdds: odds[1], awayOdds: odds[2], eventUrl: link?.href });
        }
      });
      return matches;
    }, SELECTORS);

    return matchData.map(m => ({
      bookmaker: "lebull", eventName: `${m.homeTeam} - ${m.awayTeam}`, homeTeam: getCanonicalTeamName(m.homeTeam, league), awayTeam: getCanonicalTeamName(m.awayTeam, league),
      homeOdds: m.homeOdds, drawOdds: m.drawOdds, awayOdds: m.awayOdds, hasNoTaxPromo: false, scrapedAt: new Date(), eventUrl: m.eventUrl
    }));
  }
}

export const lebullScraper = new LebullPlaywrightScraper();