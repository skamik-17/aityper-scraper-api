/**
 * Betcris Playwright Scraper
 * Uses Swarm WebSocket interception to capture odds from betcris.pl
 */

import type { Page, WebSocket as PlaywrightWebSocket } from "playwright";
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

// Competition IDs for Betcris (from Swarm API)
const COMPETITION_IDS: Record<string, number> = {
  ekstraklasa: 1978,
  "premier-league": 538,
};

// League URLs for navigation
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: "https://www.betcris.pl/zaklady-bukmacherskie/match/Soccer/Poland/1978",
  "premier-league": "https://www.betcris.pl/zaklady-bukmacherskie/match/Soccer/England/538",
};

// Swarm market types
const SWARM_MARKET_TYPES = {
  MATCH_RESULT: "P1XP2",        // 1X2
  DOUBLE_CHANCE: "P1XP2DC",     // Double Chance (sometimes just part of market name)
  OVER_UNDER: "OverUnder",      // Total goals Over/Under
  BTTS: "BothTeamsToScore",     // Both teams to score
};

interface SwarmGame {
  id: number;
  team1_name: string;
  team2_name: string;
  team1_id: number;
  team2_id: number;
  start_ts: number;
  markets_count: number;
  is_blocked: number;
  game_number: number;
  market?: Record<string, SwarmMarket>;
}

interface SwarmMarket {
  id: number;
  name: string;
  type: string;
  order: number;
  base?: number;
  col_count: number;
  event?: Record<string, SwarmEvent>;
}

interface SwarmEvent {
  id: number;
  name: string;
  price: number;
  order: number;
  type_1?: string;
  base?: number;
}

interface SwarmData {
  sport?: Record<string, {
    id: number;
    name: string;
    alias: string;
    region?: Record<string, {
      id: number;
      name: string;
      alias: string;
      competition?: Record<string, {
        id: number;
        name: string;
        game?: Record<string, SwarmGame>;
      }>;
    }>;
  }>;
}

