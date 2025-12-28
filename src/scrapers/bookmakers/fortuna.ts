/**
 * Fortuna Playwright Scraper
 * Scrapes odds from efortuna.pl using headless Chromium
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

// League URLs for Fortuna
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: "https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/polska-ekstraklasa",
  "premier-league": "https://www.efortuna.pl/zaklady-bukmacherskie/pika-nozna/anglia-2/1-anglia-1",
};

export class FortunaPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "fortuna";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.fortuna, ...config, enabled: true };
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

      const hasEvents = await this.waitForSelector(page, "a[aria-label*=' - ']", 15000);
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
    if (!matchResult) return this.createNotFoundResult(`Match not found: ${match.homeTeam} vs ${match.awayTeam}`, Date.now() - startTime);

    return { status: "success", bookmaker: this.bookmaker, data: [matchResult.event], duration: Date.now() - startTime, timestamp: new Date() };
  }

  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();
    let page: Page | null = null;
    try {
      page = await this.initBrowser();
      await page.setViewportSize({ width: 1920, height: 5000 });
      await this.navigateWithRetry(page, eventUrl, { timeout: 45000, waitUntil: "domcontentloaded" });
      await this.delay(10000);

      try {
        const acceptBtn = page.locator("button:has-text('AKCEPTUJĘ WSZYSTKIE'), button:has-text('Zgadzam się')").first();
        if (await acceptBtn.isVisible({ timeout: 3000 })) {
          await acceptBtn.click();
          await this.delay(1000);
        }
      } catch {}

      const matchData = await this.extractMatchDetailData(page, eventUrl);
      
      if (!matchData || (matchData.market1X2.home === 0)) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await this.delay(2000);
        const retryData = await this.extractMatchDetailData(page, eventUrl);
        if (retryData && retryData.market1X2.home > 0) return { status: "success", bookmaker: this.bookmaker, data: retryData, duration: Date.now() - startTime, timestamp: new Date() };
        return this.createMatchDetailNotFoundResult("Could not parse match detail data", Date.now() - startTime);
      }

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
      document.querySelectorAll("a[aria-label*=' - ']").forEach((link: any) => {
        const label = link.getAttribute("aria-label") || "";
        const teamMatch = label.match(/^(.+?)\s*-\s*(.+)$/);
        if (teamMatch && teamMatch[1] && teamMatch[2]) {
          const h = teamMatch[1].trim();
          const a = teamMatch[2].trim();
          const key = `${h} vs ${a}`;
          if (h && a && !seen.has(key)) {
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
      if (!hT) {
        const parts = window.location.pathname.split('/');
        const slug = parts[parts.length - 1];
        if (slug && slug.includes('-')) {
          const teams = slug.split('-');
          hT = teams[0].charAt(0).toUpperCase() + teams[0].slice(1);
          aT = teams[1].charAt(0).toUpperCase() + teams[1].slice(1);
        }
      }
      if (!hT) return null;

      const m1X2 = { home: 0, draw: 0, away: 0 };
      const mDC = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
      const mOU: Record<string, { over: number; under: number }> = {};
      const mBTTS = { yes: 0, no: 0 };

      const els = Array.from(document.querySelectorAll("h3, .market-title, .market-name, .market-header, div, span"));
      
      for (const el of els) {
        const h = (el.textContent?.trim() || "").toLowerCase();
        
        if (h === "wynik meczu" && m1X2.home === 0) {
          let cur: any = el;
          for (let i = 0; i < 4; i++) {
            if (!cur) break;
            const btns = Array.from(cur.querySelectorAll("button, .odds-button2, .odds-button"));
            if (btns.length >= 3) {
              const vals = btns.map((b: any) => {
                const m = b.innerText.match(/(\d+[.,]\d+)/);
                return m ? parseFloat(m[1].replace(",", ".")) : 0;
              });
              if (vals[0] > 1) { m1X2.home = vals[0]; m1X2.draw = vals[1]; m1X2.away = vals[2]; break; }
            }
            cur = cur.nextElementSibling;
          }
        }
        else if (h === "mecz: dwójtyp" && mDC.homeOrDraw === 0) {
          let cur: any = el;
          for (let i = 0; i < 4; i++) {
            if (!cur) break;
            const btns = Array.from(cur.querySelectorAll("button, .odds-button2, .odds-button"));
            if (btns.length >= 3) {
              const vals = btns.map((b: any) => {
                const m = b.innerText.match(/(\d+[.,]\d+)/);
                return m ? parseFloat(m[1].replace(",", ".")) : 0;
              });
              if (vals[0] > 1) { mDC.homeOrDraw = vals[0]; mDC.homeOrAway = vals[1]; mDC.drawOrAway = vals[2]; break; }
            }
            cur = cur.nextElementSibling;
          }
        }
        else if (h === "mecz: obie drużyny strzelą gola" && mBTTS.yes === 0) {
          let cur: any = el;
          for (let i = 0; i < 4; i++) {
            if (!cur) break;
            const btns = Array.from(cur.querySelectorAll("button, .odds-button2, .odds-button"));
            if (btns.length >= 2) {
              const vals = btns.map((b: any) => {
                const m = b.innerText.match(/(\d+[.,]\d+)/);
                return m ? parseFloat(m[1].replace(",", ".")) : 0;
              });
              if (vals[0] > 1) { mBTTS.yes = vals[0]; mBTTS.no = vals[1]; break; }
            }
            cur = cur.nextElementSibling;
          }
        }
        else if (h === "mecz: liczba goli") {
          let cur = el.parentElement;
          if (cur) {
            const rows = Array.from(cur.querySelectorAll("div"));
            for (const row of rows) {
              const lineM = row.innerText.match(/(\d+[.,]5)/);
              if (lineM) {
                const line = parseFloat(lineM[1].replace(",", ".")).toFixed(1);
                const btns = Array.from(row.querySelectorAll("button, .odds-button2, .odds-button"));
                if (btns.length >= 2) {
                  // Filter out the line value itself if it appears in button text
                  const vals = btns.map(b => {
                    const matches = (b.textContent || "").match(/(\d+[.,]\d+)/g);
                    if (!matches) return 0;
                    // If multiple numbers, the last one is usually the odd
                    return parseFloat(matches[matches.length-1].replace(",", "."));
                  });
                  if (vals[0] > 1 && vals[1] > 1 && !mOU[line]) { mOU[line] = { under: vals[0], over: vals[1] }; }
                }
              }
            }
          }
        }
      }

      return { homeTeam: hT, awayTeam: aT, market1X2: m1X2, marketDoubleChance: mDC, marketOverUnder: mOU, marketBTTS: mBTTS };
    });

    if (!data) return null;
    return {
      bookmaker: "fortuna", eventName: `${data.homeTeam} - ${data.awayTeam}`, homeTeam: data.homeTeam, awayTeam: data.awayTeam,
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
      const seen = new Set();
      document.querySelectorAll("a[aria-label*=' - ']").forEach((link: any) => {
        const label = link.getAttribute("aria-label") || "";
        const teamMatch = label.match(/^(.+?)\s*-\s*(.+)$/);
        if (!teamMatch) return;
        
        const h = teamMatch[1].trim();
        const a = teamMatch[2].trim();
        const key = `${h} vs ${a}`;
        if (seen.has(key)) return;

        const oddButtons = link.querySelectorAll(".odds-button2__value, .odds-button__value");
        const odds = Array.from(oddButtons).slice(0, 3).map((el: any) => parseFloat(el.textContent?.replace(",", ".") || "0"));
        
        if (odds.length === 3 && odds.every(o => o > 1)) {
          seen.add(key);
          matches.push({ h, a, homeOdds: odds[0], drawOdds: odds[1], awayOdds: odds[2], url: link.href });
        }
      });
      return matches;
    });

    return matchData.map(m => ({
      bookmaker: "fortuna", eventName: `${m.h} - ${m.a}`, homeTeam: getCanonicalTeamName(m.h, league), awayTeam: getCanonicalTeamName(m.a, league),
      homeOdds: m.homeOdds, drawOdds: m.drawOdds, awayOdds: m.awayOdds, hasNoTaxPromo: false, scrapedAt: new Date(), eventUrl: m.url
    }));
  }
}

export const fortunaScraper = new FortunaPlaywrightScraper();