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

      // Navigate to homepage just to establish session (faster than full league page)
      await this.navigateWithRetry(page, "https://www.efortuna.pl", { timeout: 20000, waitUntil: "domcontentloaded" });
      await this.delay(1000); // Brief wait for session

      // Fetch fixtures and markets in a single page.evaluate to avoid browser closure between calls
      console.log(`[Fortuna] Fetching fixtures via direct API for ${leagueConfig.tournamentId}...`);
      const result = await page.evaluate(async (tournamentId) => {
        try {
          // Step 1: Fetch fixtures
          const fixturesRes = await fetch(
            `https://api.efortuna.pl/offer/structure/api/v1_0/prematch/tournament/${tournamentId}/fixtures`
          );
          const fixturesData = await fixturesRes.json();
          const fixtures = fixturesData.fixtures || [];

          if (fixtures.length === 0) {
            return { fixtures: [], markets: [] };
          }

          // Step 2: Fetch markets for all fixtures in parallel
          const fixtureIds = fixtures.map((f: any) => f.id);
          const marketPromises = fixtureIds.map(async (id: string) => {
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
          const marketsArrays = await Promise.all(marketPromises);
          const markets = marketsArrays.flat();

          return { fixtures, markets };
        } catch {
          return null;
        }
      }, leagueConfig.tournamentId);

      if (!result?.fixtures?.length) {
        return this.createNotFoundResult(`No fixtures found for ${league}`, Date.now() - startTime);
      }

      const tournamentFixtures = { fixtures: result.fixtures };
      const allMarkets = result.markets;
      console.log(`[Fortuna] Found ${tournamentFixtures.fixtures.length} fixtures`);
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
      // Extract fixture ID from URL first
      const fixtureIdMatch = eventUrl.match(/ufo:mtch:[a-z0-9-]+/i);
      const fixtureId = fixtureIdMatch?.[0];

      if (!fixtureId) {
        return this.createMatchDetailNotFoundResult("Could not extract fixture ID from URL", Date.now() - startTime);
      }

      page = await this.initBrowser();

      // Navigate to homepage just to establish session (faster than full match page)
      await this.navigateWithRetry(page, "https://www.efortuna.pl", { timeout: 20000, waitUntil: "domcontentloaded" });
      await this.delay(500); // Brief wait for session

      // Fetch fixture info and markets directly via API
      console.log(`[Fortuna] Fetching markets directly for fixture ${fixtureId}...`);
      const { fixture, markets } = await page.evaluate(async (fid: string) => {
        try {
          // Fetch fixture info and markets in parallel
          const [fixtureRes, marketsRes] = await Promise.all([
            fetch(`https://api.efortuna.pl/offer/structure/api/v1_0/fixture/${fid}`),
            fetch(`https://api.efortuna.pl/offer/markets/api/v1_0/fixture/${fid}/markets`)
          ]);
          const fixtureData = await fixtureRes.json();
          const marketsData = await marketsRes.json();
          return {
            fixture: fixtureData,
            markets: Array.isArray(marketsData) ? marketsData : []
          };
        } catch {
          return { fixture: null, markets: [] };
        }
      }, fixtureId);

      console.log(`[Fortuna] Fetched ${markets.length} markets directly`);

      // If fixture info not available, create fallback from URL
      let finalFixture: FortunaFixture | undefined = fixture;
      if (!finalFixture) {
        const urlParts = eventUrl.split("/").pop()?.split("-") || [];
        if (urlParts.length >= 2) {
          finalFixture = {
            id: fixtureId,
            name: urlParts.slice(0, -1).join(" "),
            tournamentId: "",
            participants: [],
            startDatetime: Date.now(),
            seoName: "",
          };
        }
      }

      const matchData = this.parseMatchDetailData(finalFixture, markets, eventUrl);

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

      // Over/Under Market - only exact type ID (not half-time or team-specific)
      if (market.marketTypeId === MARKET_TYPES.OVER_UNDER) {
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

      // BTTS Market - only exact type ID (not half-time or combo markets)
      if (market.marketTypeId === MARKET_TYPES.BTTS) {
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
