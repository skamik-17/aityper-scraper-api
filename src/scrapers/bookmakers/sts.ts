/**
 * STS Playwright Scraper
 * Scrapes odds from sts.pl using headless Chromium
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

// League URLs for STS
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa:
    "https://www.sts.pl/zaklady-bukmacherskie/pilka-nozna/polska/ekstraklasa/1/46/201",
  "premier-league":
    "https://www.sts.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/1/1/17",
};

// CSS selectors for STS
const SELECTORS = {
  cookieAccept: "[data-testid='cookie-policy-button-accept-all'], button:has-text('Akceptuj wszystkie')",
  matchTile: ".one-ticket-match-tile, .one-ticket-live-match-tile",
  teamHome: ".one-ticket-match-tile-event-details-desktop__team-home span, .live-match-tile__team-name--home",
  teamAway: ".one-ticket-match-tile-event-details-desktop__team-away span, .live-match-tile__team-name--away",
  oddsValue: ".odds-button__odd-value",
  oddsButton: ".odds-button, [class*='selection'], button[class*='odd']",
};

export class STSScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "sts";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.sts, ...config, enabled: true };
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

      try {
        const cookieButton = page.locator(SELECTORS.cookieAccept).first();
        if (await cookieButton.isVisible({ timeout: 3000 })) await cookieButton.click();
      } catch {} // Ignore errors if cookie button is not found or not visible

      await page.setViewportSize({ width: 1920, height: 10000 });
      await this.delay(2000);

      const data = await this.extractMatchData(page, league);
      if (data.length === 0) return this.createNotFoundResult(`No matches found for ${league}`, Date.now() - startTime);

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
      await this.delay(5000);

      const hasOdds = await this.waitForSelector(page, SELECTORS.oddsButton, 10000);
      if (!hasOdds) return this.createMatchDetailNotFoundResult("No odds found", Date.now() - startTime);

      const matchData = await this.extractMatchDetailData(page, eventUrl);
      if (!matchData) return this.createMatchDetailNotFoundResult("Could not parse match data", Date.now() - startTime);

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
      const seen = new Set<string>();
      document.querySelectorAll(selectors.matchTile).forEach((tile) => {
        const home = tile.querySelector(selectors.teamHome)?.textContent?.trim() || "";
        const away = tile.querySelector(selectors.teamAway)?.textContent?.trim() || "";
        if (!home || !away) return;
        const key = `${home} vs ${away}`;
        if (seen.has(key)) return;
        
        const link = tile.querySelector("a[href*='/zaklady-bukmacherskie/'], a[href*='/kursy/']") as HTMLAnchorElement
                  || tile.closest("a") as HTMLAnchorElement;
        
        if (link?.href) {
          seen.add(key);
          entries.push({ matchKey: key, eventUrl: link.href });
        }
      });
      return entries;
    }, SELECTORS);
  }

  private async extractMatchDetailData(page: Page, eventUrl: string): Promise<RawScrapedMatchOdds | null> {
    const data = await page.evaluate((selectors) => {
      let hTeam = "", aTeam = "";
      const teamElements = document.querySelectorAll("[class*='team-name'], [class*='participant']");
      if (teamElements.length >= 2) {
        hTeam = teamElements[0]?.textContent?.trim() || "";
        aTeam = teamElements[1]?.textContent?.trim() || "";
      }
      if (!hTeam) {
        const titleText = document.querySelector("h1, [class*='event-header']")?.textContent?.trim() || "";
        const teamMatch = titleText.match(/(.+?)\s*[-–vs.]+\s*(.+)/i);
        if (teamMatch) { hTeam = teamMatch[1].trim(); aTeam = teamMatch[2].trim(); }
      }
      if (!hTeam) {
        // Try extracting from URL
        const parts = window.location.pathname.split('/');
        const slug = parts.find(p => p.includes('-') && !p.startsWith('f'));
        if (slug) {
          const teams = slug.split('-');
          if (teams.length >= 2) {
            hTeam = teams[0].charAt(0).toUpperCase() + teams[0].slice(1);
            aTeam = teams[1].charAt(0).toUpperCase() + teams[1].slice(1);
          }
        }
      }
      if (!hTeam) return null;

      const m1X2 = { home: 0, draw: 0, away: 0 };
      const mDC = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
      const mOU: Record<string, { over: number; under: number }> = {};
      const mBTTS = { yes: 0, no: 0 };

      document.querySelectorAll(selectors.oddsButton).forEach((btn: any) => {
        const text = btn.innerText.replace(/\n/g, " ").trim().toLowerCase();
        const valMatch = text.match(/(\d+[.,]\d+)/);
        if (!valMatch) return;
        const val = parseFloat(valMatch[1].replace(",", "."));
        if (val <= 1) return;

        const label = text.replace(valMatch[0], "").trim();

        if (label === "1" || label === hTeam.toLowerCase()) m1X2.home = val;
        else if (label === "x" || label === "remis") m1X2.draw = val;
        else if (label === "2" || label === aTeam.toLowerCase()) m1X2.away = val;
        else if (label === "1x") mDC.homeOrDraw = val;
        else if (label === "x2") mDC.drawOrAway = val;
        else if (label === "12") mDC.homeOrAway = val;
        else if (label === "tak") mBTTS.yes = val;
        else if (label === "nie") mBTTS.no = val;
        else if (label.includes("+") || label.includes("-") || label.includes("ponad") || label.includes("poniżej")) {
          const lineMatch = label.match(/(\d+[.,]5)/);
          if (lineMatch) {
            const line = parseFloat(lineMatch[1].replace(",", ".")).toFixed(1);
            if (!mOU[line]) mOU[line] = { over: 0, under: 0 };
            if (label.includes("+") || label.includes("ponad")) mOU[line].over = val;
            else if (label.includes("-") || label.includes("poniżej")) mOU[line].under = val;
          }
        }
      });

      return { homeTeam: hTeam, awayTeam: aTeam, market1X2: m1X2, marketDoubleChance: mDC, marketOverUnder: mOU, marketBTTS: mBTTS };
    }, SELECTORS);

    if (!data) return null;
    return {
      bookmaker: "sts", eventName: `${data.homeTeam} - ${data.awayTeam}`, homeTeam: data.homeTeam, awayTeam: data.awayTeam,
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
      const seen = new Set<string>();
      document.querySelectorAll(selectors.matchTile).forEach((tile) => {
        const home = tile.querySelector(selectors.teamHome)?.textContent?.trim() || "";
        const away = tile.querySelector(selectors.teamAway)?.textContent?.trim() || "";
        if (!home || !away) return;
        const key = `${home} vs ${away}`;
        if (seen.has(key)) return;

        const odds = Array.from(tile.querySelectorAll(selectors.oddsValue)).slice(0, 3).map(el => parseFloat(el.textContent?.trim()?.replace(",", ".") || "0"));
        if (odds.length === 3 && odds.every(o => o > 1)) {
          const link = tile.querySelector("a[href*='/zaklady-bukmacherskie/'], a[href*='/kursy/']") as HTMLAnchorElement
                    || tile.closest("a") as HTMLAnchorElement;
          seen.add(key);
          matches.push({ homeTeam: home, awayTeam: away, homeOdds: odds[0], drawOdds: odds[1], awayOdds: odds[2], eventUrl: link?.href });
        }
      });
      return matches;
    }, SELECTORS);

    return matchData.map(m => ({
      bookmaker: "sts", eventName: `${m.homeTeam} - ${m.awayTeam}`, homeTeam: getCanonicalTeamName(m.homeTeam, league), awayTeam: getCanonicalTeamName(m.awayTeam, league),
      homeOdds: m.homeOdds, drawOdds: m.drawOdds, awayOdds: m.awayOdds, hasNoTaxPromo: false, scrapedAt: new Date(), eventUrl: m.eventUrl
    }));
  }
}

export const stsScraper = new STSScraper();