/**
 * LVBet Playwright Scraper
 * Uses Direct API calls via Playwright to get odds from LVBet.
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

// Tournament IDs for LVBet API
const TOURNAMENT_IDS: Record<string, number> = {
  "premier-league": 37685,
  "ekstraklasa": 37669
};

export class LVBetPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "lvbet";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.lvbet, ...config, enabled: true };
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();
    let page: Page | null = null;
    const tournamentId = TOURNAMENT_IDS[league];
    if (!tournamentId) return this.createNotFoundResult(`Unknown league: ${league}`, Date.now() - startTime);

    try {
      page = await this.initBrowser();
      await page.goto("https://lvbet.pl", { waitUntil: "domcontentloaded" });
      
      const apiUrl = `https://offer.lvbet.pl/client-api/v5/matches/competition-view/?sports_groups_ids=${tournamentId}&lang=pl`;
      const apiData = await page.evaluate(async (url) => {
        const res = await fetch(url);
        return res.json();
      }, apiUrl);

      if (apiData && apiData.matches) {
        const matches: RawScrapedOdds[] = apiData.matches.map((m: any) => {
          const homeTeam = m.home[0] || "";
          const awayTeam = m.away[0] || "";
          const hSlug = homeTeam.replace(/\s+/g, '').toLowerCase();
          const aSlug = awayTeam.replace(/\s+/g, '').toLowerCase();
          const groupPath = m.sports_groups_ids.join('/');
          const eventUrl = `https://lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/${hSlug}vs${aSlug}/--/${groupPath}/${m.match_id}/`;

          return {
            bookmaker: this.bookmaker,
            eventName: `${homeTeam} - ${awayTeam}`,
            homeTeam: getCanonicalTeamName(homeTeam, league),
            awayTeam: getCanonicalTeamName(awayTeam, league),
            homeOdds: 0, drawOdds: 0, awayOdds: 0,
            hasNoTaxPromo: false, scrapedAt: new Date(), eventUrl: eventUrl
          };
        });

        return { status: "success", bookmaker: this.bookmaker, data: matches, duration: Date.now() - startTime, timestamp: new Date() };
      }

      return this.createNotFoundResult("Could not fetch LVBet API data", Date.now() - startTime);
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
    if (!matchResult) return this.createNotFoundResult(`Match not found on LVBet: ${match.homeTeam} vs ${match.awayTeam}`, Date.now() - startTime);

    return { status: "success", bookmaker: this.bookmaker, data: [matchResult.event], duration: Date.now() - startTime, timestamp: new Date() };
  }

  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();
    let page: Page | null = null;
    try {
      page = await this.initBrowser();
      const matchIdMatch = eventUrl.match(/(bc:\d+)/);
      if (!matchIdMatch) return this.createMatchDetailNotFoundResult("Invalid LVBet event URL", Date.now() - startTime);
      const matchId = matchIdMatch[1];

      const apiUrl = `https://offer.lvbet.pl/client-api/v5/markets/search/?matches_ids=${matchId}&lang=pl`;
      await page.goto("https://lvbet.pl", { waitUntil: "domcontentloaded" });
      const detailApiData = await page.evaluate(async (url) => {
        const res = await fetch(url);
        return res.json();
      }, apiUrl);

      if (Array.isArray(detailApiData) && detailApiData.length > 0) {
        const m1X2 = { home: 0, draw: 0, away: 0 };
        const mDC = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
        const mBTTS = { yes: 0, no: 0 };
        const mOU: Record<string, MarketOverUnderOdds> = {};

        detailApiData.forEach((m: any) => {
          const name = m.name.toLowerCase();
          
          // 1X2 - Identification by primary or selections count
          if (m.selections.length === 3 && (name.includes("wynik") || name === "mecz" || m.is_primary) && m1X2.home === 0) {
            m.selections.forEach((s: any) => {
              if (s.order === 0) m1X2.home = s.rate.decimal;
              else if (s.order === 1) m1X2.draw = s.rate.decimal;
              else if (s.order === 2) m1X2.away = s.rate.decimal;
            });
          }
          // Double Chance
          else if (m.selections.length === 3 && (name.includes("szansa") || name.includes("dwójtyp")) && mDC.homeOrDraw === 0) {
            m.selections.forEach((s: any) => {
              if (s.order === 0) mDC.homeOrDraw = s.rate.decimal;
              else if (s.order === 1) mDC.homeOrAway = s.rate.decimal;
              else if (s.order === 2) mDC.drawOrAway = s.rate.decimal;
            });
          }
          // BTTS
          else if (name.includes("obie") && name.includes("strzelą")) {
            m.selections.forEach((s: any) => {
              if (s.order === 0) mBTTS.yes = s.rate.decimal;
              else if (s.order === 1) mBTTS.no = s.rate.decimal;
            });
          }
          // O/U
          else if (name.includes("suma goli") || name.includes("liczba goli")) {
            const line = m.line;
            if (line && line.toString().includes(".5")) {
              const lineStr = parseFloat(line).toFixed(1);
              if (!mOU[lineStr]) mOU[lineStr] = { over: 0, under: 0 };
              m.selections.forEach((s: any) => {
                if (s.name.includes("Powyżej")) mOU[lineStr].over = s.rate.decimal;
                else if (s.name.includes("Poniżej")) mOU[lineStr].under = s.rate.decimal;
              });
            }
          }
        });

        return {
          status: "success",
          bookmaker: this.bookmaker,
          data: {
            bookmaker: "lvbet",
            eventName: "Match",
            homeTeam: "", awayTeam: "",
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

      return this.createMatchDetailNotFoundResult("Could not parse LVBet detail API data", Date.now() - startTime);
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

export const lvbetScraper = new LVBetPlaywrightScraper();
