/**
 * Fortuna Playwright Scraper
 * Uses response interception to capture API data from efortuna.pl
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

// League URLs and tournament IDs for Fortuna
const LEAGUE_CONFIG: Record<string, { url: string; tournamentId: string }> = {
  ekstraklasa: {
    url: "https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/polska-ekstraklasa",
    tournamentId: "ufo:tour:00-0b9", // Ekstraklasa
  },
  "premier-league": {
    url: "https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/anglia-2/1-anglia-1",
    tournamentId: "ufo:tour:00-03m", // Premier League
  },
};

// Fortuna API market type IDs
const MARKET_TYPES = {
  MATCH_RESULT: "ufo:mtyp:00-00",     // Wynik meczu (1X2)
  DOUBLE_CHANCE: "ufo:mtyp:00-01",    // Mecz: dwójtyp
  OVER_UNDER: "ufo:mtyp:00-0u",       // Mecz: liczba goli
  BTTS: "ufo:mtyp:00-1c",             // Mecz: obie drużyny strzelą gola
};

// API response types
interface FortunaFixture {
  id: string;
  name: string;
  tournamentId: string;
  participants: Array<{ name: string; type: "HOME" | "AWAY" }>;
  startDatetime: number;
  seoName: string;
}

interface FortunaOutcome {
  name: string;       // "1" = home, "0" = draw, "2" = away
  longName: string;   // Team name or "Remis"
  odds: number;
  specifiers?: Record<string, string>;
}

interface FortunaMarket {
  id: string;
  fixtureId: string;
  marketTypeId: string;
  marketTypeName: string;
  name: string;
  outcomes: FortunaOutcome[];
  specifiers?: Record<string, string>;
}

interface FortunaUpcomingResponse {
  fixtures: FortunaFixture[];
  markets: FortunaMarket[];
}

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
    const leagueConfig = LEAGUE_CONFIG[league];
    if (!leagueConfig) {
      return this.createNotFoundResult(`Unknown league: ${league}`, Date.now() - startTime);
    }

    try {
      page = await this.initBrowser();

      // Set up response interception for tournament fixtures and markets
      let tournamentFixtures: { fixtures: FortunaFixture[] } | null = null;
      const capturedMarkets: FortunaMarket[] = [];

      page.on("response", async (response) => {
        const url = response.url();
        try {
          // Capture tournament fixtures endpoint
          if (url.includes(`/prematch/tournament/${leagueConfig.tournamentId}/fixtures`)) {
            const data = await response.json();
            tournamentFixtures = data;
            console.log(`[Fortuna] Captured tournament fixtures: ${data.fixtures?.length || 0}`);
          }
          // Capture market data from upcoming widget or market endpoints
          if (url.includes("/widget/upcoming") || url.includes("/markets")) {
            const data = await response.json();
            if (data.markets && Array.isArray(data.markets)) {
              capturedMarkets.push(...data.markets);
            }
          }
        } catch {}
      });

      // Navigate and accept cookies
      await this.navigateWithRetry(page, leagueConfig.url, { timeout: 30000, waitUntil: "domcontentloaded" });

      try {
        await page.waitForSelector('button:has-text("AKCEPTUJĘ")', { timeout: 5000 });
        await page.click('button:has-text("AKCEPTUJĘ")');
      } catch {}

      // Wait for initial load
      await this.delay(8000);

      // Click "WSZYSTKO" to load all fixtures
      try {
        await page.click('button:has-text("WSZYSTKO")');
        await this.delay(8000);
      } catch {}

      // If we didn't capture the tournament endpoint, fetch it directly via page.evaluate
      if (!tournamentFixtures) {
        console.log("[Fortuna] Fetching fixtures directly via API...");
        const apiData = await page.evaluate(async (tournamentId) => {
          try {
            const fixturesRes = await fetch(
              `https://api.efortuna.pl/offer/structure/api/v1_0/prematch/tournament/${tournamentId}/fixtures`
            );
            const fixtures = await fixturesRes.json();
            return { fixtures: fixtures.fixtures || [] };
          } catch {
            return null;
          }
        }, leagueConfig.tournamentId);

        if (apiData) {
          tournamentFixtures = apiData;
          console.log(`[Fortuna] Fetched ${tournamentFixtures.fixtures?.length || 0} fixtures via direct API call`);
        }
      }

      if (!tournamentFixtures?.fixtures?.length) {
        return this.createNotFoundResult(`No fixtures found for ${league}`, Date.now() - startTime);
      }

      // Fetch markets for all fixtures via page.evaluate (batch request)
      const fixtureIds = tournamentFixtures.fixtures.map(f => f.id);
      console.log(`[Fortuna] Fetching markets for ${fixtureIds.length} fixtures...`);

      const marketsData = await page.evaluate(async (ids: string[]) => {
        const results: FortunaMarket[] = [];
        // Fetch markets in batches of 10
        for (let i = 0; i < ids.length; i += 10) {
          const batch = ids.slice(i, i + 10);
          const promises = batch.map(async (id) => {
            try {
              const res = await fetch(
                `https://api.efortuna.pl/offer/markets/api/v1_0/fixture/${id}/markets/overview`
              );
              const data = await res.json();
              return Array.isArray(data) ? data : [];
            } catch {
              return [];
            }
          });
          const batchResults = await Promise.all(promises);
          results.push(...batchResults.flat());
        }
        return results;
      }, fixtureIds);

      const allMarkets = [...capturedMarkets, ...marketsData];
      console.log(`[Fortuna] Total markets captured: ${allMarkets.length}`);

      // Parse data
      const data = this.parseFixturesAndMarkets(tournamentFixtures.fixtures, allMarkets, league);

      if (data.length === 0) {
        return this.createNotFoundResult(`No ${league} matches with odds found`, Date.now() - startTime);
      }

      console.log(`[Fortuna] Successfully scraped ${data.length} ${league} matches via API`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("[Fortuna] Scraping error:", error);
      return this.createErrorResult(error, Date.now() - startTime);
    } finally {
      if (page) await page.close();
    }
  }

  private parseFixturesAndMarkets(
    fixtures: FortunaFixture[],
    markets: FortunaMarket[],
    league: string
  ): RawScrapedOdds[] {
    const results: RawScrapedOdds[] = [];

    for (const fixture of fixtures) {
      // Find 1X2 market for this fixture
      const market1X2 = markets.find(
        m => m.fixtureId === fixture.id && m.marketTypeId === MARKET_TYPES.MATCH_RESULT
      );

      if (!market1X2?.outcomes?.length) continue;

      // Extract team names
      const homeParticipant = fixture.participants.find(p => p.type === "HOME");
      const awayParticipant = fixture.participants.find(p => p.type === "AWAY");

      if (!homeParticipant || !awayParticipant) continue;

      // Extract odds from outcomes
      const homeOutcome = market1X2.outcomes.find(o => o.name === "1");
      const drawOutcome = market1X2.outcomes.find(o => o.name === "0");
      const awayOutcome = market1X2.outcomes.find(o => o.name === "2");

      if (!homeOutcome?.odds || !drawOutcome?.odds || !awayOutcome?.odds) continue;

      // Build event URL
      const eventUrl = `https://www.efortuna.pl/zaklady-bukmacherskie/pilka-nozna/${fixture.seoName}-${fixture.id}`;

      results.push({
        bookmaker: this.bookmaker,
        eventName: fixture.name,
        homeTeam: getCanonicalTeamName(homeParticipant.name, league),
        awayTeam: getCanonicalTeamName(awayParticipant.name, league),
        homeOdds: homeOutcome.odds,
        drawOdds: drawOutcome.odds,
        awayOdds: awayOutcome.odds,
        hasNoTaxPromo: false,
        scrapedAt: new Date(),
        eventUrl,
      });
    }

    return results;
  }

  async scrapeMatch(match: MatchIdentifier): Promise<ScraperResult> {
    const startTime = Date.now();
    const league = match.leagueId ?? "ekstraklasa";
    const allMatches = await this.scrapeLeague(league);
    if (allMatches.status !== "success" || !allMatches.data) return allMatches;

    const matchResult = findMatchingEvent(
      { homeTeam: match.homeTeam, awayTeam: match.awayTeam },
      allMatches.data,
      league
    );
    if (!matchResult) {
      return this.createNotFoundResult(
        `Match not found: ${match.homeTeam} vs ${match.awayTeam}`,
        Date.now() - startTime
      );
    }

    return {
      status: "success",
      bookmaker: this.bookmaker,
      data: [matchResult.event],
      duration: Date.now() - startTime,
      timestamp: new Date(),
    };
  }

  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();
    let page: Page | null = null;

    try {
      page = await this.initBrowser();

      // Set up response interception for market details
      let upcomingData: FortunaUpcomingResponse | null = null;
      const marketOverviews: FortunaMarket[][] = [];

      page.on("response", async (response) => {
        const url = response.url();
        try {
          if (url.includes("/offer/structure/api/v1_0/widget/upcoming")) {
            upcomingData = await response.json();
          }
          if (url.includes("/markets/overview")) {
            const data = await response.json();
            if (Array.isArray(data)) {
              marketOverviews.push(data);
            }
          }
        } catch {}
      });

      // Navigate
      await this.navigateWithRetry(page, eventUrl, { timeout: 45000, waitUntil: "domcontentloaded" });

      try {
        await page.waitForSelector('button:has-text("AKCEPTUJĘ")', { timeout: 3000 });
        await page.click('button:has-text("AKCEPTUJĘ")');
      } catch {}

      await this.delay(15000);

      // Extract fixture ID from URL
      const fixtureIdMatch = eventUrl.match(/ufo:mtch:[a-z0-9-]+/i);
      const fixtureId = fixtureIdMatch?.[0];

      if (!fixtureId) {
        return this.createMatchDetailNotFoundResult("Could not extract fixture ID from URL", Date.now() - startTime);
      }

      // Try to get data from upcoming widget first
      let fixture: FortunaFixture | undefined;
      let markets: FortunaMarket[] = [];

      const capturedUpcoming = upcomingData as FortunaUpcomingResponse | null;
      if (capturedUpcoming?.fixtures) {
        fixture = capturedUpcoming.fixtures.find((f) => f.id === fixtureId);
        markets = capturedUpcoming.markets.filter((m) => m.fixtureId === fixtureId);
      }

      // Also use market overview data if available
      if (marketOverviews.length > 0) {
        markets = [...markets, ...marketOverviews.flat()];
      }

      // If no markets captured via interception, fetch directly from API
      // Use /markets endpoint instead of /markets/overview to get all extended markets
      if (markets.length < 10) {
        console.log(`[Fortuna] Fetching all markets directly for fixture ${fixtureId}...`);
        const directMarkets = await page.evaluate(async (fid: string) => {
          try {
            const res = await fetch(
              `https://api.efortuna.pl/offer/markets/api/v1_0/fixture/${fid}/markets`
            );
            const data = await res.json();
            return Array.isArray(data) ? data : [];
          } catch {
            return [];
          }
        }, fixtureId);
        markets = directMarkets;
        console.log(`[Fortuna] Fetched ${markets.length} markets directly`);
      }

      if (!fixture) {
        // Try to fetch fixture info directly from API
        console.log(`[Fortuna] No fixture info, fetching directly...`);
        const fixtureInfo = await page.evaluate(async (fid: string) => {
          try {
            const res = await fetch(
              `https://api.efortuna.pl/offer/structure/api/v1_0/fixture/${fid}`
            );
            return await res.json();
          } catch {
            return null;
          }
        }, fixtureId);

        if (fixtureInfo) {
          fixture = fixtureInfo;
        } else {
          // Fallback: Try to parse from URL
          const urlParts = eventUrl.split("/").pop()?.split("-") || [];
          if (urlParts.length >= 2) {
            fixture = {
              id: fixtureId,
              name: urlParts.slice(0, -1).join(" "),
              tournamentId: "",
              participants: [],
              startDatetime: Date.now(),
              seoName: "",
            };
          }
        }
      }

      const matchData = this.parseMatchDetailData(fixture, markets, eventUrl);

      if (!matchData || matchData.market1X2.home === 0) {
        return this.createMatchDetailNotFoundResult("Could not parse match detail data", Date.now() - startTime);
      }

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data: matchData,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      return this.createMatchDetailErrorResult(error, Date.now() - startTime);
    } finally {
      if (page) await page.close();
    }
  }

  private parseMatchDetailData(
    fixture: FortunaFixture | undefined,
    markets: FortunaMarket[],
    eventUrl: string
  ): RawScrapedMatchOdds | null {
    // Extract team names
    let homeTeam = "";
    let awayTeam = "";

    if (fixture?.participants?.length) {
      const home = fixture.participants.find(p => p.type === "HOME");
      const away = fixture.participants.find(p => p.type === "AWAY");
      homeTeam = home?.name || "";
      awayTeam = away?.name || "";
    }

    if (!homeTeam && fixture?.name) {
      const match = fixture.name.match(/(.+?)\s*[-–]\s*(.+)/);
      if (match) {
        homeTeam = match[1].trim();
        awayTeam = match[2].trim();
      }
    }

    if (!homeTeam) return null;

    // Initialize market data
    const market1X2 = { home: 0, draw: 0, away: 0 };
    const marketDoubleChance = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
    const marketOverUnder: Record<string, MarketOverUnderOdds> = {};
    const marketBTTS = { yes: 0, no: 0 };

    for (const market of markets) {
      const outcomes = market.outcomes || [];

      // 1X2 Market
      if (market.marketTypeId === MARKET_TYPES.MATCH_RESULT) {
        const home = outcomes.find(o => o.name === "1");
        const draw = outcomes.find(o => o.name === "0");
        const away = outcomes.find(o => o.name === "2");
        if (home?.odds && draw?.odds && away?.odds) {
          market1X2.home = home.odds;
          market1X2.draw = draw.odds;
          market1X2.away = away.odds;
        }
      }

      // Double Chance Market
      if (market.marketTypeId === MARKET_TYPES.DOUBLE_CHANCE) {
        const homeOrDraw = outcomes.find(o => o.name === "10" || o.longName?.includes("1X"));
        const drawOrAway = outcomes.find(o => o.name === "02" || o.longName?.includes("X2"));
        const homeOrAway = outcomes.find(o => o.name === "12" || o.longName?.includes("12"));
        if (homeOrDraw?.odds) marketDoubleChance.homeOrDraw = homeOrDraw.odds;
        if (drawOrAway?.odds) marketDoubleChance.drawOrAway = drawOrAway.odds;
        if (homeOrAway?.odds) marketDoubleChance.homeOrAway = homeOrAway.odds;
      }

      // Over/Under Market
      if (market.marketTypeId === MARKET_TYPES.OVER_UNDER || market.marketTypeName?.includes("liczba goli")) {
        // Extract line from specifiers or market name
        let line = market.specifiers?.total || market.specifiers?.line;
        if (!line) {
          const lineMatch = market.name?.match(/(\d+[.,]5)/);
          if (lineMatch) line = lineMatch[1].replace(",", ".");
        }

        if (line) {
          // Fortuna uses "+ X.5" and "- X.5" format, or "powyżej"/"poniżej"
          const over = outcomes.find(o =>
            o.name?.startsWith("+ ") || o.name?.startsWith("+") ||
            o.name?.toLowerCase().includes("over") ||
            o.longName?.toLowerCase().includes("powyżej")
          );
          const under = outcomes.find(o =>
            o.name?.startsWith("- ") || o.name?.startsWith("-") ||
            o.name?.toLowerCase().includes("under") ||
            o.longName?.toLowerCase().includes("poniżej")
          );
          if (over?.odds && under?.odds) {
            marketOverUnder[line] = { over: over.odds, under: under.odds };
          }
        }
      }

      // BTTS Market
      if (market.marketTypeId === MARKET_TYPES.BTTS || market.marketTypeName?.includes("obie drużyny strzelą")) {
        const yes = outcomes.find(o =>
          o.name?.toLowerCase() === "tak" || o.name?.toLowerCase() === "yes" ||
          o.longName?.toLowerCase() === "tak"
        );
        const no = outcomes.find(o =>
          o.name?.toLowerCase() === "nie" || o.name?.toLowerCase() === "no" ||
          o.longName?.toLowerCase() === "nie"
        );
        if (yes?.odds && no?.odds) {
          marketBTTS.yes = yes.odds;
          marketBTTS.no = no.odds;
        }
      }
    }

    return {
      bookmaker: this.bookmaker,
      eventName: `${homeTeam} - ${awayTeam}`,
      homeTeam,
      awayTeam,
      eventUrl,
      hasNoTaxPromo: false,
      scrapedAt: new Date(),
      market1X2,
      marketDoubleChance: marketDoubleChance.homeOrDraw > 0 ? marketDoubleChance : undefined,
      marketOverUnder: Object.keys(marketOverUnder).length > 0 ? marketOverUnder : undefined,
      marketBTTS: marketBTTS.yes > 0 ? marketBTTS : undefined,
    };
  }

  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    // This method is for compatibility - extract from intercepted data would be better
    return page.evaluate(() => {
      const entries: EventUrlEntry[] = [];
      const seen = new Set<string>();
      document.querySelectorAll("a[aria-label*=' - ']").forEach((link) => {
        const label = link.getAttribute("aria-label") || "";
        const teamMatch = label.match(/^(.+?)\s*-\s*(.+)$/);
        if (teamMatch?.[1] && teamMatch[2]) {
          const h = teamMatch[1].trim();
          const a = teamMatch[2].trim();
          const key = `${h} vs ${a}`;
          if (h && a && !seen.has(key)) {
            seen.add(key);
            entries.push({ matchKey: key, eventUrl: (link as HTMLAnchorElement).href });
          }
        }
      });
      return entries;
    });
  }
}

export const fortunaScraper = new FortunaPlaywrightScraper();
