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

      // Step 1: Fetch match list from competition-view (using page.request.fetch to avoid context destruction)
      const matchesApiUrl = `https://offer.lvbet.pl/client-api/v5/matches/competition-view/?sports_groups_ids=${tournamentId}&lang=pl`;
      const matchesResponse = await page.request.fetch(matchesApiUrl);
      const matchesData = await matchesResponse.json();

      if (!matchesData?.matches || matchesData.matches.length === 0) {
        return this.createNotFoundResult("Could not fetch LVBet matches", Date.now() - startTime);
      }

      // Step 2: Collect all match_ids for batch odds fetch
      const matchIds = matchesData.matches.map((m: any) => m.match_id).join(",");

      // Step 3: Batch fetch odds for all matches (using page.request.fetch)
      const oddsApiUrl = `https://offer.lvbet.pl/client-api/v5/markets/search/?matches_ids=${matchIds}&lang=pl`;
      const oddsResponse = await page.request.fetch(oddsApiUrl);
      const oddsData = await oddsResponse.json();

      // Step 4: Build odds map by match_id
      const oddsMap = new Map<string, { home: number; draw: number; away: number }>();

      if (Array.isArray(oddsData)) {
        // First pass: find primary markets (is_primary = true or "Zwycięzca meczu")
        for (const market of oddsData) {
          const matchId = market.match_id;
          if (oddsMap.has(matchId)) continue;

          const name = (market.name || "").toLowerCase();
          const isPrimary1X2 = market.selections?.length === 3 &&
            (market.is_primary === true || name === "zwycięzca meczu" || name === "wynik meczu");

          if (isPrimary1X2) {
            const odds = { home: 0, draw: 0, away: 0 };
            for (const s of market.selections) {
              if (s.order === 0) odds.home = s.rate?.decimal || 0;
              else if (s.order === 1) odds.draw = s.rate?.decimal || 0;
              else if (s.order === 2) odds.away = s.rate?.decimal || 0;
            }
            if (odds.home > 1 && odds.draw > 1 && odds.away > 1) {
              oddsMap.set(matchId, odds);
            }
          }
        }

        // Second pass: fallback for matches without primary market
        for (const market of oddsData) {
          const matchId = market.match_id;
          if (oddsMap.has(matchId)) continue;

          const name = (market.name || "").toLowerCase();
          // Only accept markets with "wynik" but NOT special markets like cards, corners etc.
          const isValidFallback = market.selections?.length === 3 &&
            name.includes("wynik") &&
            !name.includes("kartki") &&
            !name.includes("kartek") &&
            !name.includes("rzuty") &&
            !name.includes("faule") &&
            !name.includes("spalone");

          if (isValidFallback) {
            const odds = { home: 0, draw: 0, away: 0 };
            for (const s of market.selections) {
              if (s.order === 0) odds.home = s.rate?.decimal || 0;
              else if (s.order === 1) odds.draw = s.rate?.decimal || 0;
              else if (s.order === 2) odds.away = s.rate?.decimal || 0;
            }
            if (odds.home > 1 && odds.draw > 1 && odds.away > 1) {
              oddsMap.set(matchId, odds);
            }
          }
        }
      }

      console.log(`[LVBet] Found odds for ${oddsMap.size}/${matchesData.matches.length} matches`);

      // Step 5: Build matches with odds
      const matches: RawScrapedOdds[] = [];

      for (const m of matchesData.matches) {
        const homeTeam = m.home?.[0] || "";
        const awayTeam = m.away?.[0] || "";
        if (!homeTeam || !awayTeam) continue;

        const odds = oddsMap.get(m.match_id);
        if (!odds) continue; // Skip matches without 1X2 odds

        const hSlug = homeTeam.replace(/\s+/g, '').toLowerCase();
        const aSlug = awayTeam.replace(/\s+/g, '').toLowerCase();
        const groupPath = (m.sports_groups_ids || []).join('/');
        const eventUrl = `https://lvbet.pl/pl/zaklady-bukmacherskie/pilka-nozna/${league}/${hSlug}vs${aSlug}/--/${groupPath}/${m.match_id}/`;

        matches.push({
          bookmaker: this.bookmaker,
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam: getCanonicalTeamName(homeTeam, league),
          awayTeam: getCanonicalTeamName(awayTeam, league),
          homeOdds: odds.home,
          drawOdds: odds.draw,
          awayOdds: odds.away,
          hasNoTaxPromo: false,
          scrapedAt: new Date(),
          eventUrl: eventUrl,
        });
      }

      if (matches.length === 0) {
        return this.createNotFoundResult("No matches with odds found on LVBet", Date.now() - startTime);
      }

      console.log(`[LVBet] Successfully scraped ${matches.length} matches for ${league}`);
      return { status: "success", bookmaker: this.bookmaker, data: matches, duration: Date.now() - startTime, timestamp: new Date() };
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

      // Extract match_id from URL - it's at the end of the path
      // Format: https://lvbet.pl/pl/.../match_id/ or https://lvbet.pl/pl/.../match_id
      const urlPath = eventUrl.replace(/\/$/, ""); // Remove trailing slash
      const segments = urlPath.split("/");
      const matchId = segments[segments.length - 1];

      if (!matchId || !/^(bc:)?\d+$/.test(matchId)) {
        return this.createMatchDetailNotFoundResult("Invalid LVBet event URL - cannot extract match_id", Date.now() - startTime);
      }

      // Use page.request.fetch to avoid context destruction issues
      const apiUrl = `https://offer.lvbet.pl/client-api/v5/markets/search/?matches_ids=${matchId}&lang=pl`;
      const response = await page.request.fetch(apiUrl);
      const detailApiData = await response.json();

      if (Array.isArray(detailApiData) && detailApiData.length > 0) {
        const m1X2 = { home: 0, draw: 0, away: 0 };
        const mDC = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
        const mBTTS = { yes: 0, no: 0 };
        const mOU: Record<string, MarketOverUnderOdds> = {};

        // First pass: find primary 1X2 market
        for (const m of detailApiData) {
          if (m1X2.home > 0) break;
          const name = (m.name || "").toLowerCase();
          const isPrimary1X2 = m.selections?.length === 3 &&
            (m.is_primary === true || name === "zwycięzca meczu" || name === "wynik meczu");

          if (isPrimary1X2) {
            m.selections.forEach((s: any) => {
              if (s.order === 0) m1X2.home = s.rate?.decimal || 0;
              else if (s.order === 1) m1X2.draw = s.rate?.decimal || 0;
              else if (s.order === 2) m1X2.away = s.rate?.decimal || 0;
            });
          }
        }

        // Second pass: parse other markets
        detailApiData.forEach((m: any) => {
          const name = (m.name || "").toLowerCase();

          // Double Chance - "Podwójna szansa"
          if (m.selections?.length === 3 && (name.includes("szansa") || name.includes("dwójtyp")) && mDC.homeOrDraw === 0) {
            m.selections.forEach((s: any) => {
              if (s.order === 0) mDC.homeOrDraw = s.rate?.decimal || 0;
              else if (s.order === 1) mDC.homeOrAway = s.rate?.decimal || 0;
              else if (s.order === 2) mDC.drawOrAway = s.rate?.decimal || 0;
            });
          }
          // BTTS - "Obie drużyny strzelą gola" (exactly 2 selections, no "połowa", "wynik", or time ranges)
          else if (
            m.selections?.length === 2 &&
            name.includes("obie") && name.includes("strzel") &&
            !name.includes("połowa") && !name.includes("połow") &&
            !name.includes("wynik") && !name.includes("w obu") &&
            !name.includes("min.") && !name.includes("min ") &&
            mBTTS.yes === 0
          ) {
            m.selections?.forEach((s: any) => {
              if (s.order === 0) mBTTS.yes = s.rate?.decimal || 0;
              else if (s.order === 1) mBTTS.no = s.rate?.decimal || 0;
            });
          }
          // O/U - "Suma goli"
          else if (name.includes("suma goli") || name.includes("liczba goli")) {
            const line = m.line;
            if (line && line.toString().includes(".5")) {
              const lineStr = parseFloat(line).toFixed(1);
              if (!mOU[lineStr]) mOU[lineStr] = { over: 0, under: 0 };
              m.selections?.forEach((s: any) => {
                if (s.name?.includes("Powyżej")) mOU[lineStr].over = s.rate?.decimal || 0;
                else if (s.name?.includes("Poniżej")) mOU[lineStr].under = s.rate?.decimal || 0;
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