export class BetcrisPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "betcris";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.betcris, ...config, enabled: true };
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();
    let page: Page | null = null;
    const competitionId = COMPETITION_IDS[league];
    const url = LEAGUE_URLS[league];
    if (!competitionId || !url) return this.createNotFoundResult(`Unknown league: ${league}`, Date.now() - startTime);

    try {
      page = await this.initBrowser();

      // Set up WebSocket interception
      const wsDataPromise = this.captureSwarmData(page, competitionId);

      // Navigate to page
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

      // Wait for WebSocket data (reduced timeout from 20s to 10s)
      const wsData = await Promise.race([
        wsDataPromise,
        this.delay(10000).then(() => null)
      ]);

      if (!wsData) {
        console.log("[Betcris] No WebSocket data captured, falling back to DOM scraping");
        return this.scrapeLeagueDOM(page, league, startTime);
      }

      // Parse Swarm data
      const matches = this.parseSwarmData(wsData, league, competitionId);

      if (matches.length === 0) {
        console.log("[Betcris] No matches parsed from WebSocket, falling back to DOM");
        return this.scrapeLeagueDOM(page, league, startTime);
      }

      console.log(`[Betcris] Scraped ${matches.length} matches for ${league} via WebSocket`);
      return { status: "success", bookmaker: this.bookmaker, data: matches, duration: Date.now() - startTime, timestamp: new Date() };
    } catch (error) {
      return this.createErrorResult(error, Date.now() - startTime);
    } finally {
      if (page) await page.close();
    }
  }

  private async captureSwarmData(page: Page, competitionId?: number, singleEventMode = false, targetGameNumber?: number): Promise<SwarmData | null> {
    return new Promise((resolve) => {
      let resolved = false;
      let bestData: SwarmData | null = null;
      let bestMarketCount = 0;

      page.on("websocket", (ws: PlaywrightWebSocket) => {
        // Swarm WebSocket URL
        if (!ws.url().includes("swarm") && !ws.url().includes("trexname.com")) return;

        ws.on("framereceived", (frame) => {
          if (resolved) return;

          try {
            const payload = frame.payload.toString();
            // Skip non-JSON frames
            if (!payload.startsWith("{")) return;

            const msg = JSON.parse(payload);

            // Look for game data responses (they have sport > region > competition > game structure)
            if (msg.code === 0 && msg.data?.data?.sport) {
              const data = msg.data.data as SwarmData;

              // Check if this response has games with markets
              let hasGamesWithMarkets = false;
              let gameCount = 0;
              let totalMarkets = 0;
              let hasTargetGame = false;

              for (const sport of Object.values(data.sport || {})) {
                for (const region of Object.values(sport.region || {})) {
                  for (const competition of Object.values(region.competition || {})) {
                    for (const game of Object.values(competition.game || {})) {
                      gameCount++;
                      const marketCount = Object.keys(game.market || {}).length;
                      totalMarkets += marketCount;
                      if (marketCount > 0) {
                        hasGamesWithMarkets = true;
                      }
                      // Check if this is our target game (check both game_number and id)
                      if (targetGameNumber && (game.game_number === targetGameNumber || game.id === targetGameNumber)) {
                        hasTargetGame = true;
                      }
                    }
                  }
                }
              }

              if (hasGamesWithMarkets && gameCount > 0) {
                // If competitionId filter is set, check if this response has that competition
                let hasTargetCompetition = !competitionId;
                if (competitionId) {
                  for (const sport of Object.values(data.sport || {})) {
                    for (const region of Object.values(sport.region || {})) {
                      for (const competition of Object.values(region.competition || {})) {
                        if (competition.id === competitionId) {
                          hasTargetCompetition = true;
                          break;
                        }
                      }
                    }
                  }
                }

                if (singleEventMode) {
                  // For match details: look for response with target game and many markets
                  if (targetGameNumber) {
                    // Only consider responses containing the target game
                    if (hasTargetGame && totalMarkets > bestMarketCount) {
                      bestMarketCount = totalMarkets;
                      bestData = data;
                      // Resolve when we have the target game with extended markets
                      if (totalMarkets >= 50) {
                        resolved = true;
                        resolve(data);
                        return;
                      }
                    }
                  } else {
                    // No target game, just look for many markets
                    if (totalMarkets > bestMarketCount) {
                      bestMarketCount = totalMarkets;
                      bestData = data;
                    }
                    if (totalMarkets >= 50) {
                      resolved = true;
                      resolve(data);
                      return;
                    }
                  }
                } else if (hasTargetCompetition) {
                  // For league listing: resolve when we have the target competition
                  resolved = true;
                  resolve(data);
                  return;
                }
              }
            }
          } catch {
            // Not valid JSON or parsing error
          }
        });
      });

      // Timeout - return best captured data (reduced from 25s to 10s)
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(bestData);
        }
      }, 10000);
    });
  }

  private countMarkets(data: SwarmData): number {
    let count = 0;
    for (const sport of Object.values(data.sport || {})) {
      for (const region of Object.values(sport.region || {})) {
        for (const competition of Object.values(region.competition || {})) {
          for (const game of Object.values(competition.game || {})) {
            count += Object.keys(game.market || {}).length;
          }
        }
      }
    }
    return count;
  }

  private parseSwarmData(data: SwarmData, league: string, competitionId: number): RawScrapedOdds[] {
    const matches: RawScrapedOdds[] = [];

    for (const sport of Object.values(data.sport || {})) {
      // Only football
      if (sport.alias !== "Soccer") continue;

      for (const region of Object.values(sport.region || {})) {
        for (const competition of Object.values(region.competition || {})) {
          // Filter by competition ID to avoid scraping other leagues (e.g., Champions League)
          if (competition.id !== competitionId) continue;

          for (const game of Object.values(competition.game || {})) {
            // Skip blocked games
            if (game.is_blocked) continue;

            const homeTeam = game.team1_name?.trim();
            const awayTeam = game.team2_name?.trim();
            if (!homeTeam || !awayTeam) continue;

            // Find 1X2 market (P1XP2 type)
            let homeOdds = 0, drawOdds = 0, awayOdds = 0;

            for (const market of Object.values(game.market || {})) {
              if (market.type === SWARM_MARKET_TYPES.MATCH_RESULT) {
                for (const event of Object.values(market.event || {})) {
                  const price = event.price;
                  if (!price || price <= 1) continue;

                  if (event.type_1 === "W1") homeOdds = price;
                  else if (event.type_1 === "X") drawOdds = price;
                  else if (event.type_1 === "W2") awayOdds = price;
                }
                break;
              }
            }

            // Skip if no valid 1X2 odds
            if (homeOdds <= 1 || drawOdds <= 1 || awayOdds <= 1) continue;

            // Build event URL - use game.id, not game_number. Keep original region alias case.
            const regionAlias = region.alias || "England";
            const eventUrl = `https://www.betcris.pl/zaklady-bukmacherskie/match/Soccer/${regionAlias}/${competition.id}/${game.id}`;

            matches.push({
              bookmaker: this.bookmaker,
              eventName: `${homeTeam} - ${awayTeam}`,
              homeTeam: getCanonicalTeamName(homeTeam, league),
              awayTeam: getCanonicalTeamName(awayTeam, league),
              homeOdds,
              drawOdds,
              awayOdds,
              hasNoTaxPromo: false,
              scrapedAt: new Date(),
              eventUrl,
            });
          }
        }
      }
    }

    return matches;
  }

  // Fallback DOM scraping method
  private async scrapeLeagueDOM(page: Page, league: string, startTime: number): Promise<ScraperResult> {
    const SELECTORS = {
      matchCard: "[data-testid='game']",
      teamName: ".comp__team-name",
      oddsButton: "[data-testid='odd']",
      oddsValue: ".xOddButton__coef",
    };

    await this.delay(5000);
    const hasMatches = await this.waitForSelector(page, SELECTORS.matchCard, 15000);
    if (!hasMatches) return this.createNotFoundResult(`No matches found for ${league}`, Date.now() - startTime);

    const matchData = await page.evaluate((selectors) => {
      const matches: any[] = [];
      document.querySelectorAll(selectors.matchCard).forEach((card) => {
        const teamElements = card.querySelectorAll(selectors.teamName);
        if (teamElements.length < 2) return;
        const home = teamElements[0]?.textContent?.trim() || "";
        const away = teamElements[1]?.textContent?.trim() || "";
        const oddElements = card.querySelectorAll(selectors.oddsButton);
        const odds = Array.from(oddElements).slice(0, 3).map(el => {
          const valEl = el.querySelector(selectors.oddsValue);
          const t = (valEl?.textContent || el.textContent)?.trim()?.match(/(\d+[.,]?\d*)/);
          return t ? parseFloat(t[1].replace(",", ".")) : 0;
        });
        if (odds.length >= 3 && !odds.some(isNaN)) {
          const link = card.querySelector("a[href*='/zaklady-bukmacherskie/']") as HTMLAnchorElement || card.closest("a") as HTMLAnchorElement;
          matches.push({ homeTeam: home, awayTeam: away, homeOdds: odds[0], drawOdds: odds[1], awayOdds: odds[2], eventUrl: link?.href });
        }
      });
      return matches;
    }, SELECTORS);

    const data = matchData.map(m => ({
      bookmaker: "betcris" as const,
      eventName: `${m.homeTeam} - ${m.awayTeam}`,
      homeTeam: getCanonicalTeamName(m.homeTeam, league),
      awayTeam: getCanonicalTeamName(m.awayTeam, league),
      homeOdds: m.homeOdds,
      drawOdds: m.drawOdds,
      awayOdds: m.awayOdds,
      hasNoTaxPromo: false,
      scrapedAt: new Date(),
      eventUrl: m.eventUrl
    }));

    console.log(`[Betcris] Scraped ${data.length} matches for ${league} via DOM`);
    return { status: "success", bookmaker: this.bookmaker, data, duration: Date.now() - startTime, timestamp: new Date() };
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

      // Extract game_id from URL: .../Soccer/England/538/28660755
      const urlParts = eventUrl.split("/");
      const gameId = parseInt(urlParts[urlParts.length - 1], 10) || undefined;

      if (!gameId) {
        return this.createMatchDetailNotFoundResult("Invalid URL format", Date.now() - startTime);
      }

      // Set up WebSocket interception for match details
      const wsDataPromise = this.captureSwarmData(page, undefined, true, gameId);

      // Navigate directly to match page
      await page.goto(eventUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

      const wsData = await Promise.race([
        wsDataPromise,
        this.delay(10000).then(() => null)
      ]);

      if (wsData) {
        const matchData = this.parseMatchDetailFromSwarm(wsData, eventUrl, gameId);
        if (matchData) {
          return { status: "success", bookmaker: this.bookmaker, data: matchData, duration: Date.now() - startTime, timestamp: new Date() };
        }
        console.log(`[Betcris] WebSocket data received but game ${gameId} not found or has insufficient markets`);
      } else {
        console.log(`[Betcris] No WebSocket data received for game ${gameId}`);
      }

      return this.createMatchDetailNotFoundResult(`Game ${gameId} details not found`, Date.now() - startTime);
    } catch (error) {
      return this.createMatchDetailErrorResult(error, Date.now() - startTime);
    } finally {
      if (page) await page.close();
    }
  }

  private parseMatchDetailFromSwarm(data: SwarmData, eventUrl: string, targetGameId?: number): RawScrapedMatchOdds | null {
    // Find the specific game by ID, fallback to game with most markets
    let targetGame: SwarmGame | null = null;
    let bestGame: SwarmGame | null = null;
    let maxMarkets = 0;

    for (const sport of Object.values(data.sport || {})) {
      for (const region of Object.values(sport.region || {})) {
        for (const competition of Object.values(region.competition || {})) {
          for (const game of Object.values(competition.game || {})) {
            const marketCount = Object.keys(game.market || {}).length;

            // Check if this is our target game by ID
            if (targetGameId && game.id === targetGameId) {
              targetGame = game;
            }

            // Also track the game with most markets as fallback
            if (marketCount > maxMarkets) {
              maxMarkets = marketCount;
              bestGame = game;
            }
          }
        }
      }
    }

    // Prefer target game, fallback to best game
    const game = targetGame || bestGame;
    if (!game || Object.keys(game.market || {}).length < 10) return null;

    const homeTeam = game.team1_name?.trim();
    const awayTeam = game.team2_name?.trim();
    if (!homeTeam) return null;

    // Initialize markets
    const m1X2 = { home: 0, draw: 0, away: 0 };
    const mDC = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
    const mOU: Record<string, MarketOverUnderOdds> = {};
    const mBTTS = { yes: 0, no: 0 };

    for (const market of Object.values(game.market || {})) {
      const marketName = market.name?.toLowerCase() || "";
      const marketType = market.type || "";

      // 1X2 - "Wynik meczu" with P1XP2 type
      if (marketType === SWARM_MARKET_TYPES.MATCH_RESULT || marketName.includes("wynik meczu")) {
        for (const event of Object.values(market.event || {})) {
          const price = event.price;
          if (!price || price <= 1) continue;

          if (event.type_1 === "W1") m1X2.home = price;
          else if (event.type_1 === "X") m1X2.draw = price;
          else if (event.type_1 === "W2") m1X2.away = price;
        }
      }
      // Double Chance - "Podwójna szansa" or DC type
      else if (marketName.includes("podwójna szansa") || marketName.includes("double chance")) {
        for (const event of Object.values(market.event || {})) {
          const price = event.price;
          const name = event.name?.toLowerCase() || "";
          const type1 = event.type_1?.toUpperCase() || "";
          if (!price || price <= 1) continue;

          if (type1 === "1X" || name.includes("1x") || name.includes("w1 lub x")) mDC.homeOrDraw = price;
          else if (type1 === "X2" || name.includes("x2") || name.includes("x lub w2")) mDC.drawOrAway = price;
          else if (type1 === "12" || name.includes("12") || name.includes("w1 lub w2")) mDC.homeOrAway = price;
        }
      }
      // Over/Under - exact type "OverUnder" only (not HalfTimeOverUnder, Team1OverUnder, etc.)
      else if (marketType === "OverUnder") {
        const base = market.base;

        if (base && base > 0 && base.toString().includes(".5")) {
          const line = base.toFixed(1);
          if (!mOU[line]) mOU[line] = { over: 0, under: 0 };

          for (const event of Object.values(market.event || {})) {
            const price = event.price;
            const type1 = event.type_1?.toLowerCase() || "";
            if (!price || price <= 1) continue;

            if (type1 === "over") mOU[line].over = price;
            else if (type1 === "under") mOU[line].under = price;
          }
        }
      }
      // BTTS - exact type "BothTeamsToScore" only (not 1stHalf, 2ndHalf, or combo markets)
      else if (marketType === "BothTeamsToScore") {
        for (const event of Object.values(market.event || {})) {
          const price = event.price;
          const type1 = event.type_1?.toLowerCase() || "";
          if (!price || price <= 1) continue;

          if (type1 === "yes") mBTTS.yes = price;
          else if (type1 === "no") mBTTS.no = price;
        }
      }
    }

    return {
      bookmaker: "betcris",
      eventName: `${homeTeam} - ${awayTeam}`,
      homeTeam,
      awayTeam,
      eventUrl,
      hasNoTaxPromo: false,
      scrapedAt: new Date(),
      market1X2: m1X2,
      marketDoubleChance: mDC.homeOrDraw > 0 ? mDC : undefined,
      marketOverUnder: Object.keys(mOU).length > 0 ? mOU : undefined,
      marketBTTS: mBTTS.yes > 0 ? mBTTS : undefined,
    };
  }

  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    const SELECTORS = {
      matchCard: "[data-testid='game']",
      teamName: ".comp__team-name",
    };

    return page.evaluate((selectors) => {
      const entries: EventUrlEntry[] = [];
      document.querySelectorAll(selectors.matchCard).forEach((card) => {
        const teamElements = card.querySelectorAll(selectors.teamName);
        if (teamElements.length < 2) return;
        const home = teamElements[0]?.textContent?.trim() || "";
        const away = teamElements[1]?.textContent?.trim() || "";
        const link = card.querySelector("a[href*='/zaklady-bukmacherskie/']") as HTMLAnchorElement || card.closest("a") as HTMLAnchorElement;
        if (link?.href) entries.push({ matchKey: `${home} vs ${away}`, eventUrl: link.href });
      });
      return entries;
    }, SELECTORS);
  }
}

export const betcrisScraper = new BetcrisPlaywrightScraper();
