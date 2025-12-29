/**
 * STS Playwright Scraper
 * Uses WebSocket interception to extract odds data from sts.pl
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

// League configuration with tournament IDs for WebSocket
const LEAGUE_CONFIG: Record<string, { url: string; tournamentId: number; countryFilter: string; tournamentFilter: string }> = {
  ekstraklasa: {
    url: "https://www.sts.pl/pl/zaklady-bukmacherskie/pilka-nozna/polska/ekstraklasa/175",
    tournamentId: 46,
    countryFilter: "polska",
    tournamentFilter: "ekstraklasa",
  },
  "premier-league": {
    url: "https://www.sts.pl/pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/175",
    tournamentId: 17,
    countryFilter: "angli",
    tournamentFilter: "premier league",
  },
};

// Interface for parsed fixture data
interface STSFixture {
  id: string;
  home: string;
  away: string;
  startTime: string;
  stsId: number;
  tournament: string;
  country: string;
  eventUrl: string;
}

// Interface for parsed odds
interface STSOdds {
  odds1: number | null;
  oddsX: number | null;
  odds2: number | null;
  odds1X: number | null;
  oddsX2: number | null;
  odds12: number | null;
  bttsYes: number | null;
  bttsNo: number | null;
  overUnder: Record<string, { over: number; under: number }>;
}

export class STSScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "sts";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.sts, ...config, enabled: true };
  }

  // Convert team name to URL slug (e.g., "Manchester United" -> "manchester-united")
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();
    let page: Page | null = null;
    const leagueConfig = LEAGUE_CONFIG[league];
    if (!leagueConfig) return this.createNotFoundResult(`Unknown league: ${league}`, Date.now() - startTime);

    try {
      page = await this.initBrowser();

      // Set up WebSocket data capture
      let initialData = "";
      const fixtureData = new Map<string, any>();

      // Listen to WebSocket messages
      page.on("websocket", ws => {
        if (!ws.url().includes("/sbk/api/sbk")) return;

        ws.on("framereceived", frame => {
          const data = typeof frame.payload === "string" ? frame.payload : "";

          // Capture initial data (largest message)
          if (data.includes('"s":"i_pl"') && data.length > initialData.length) {
            initialData = data;
          }

          // Capture fixture-specific data
          const fixtureMatch = data.match(/"s":"f_(f\d+)_pl"/);
          if (fixtureMatch && data.length > 1000) {
            try {
              const lines = data.split("\n");
              const jsonData = JSON.parse(lines[1] || lines[0]);
              fixtureData.set(fixtureMatch[1], jsonData);
            } catch {}
          }
        });
      });

      // Navigate and accept cookies
      await this.navigateWithRetry(page, leagueConfig.url, { timeout: 30000, waitUntil: "domcontentloaded" });
      await this.delay(3000);

      try {
        const cookieButton = page.locator("text=Akceptuj wszystkie").first();
        if (await cookieButton.isVisible({ timeout: 3000 })) await cookieButton.click();
      } catch {}

      // Wait for WebSocket data
      await this.delay(15000);

      if (!initialData) {
        return this.createNotFoundResult("No WebSocket data received", Date.now() - startTime);
      }

      // Parse the data
      const data = this.parseWebSocketData(initialData, fixtureData, league, leagueConfig);
      if (data.length === 0) {
        return this.createNotFoundResult(`No matches found for ${league}`, Date.now() - startTime);
      }

      return { status: "success", bookmaker: this.bookmaker, data, duration: Date.now() - startTime, timestamp: new Date() };
    } catch (error) {
      return this.createErrorResult(error, Date.now() - startTime);
    } finally {
      if (page) await page.close();
    }
  }

  private parseWebSocketData(
    initialData: string,
    fixtureData: Map<string, any>,
    league: string,
    leagueConfig: { url: string; countryFilter: string; tournamentFilter: string }
  ): RawScrapedOdds[] {
    try {
      const lines = initialData.split("\n");
      const jsonData = JSON.parse(lines[1]);

      const football = jsonData.B?.S?.["1"];
      if (!football) return [];

      const results: RawScrapedOdds[] = [];

      // Iterate through categories (countries) and tournaments
      for (const [, cat] of Object.entries(football.C || {}) as [string, any][]) {
        const countryName = (cat.n || "").toLowerCase();
        if (!countryName.includes(leagueConfig.countryFilter)) continue;

        for (const [, tourn] of Object.entries(cat.T || {}) as [string, any][]) {
          const tournamentName = (tourn.n || "").toLowerCase();
          if (!tournamentName.includes(leagueConfig.tournamentFilter)) continue;

          // Found the target league
          for (const [fixId, fix] of Object.entries(tourn.FX || {}) as [string, any][]) {
            if (!fix.H?.n || !fix.A?.n) continue;

            // Generate /kursy/ URL format for extended markets support
            const homeSlug = this.slugify(fix.H.n);
            const awaySlug = this.slugify(fix.A.n);

            const fixture: STSFixture = {
              id: fixId,
              home: fix.H.n,
              away: fix.A.n,
              startTime: fix.t || "",
              stsId: fix.sid || 0,
              tournament: tourn.n || "",
              country: cat.n || "",
              eventUrl: `https://www.sts.pl/kursy/${homeSlug}-${awaySlug}/${fixId}`,
            };

            // Extract odds from fixture-specific data
            const odds = this.extractOdds(fixture, fixtureData.get(fixId), jsonData);

            if (odds.odds1 && odds.oddsX && odds.odds2) {
              results.push({
                bookmaker: "sts",
                eventName: `${fixture.home} - ${fixture.away}`,
                homeTeam: getCanonicalTeamName(fixture.home, league),
                awayTeam: getCanonicalTeamName(fixture.away, league),
                homeOdds: odds.odds1,
                drawOdds: odds.oddsX,
                awayOdds: odds.odds2,
                hasNoTaxPromo: false,
                scrapedAt: new Date(),
                eventUrl: fixture.eventUrl,
              });
            }
          }
        }
      }

      return results;
    } catch (error) {
      console.error("[STS] Parse error:", error);
      return [];
    }
  }

  private extractOdds(fixture: STSFixture, fixtureJson: any, initialJson: any): STSOdds {
    const result: STSOdds = {
      odds1: null, oddsX: null, odds2: null,
      odds1X: null, oddsX2: null, odds12: null,
      bttsYes: null, bttsNo: null,
      overUnder: {},
    };

    // Try fixture-specific data first, then initial data
    const sources = [fixtureJson, initialJson].filter(Boolean);

    for (const source of sources) {
      // The odds are in P.{assocKey}.m.{marketId}.l.{lineId}.o.{outcomeId}.O
      const assocKey = `1m${fixture.stsId}`;
      const marketData = source.P?.[assocKey]?.m;

      if (!marketData) continue;

      // Market 1 = 1X2 (Match result)
      const market1x2 = marketData["1"]?.l?.["1"]?.o;
      if (market1x2) {
        result.odds1 = market1x2["1"]?.O || null;
        result.oddsX = market1x2["2"]?.O || null;
        result.odds2 = market1x2["3"]?.O || null;
      }

      // Market 10 = Double Chance
      const marketDC = marketData["10"]?.l?.["1"]?.o;
      if (marketDC) {
        result.odds1X = marketDC["9"]?.O || null;
        result.oddsX2 = marketDC["11"]?.O || null;
        result.odds12 = marketDC["10"]?.O || null;
      }

      // Market 43 = BTTS (tak/nie)
      const marketBTTS = marketData["43"]?.l?.["1"]?.o;
      if (marketBTTS) {
        result.bttsYes = marketBTTS["26"]?.O || null;
        result.bttsNo = marketBTTS["27"]?.O || null;
      }

      // Market 25 = Total Goals Over/Under (Liczba goli)
      // Line names are "Liczba goli", actual line value is in outcome name (e.g., "+2.5")
      // Outcome 12 = over, Outcome 13 = under
      const marketOU = marketData["25"]?.l;
      if (marketOU) {
        for (const [, lineData] of Object.entries(marketOU) as [string, any][]) {
          const outcomes = lineData.o;
          if (!outcomes) continue;

          // Get over/under outcomes
          const overOutcome = outcomes["12"];
          const underOutcome = outcomes["13"];

          if (!overOutcome?.O || !underOutcome?.O) continue;

          // Extract line value from outcome name (e.g., "+2.5" or "-2.5")
          const outcomeName = overOutcome.n || underOutcome.n || "";
          const lineMatch = outcomeName.match(/[+-]?(\d+[.,]5)/);

          if (lineMatch) {
            const line = parseFloat(lineMatch[1].replace(",", ".")).toFixed(1);
            result.overUnder[line] = { over: overOutcome.O, under: underOutcome.O };
          }
        }
      }

      // If we found 1X2 odds, we're done
      if (result.odds1) break;
    }

    return result;
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

      // Extract fixture ID from URL (e.g., /kursy/team-team/f1234567 or /f1234567)
      const urlMatch = eventUrl.match(/f(\d+)/);
      const fixtureId = urlMatch ? `f${urlMatch[1]}` : "";

      // Set up WebSocket capture for detailed match data
      let targetFixtureJson: any = null;
      let initialJson: any = null;

      page.on("websocket", ws => {
        if (!ws.url().includes("/sbk/api/sbk")) return;

        ws.on("framereceived", frame => {
          const data = typeof frame.payload === "string" ? frame.payload : "";

          // Capture initial data for fixture info
          if (data.includes('"s":"i_pl"') && data.length > 100000) {
            try {
              const lines = data.split("\n");
              initialJson = JSON.parse(lines[1]);
            } catch {}
          }

          // Capture ONLY the target fixture's data (has extended markets)
          if (fixtureId && data.includes(`"s":"f_${fixtureId}_pl"`)) {
            try {
              const lines = data.split("\n");
              targetFixtureJson = JSON.parse(lines[1] || lines[0]);
            } catch {}
          }
        });
      });

      await this.navigateWithRetry(page, eventUrl, { timeout: 30000, waitUntil: "domcontentloaded" });
      await this.delay(3000);

      try {
        const cookieButton = page.locator("text=Akceptuj wszystkie").first();
        if (await cookieButton.isVisible({ timeout: 3000 })) await cookieButton.click();
      } catch {}

      // Wait for fixture-specific data
      await this.delay(10000);

      if (!targetFixtureJson && !initialJson) {
        return this.createMatchDetailNotFoundResult("No WebSocket data received", Date.now() - startTime);
      }

      // Parse match data - use fixture data for markets (has DC, BTTS, O/U)
      const matchData = this.parseMatchDetailData(targetFixtureJson, initialJson, eventUrl, fixtureId);
      if (!matchData) {
        return this.createMatchDetailNotFoundResult("Could not parse match data", Date.now() - startTime);
      }

      return { status: "success", bookmaker: this.bookmaker, data: matchData, duration: Date.now() - startTime, timestamp: new Date() };
    } catch (error) {
      return this.createMatchDetailErrorResult(error, Date.now() - startTime);
    } finally {
      if (page) await page.close();
    }
  }

  private parseMatchDetailData(fixtureJson: any, initialJson: any, eventUrl: string, targetFixtureId: string): RawScrapedMatchOdds | null {
    // Find fixture info from initial data (has B.S.1... structure with team names)
    const dataSource = initialJson || fixtureJson;
    const football = dataSource?.B?.S?.["1"];
    if (!football) return null;

    for (const [, cat] of Object.entries(football.C || {}) as [string, any][]) {
      for (const [, tourn] of Object.entries(cat.T || {}) as [string, any][]) {
        for (const [fixId, fix] of Object.entries(tourn.FX || {}) as [string, any][]) {
          // Only process the target fixture
          if (fixId !== targetFixtureId) continue;
          if (!fix.H?.n || !fix.A?.n) continue;

          const fixture: STSFixture = {
            id: fixId,
            home: fix.H.n,
            away: fix.A.n,
            startTime: fix.t || "",
            stsId: fix.sid || 0,
            tournament: tourn.n || "",
            country: cat.n || "",
            eventUrl,
          };

          // Extract odds - fixture-specific data has extended markets (DC, BTTS, O/U)
          const odds = this.extractOdds(fixture, fixtureJson, initialJson);

          return {
            bookmaker: "sts",
            eventName: `${fixture.home} - ${fixture.away}`,
            homeTeam: fixture.home,
            awayTeam: fixture.away,
            eventUrl,
            hasNoTaxPromo: false,
            scrapedAt: new Date(),
            market1X2: {
              home: odds.odds1 || 0,
              draw: odds.oddsX || 0,
              away: odds.odds2 || 0,
            },
            marketDoubleChance: odds.odds1X ? {
              homeOrDraw: odds.odds1X,
              drawOrAway: odds.oddsX2 || 0,
              homeOrAway: odds.odds12 || 0,
            } : undefined,
            marketOverUnder: Object.keys(odds.overUnder).length > 0
              ? odds.overUnder as Record<string, MarketOverUnderOdds>
              : undefined,
            marketBTTS: odds.bttsYes ? {
              yes: odds.bttsYes,
              no: odds.bttsNo || 0,
            } : undefined,
          };
        }
      }
    }

    return null;
  }

  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    // With WebSocket approach, we get URLs directly from the data
    // This method is kept for interface compatibility
    return [];
  }
}

export const stsScraper = new STSScraper();
