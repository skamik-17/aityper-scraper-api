/**
 * PZBuk Playwright Scraper
 * Uses WebSocket interception to capture RSocket data from PZBuk API
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

// League IDs for PZBuk API
const LEAGUE_IDS: Record<string, string> = {
  ekstraklasa: "524",
  "premier-league": "134",
};

// League page URLs for navigation
const LEAGUE_URLS: Record<string, string> = {
  ekstraklasa: "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/524-polska-ekstraklasa",
  "premier-league": "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/134-england-premier-league",
};

// Market type IDs in PZBuk
const MARKET_TYPES = {
  MATCH_RESULT: "1",      // 1X2
  DOUBLE_CHANCE: "10",    // 1X, X2, 12
  OVER_UNDER: "17",       // Total goals Over/Under
  BTTS: "27",             // Both teams to score
};

interface PZBukEvent {
  id: string;
  externalId: string;
  type: string;
  eventName: string;
  sportId: string;
  leagueId: string;
  leagueName: string;
  startingOn: string;
  status: string;
  isLive: boolean;
  isSuspended: boolean;
  primaryParticipants: Record<string, {
    id: string;
    name: string;
    venueRole: string;
  }>;
}

interface PZBukMarket {
  id: string;
  name: string;
  eventId: string;
  isSuspended: boolean;
  marketType: {
    id: string;
    name: string;
  };
  points?: number | string;
}

interface PZBukSelection {
  id: string;
  name: string;
  trueOdds: number;
  marketId: string;
  marketTypeId: string;
  eventId: string;
  outcomeType: string;
  status: string;
  order: number;
  points?: number;
}

interface PZBukInitialState {
  events: PZBukEvent[];
  markets: PZBukMarket[];
  selections: PZBukSelection[];
}

export class PzbukPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "pzbuk";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.pzbuk, ...config, enabled: true };
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();
    let page: Page | null = null;
    const leagueId = LEAGUE_IDS[league];
    const url = LEAGUE_URLS[league];
    if (!leagueId || !url) return this.createNotFoundResult(`Unknown league: ${league}`, Date.now() - startTime);

    try {
      page = await this.initBrowser();

      // Set up WebSocket interception
      const wsDataPromise = this.captureWebSocketData(page);

      // Navigate to page
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

      // Wait for WebSocket data (15s to allow polling to complete)
      const wsData = await Promise.race([
        wsDataPromise,
        this.delay(15000).then(() => null)
      ]);

      if (!wsData || !wsData.events || wsData.events.length === 0) {
        console.log("[PZBuk] No WebSocket data captured");
        return this.createNotFoundResult("No WebSocket data captured", Date.now() - startTime);
      }

      // Parse WebSocket data
      const matches = this.parseWebSocketData(wsData, league);

      if (matches.length === 0) {
        console.log("[PZBuk] No matches parsed from WebSocket data");
        return this.createNotFoundResult("No matches in WebSocket data", Date.now() - startTime);
      }

      console.log(`[PZBuk] Scraped ${matches.length} matches for ${league} via WebSocket`);
      return { status: "success", bookmaker: this.bookmaker, data: matches, duration: Date.now() - startTime, timestamp: new Date() };
    } catch (error) {
      return this.createErrorResult(error, Date.now() - startTime);
    } finally {
      if (page) await page.close();
    }
  }

  private async captureWebSocketData(page: Page, singleEvent = false): Promise<PZBukInitialState | null> {
    return new Promise((resolve) => {
      let resolved = false;
      let bestState: PZBukInitialState | null = null;

      page.on("websocket", (ws: PlaywrightWebSocket) => {
        if (!ws.url().includes("sportsbook-api/websocket")) return;

        ws.on("framereceived", (frame) => {
          if (resolved) return;

          try {
            const payload = frame.payload.toString();
            // RSocket frames have binary header, find JSON start
            const jsonStart = payload.indexOf("[{");
            if (jsonStart === -1) return;

            const jsonStr = payload.slice(jsonStart);
            const data = JSON.parse(jsonStr);

            // Look for INITIAL_STATE message with events and selections
            if (Array.isArray(data) && data[0]?.type === "INITIAL_STATE") {
              const state = data[0].payload as PZBukInitialState;
              if (state?.events?.length > 0 && state?.selections?.length > 0) {
                if (singleEvent) {
                  // For match details: want 1 event with most selections
                  if (state.events.length === 1) {
                    if (!bestState || state.selections.length > (bestState.selections?.length || 0)) {
                      bestState = state;
                      // Resolve if we have extended markets (> 10 selections means O/U, DC, BTTS etc.)
                      if (state.selections.length >= 20) {
                        resolved = true;
                        resolve(state);
                      }
                    }
                  }
                } else {
                  // For league listing: want multiple events
                  if (state.events.length > 1) {
                    resolved = true;
                    resolve(state);
                  }
                }
              }
            }
          } catch {
            // Not valid JSON or parsing error
          }
        });
      });

      // Early-exit polling (check every 300ms, max 12s for reliability under contention)
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        if (resolved) {
          clearInterval(checkInterval);
          return;
        }

        const elapsed = Date.now() - startTime;

        // Exit early if we have good data (any events with selections) after minimum wait
        if (elapsed >= 1000 && bestState && bestState.events?.length > 0 && bestState.selections?.length > 0) {
          resolved = true;
          clearInterval(checkInterval);
          resolve(bestState);
          return;
        }

        // Maximum timeout of 12s (for parallel league scraping with browser contention)
        if (elapsed >= 12000) {
          resolved = true;
          clearInterval(checkInterval);
          resolve(bestState);
        }
      }, 300);
    });
  }

  private parseWebSocketData(data: PZBukInitialState, league: string): RawScrapedOdds[] {
    const matches: RawScrapedOdds[] = [];

    // Group selections by eventId and marketTypeId
    const selectionsByEventAndMarket = new Map<string, PZBukSelection[]>();
    for (const selection of data.selections || []) {
      if (selection.status !== "Active") continue;
      const key = `${selection.eventId}:${selection.marketTypeId}`;
      const existing = selectionsByEventAndMarket.get(key) || [];
      existing.push(selection);
      selectionsByEventAndMarket.set(key, existing);
    }

    // Process events
    for (const event of data.events || []) {
      // Skip non-fixture events and suspended events
      if (event.type !== "Fixture" || event.isSuspended) continue;

      // Get team names from participants
      let homeTeam = "";
      let awayTeam = "";

      for (const participant of Object.values(event.primaryParticipants || {})) {
        if (participant.venueRole === "Home") {
          homeTeam = participant.name.trim();
        } else if (participant.venueRole === "Away") {
          awayTeam = participant.name.trim();
        }
      }

      // Fallback: parse eventName "Home - Away"
      if (!homeTeam || !awayTeam) {
        const parts = event.eventName.split(/\s*[-–vs.]+\s*/);
        if (parts.length >= 2) {
          homeTeam = parts[0].trim();
          awayTeam = parts[1].trim();
        }
      }

      if (!homeTeam || !awayTeam) continue;

      // Get 1X2 odds from selections
      const key1X2 = `${event.id}:${MARKET_TYPES.MATCH_RESULT}`;
      const selections1X2 = selectionsByEventAndMarket.get(key1X2) || [];

      let homeOdds = 0, drawOdds = 0, awayOdds = 0;

      for (const sel of selections1X2) {
        const odds = sel.trueOdds;
        if (!odds || odds <= 1) continue;

        // Use outcomeType to determine selection (Draw is called "Tie" in PZBuk)
        if (sel.outcomeType === "Home") {
          homeOdds = odds;
        } else if (sel.outcomeType === "Tie" || sel.outcomeType === "Draw") {
          drawOdds = odds;
        } else if (sel.outcomeType === "Away") {
          awayOdds = odds;
        }
      }

      // Skip if no valid 1X2 odds
      if (homeOdds <= 1 || drawOdds <= 1 || awayOdds <= 1) continue;

      // Build event URL with proper slug format
      const slug = `${homeTeam}-${awayTeam}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const leagueSlug = event.leagueName?.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'unknown';
      const eventUrl = `https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/${event.leagueId}-${leagueSlug}/events/${event.id}-${slug}`;

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

    return matches;
  }

  // Fallback DOM scraping method
  private async scrapeLeagueDOM(page: Page, league: string, startTime: number): Promise<ScraperResult> {
    const SELECTORS = {
      gameCard: "[data-at='game-card'], [class*='GameCardWrapper']",
      teamName: "[class*='ParticipantLabel'], small[class*='Participant']",
      oddsButton: "button[data-at='sportsbook-selection-btn']",
      oddsValue: "[class*='SelectionButtonOdds']",
    };

    await this.delay(5000);
    const hasMatches = await this.waitForSelector(page, SELECTORS.gameCard, 15000);
    if (!hasMatches) return this.createNotFoundResult(`No matches found for ${league}`, Date.now() - startTime);

    const matchData = await page.evaluate((selectors) => {
      const matches: any[] = [];
      document.querySelectorAll(selectors.gameCard).forEach((card) => {
        const teamNames = card.querySelectorAll(selectors.teamName);
        if (teamNames.length < 2) return;
        const home = teamNames[0]?.textContent?.trim() || "";
        const away = teamNames[1]?.textContent?.trim() || "";
        const oddsNodes = card.querySelectorAll(selectors.oddsButton);
        const odds = Array.from(oddsNodes).slice(0, 3).map(el => {
          const valEl = el.querySelector(selectors.oddsValue);
          return parseFloat((valEl?.textContent || el.textContent)?.trim()?.replace(",", ".") || "0");
        });
        if (odds.length === 3 && odds.every(o => o > 1)) {
          const link = card.querySelector("a[href*='/event/']") as HTMLAnchorElement || card.closest("a") as HTMLAnchorElement;
          matches.push({ homeTeam: home, awayTeam: away, homeOdds: odds[0], drawOdds: odds[1], awayOdds: odds[2], eventUrl: link?.href });
        }
      });
      return matches;
    }, SELECTORS);

    const data = matchData.map(m => ({
      bookmaker: "pzbuk" as const,
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

    console.log(`[PZBuk] Scraped ${data.length} matches for ${league} via DOM`);
    return { status: "success", bookmaker: this.bookmaker, data, duration: Date.now() - startTime, timestamp: new Date() };
  }

  async scrapeMatch(match: MatchIdentifier): Promise<ScraperResult> {
    const startTime = Date.now();
    const league = match.leagueId ?? "ekstraklasa";
    const allMatches = await this.scrapeLeague(league);
    if (allMatches.status !== "success" || !allMatches.data) return allMatches;

    const matchResult = findMatchingEvent({ homeTeam: match.homeTeam, awayTeam: match.awayTeam }, allMatches.data, league);
    if (!matchResult) return this.createNotFoundResult(`Match not found on PZBuk: ${match.homeTeam} vs ${match.awayTeam}`, Date.now() - startTime);

    return { status: "success", bookmaker: this.bookmaker, data: [matchResult.event], duration: Date.now() - startTime, timestamp: new Date() };
  }

  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();
    let page: Page | null = null;

    try {
      page = await this.initBrowser();

      // Set up WebSocket interception for match details (single event mode)
      const wsDataPromise = this.captureWebSocketData(page, true);

      await page.goto(eventUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

      const wsData = await Promise.race([
        wsDataPromise,
        this.delay(15000).then(() => null)
      ]);

      if (wsData && wsData.events?.length > 0 && wsData.markets?.length > 0) {
        const matchData = this.parseMatchDetailFromWebSocket(wsData, eventUrl);
        if (matchData) {
          return { status: "success", bookmaker: this.bookmaker, data: matchData, duration: Date.now() - startTime, timestamp: new Date() };
        }
      }

      // No DOM fallback - return not found if WebSocket fails
      return this.createMatchDetailNotFoundResult("No WebSocket data for match details", Date.now() - startTime);
    } catch (error) {
      return this.createMatchDetailErrorResult(error, Date.now() - startTime);
    } finally {
      if (page) await page.close();
    }
  }

  private parseMatchDetailFromWebSocket(data: PZBukInitialState, eventUrl: string): RawScrapedMatchOdds | null {
    const event = data.events?.[0];
    if (!event) return null;

    // Get team names
    let homeTeam = "";
    let awayTeam = "";

    for (const participant of Object.values(event.primaryParticipants || {})) {
      if (participant.venueRole === "Home") {
        homeTeam = participant.name.trim();
      } else if (participant.venueRole === "Away") {
        awayTeam = participant.name.trim();
      }
    }

    if (!homeTeam || !awayTeam) {
      const parts = event.eventName.split(/\s*[-–vs.]+\s*/);
      if (parts.length >= 2) {
        homeTeam = parts[0].trim();
        awayTeam = parts[1].trim();
      }
    }

    if (!homeTeam) return null;

    // Group selections by marketTypeId and points (for O/U)
    const selectionsByMarket = new Map<string, PZBukSelection[]>();
    for (const sel of data.selections || []) {
      if (sel.status !== "Active") continue;
      const key = sel.points ? `${sel.marketTypeId}:${sel.points}` : sel.marketTypeId;
      const existing = selectionsByMarket.get(key) || [];
      existing.push(sel);
      selectionsByMarket.set(key, existing);
    }

    // Initialize markets
    const m1X2 = { home: 0, draw: 0, away: 0 };
    const mDC = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
    const mOU: Record<string, MarketOverUnderOdds> = {};
    const mBTTS = { yes: 0, no: 0 };

    // 1X2 (Draw is called "Tie" in PZBuk)
    const sels1X2 = selectionsByMarket.get(MARKET_TYPES.MATCH_RESULT) || [];
    for (const sel of sels1X2) {
      if (sel.outcomeType === "Home") m1X2.home = sel.trueOdds;
      else if (sel.outcomeType === "Tie" || sel.outcomeType === "Draw") m1X2.draw = sel.trueOdds;
      else if (sel.outcomeType === "Away") m1X2.away = sel.trueOdds;
    }

    // Double Chance - names like "Team lub remis" (1X), "Team lub Team" (12), "remis lub Team" (X2)
    const selsDC = selectionsByMarket.get(MARKET_TYPES.DOUBLE_CHANCE) || [];
    for (const sel of selsDC) {
      const name = sel.name?.toLowerCase() || "";
      // 1X: home team + "lub remis" or outcomeType HomeOrDraw
      if (name.includes("lub remis") && !name.startsWith("remis") || sel.outcomeType === "HomeOrDraw") {
        mDC.homeOrDraw = sel.trueOdds;
      }
      // X2: starts with "remis lub" or outcomeType DrawOrAway
      else if (name.startsWith("remis lub") || sel.outcomeType === "DrawOrAway") {
        mDC.drawOrAway = sel.trueOdds;
      }
      // 12: two team names with "lub" or outcomeType HomeOrAway (no "remis")
      else if (name.includes(" lub ") && !name.includes("remis") || sel.outcomeType === "HomeOrAway") {
        mDC.homeOrAway = sel.trueOdds;
      }
    }

    // Over/Under - iterate through all selections with points
    for (const [key, sels] of selectionsByMarket) {
      if (!key.startsWith(MARKET_TYPES.OVER_UNDER + ":")) continue;
      const pointsStr = key.split(":")[1];
      if (!pointsStr || !pointsStr.includes(".5")) continue;
      const line = parseFloat(pointsStr).toFixed(1);
      if (!mOU[line]) mOU[line] = { over: 0, under: 0 };
      for (const sel of sels) {
        if (sel.outcomeType === "Over") mOU[line].over = sel.trueOdds;
        else if (sel.outcomeType === "Under") mOU[line].under = sel.trueOdds;
      }
    }

    // BTTS
    const selsBTTS = selectionsByMarket.get(MARKET_TYPES.BTTS) || [];
    for (const sel of selsBTTS) {
      const name = sel.name?.toLowerCase() || "";
      if (name === "tak" || name === "yes" || sel.outcomeType === "Yes") mBTTS.yes = sel.trueOdds;
      else if (name === "nie" || name === "no" || sel.outcomeType === "No") mBTTS.no = sel.trueOdds;
    }

    return {
      bookmaker: "pzbuk",
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

  private async scrapeMatchDetailsDOM(page: Page, eventUrl: string, startTime: number): Promise<MatchDetailResult> {
    const SELECTORS = {
      teamName: "[class*='ParticipantLabel'], small[class*='Participant']",
      oddsButton: "button[data-at='sportsbook-selection-btn']",
      oddsValue: "[class*='SelectionButtonOdds']",
      marketOddsLabel: "[class*='SelectionButtonLabel']",
    };

    await this.delay(5000);
    const hasOdds = await this.waitForSelector(page, SELECTORS.oddsButton, 10000);
    if (!hasOdds) return this.createMatchDetailNotFoundResult("No odds found", Date.now() - startTime);

    const data = await page.evaluate((selectors) => {
      let hTeam = "", aTeam = "";
      const teamElements = document.querySelectorAll(selectors.teamName);
      if (teamElements.length >= 2) {
        hTeam = teamElements[0]?.textContent?.trim() || "";
        aTeam = teamElements[1]?.textContent?.trim() || "";
      }
      if (!hTeam) {
        const title = document.querySelector("h1, [class*='EventTitle']")?.textContent;
        const m = title?.match(/(.+?)\s*[-–vs.]+\s*(.+)/i);
        if (m) { hTeam = m[1].trim(); aTeam = m[2].trim(); }
      }
      if (!hTeam) return null;

      const m1X2 = { home: 0, draw: 0, away: 0 };
      const mDC = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
      const mOU: Record<string, { over: number; under: number }> = {};
      const mBTTS = { yes: 0, no: 0 };

      document.querySelectorAll(selectors.oddsButton).forEach((btn: any) => {
        const label = (btn.querySelector(selectors.marketOddsLabel)?.textContent?.trim() || "").toLowerCase();
        const valueText = btn.querySelector(selectors.oddsValue)?.textContent?.trim() || btn.textContent?.trim() || "";
        const valMatch = valueText.match(/(\d+[.,]\d+)/);
        const value = valMatch ? parseFloat(valMatch[1].replace(",", ".")) : 0;
        if (isNaN(value) || value <= 1) return;

        if (label === "1" || label === hTeam.toLowerCase()) m1X2.home = value;
        else if (label === "x" || label === "remis") m1X2.draw = value;
        else if (label === "2" || label === aTeam.toLowerCase()) m1X2.away = value;
        else if (label === "1x") mDC.homeOrDraw = value;
        else if (label === "x2") mDC.drawOrAway = value;
        else if (label === "12") mDC.homeOrAway = value;
        else if (label === "tak" || label === "yes") mBTTS.yes = value;
        else if (label === "nie" || label === "no") mBTTS.no = value;

        const ouMatch = label.match(/(ponad|poniżej|over|under)\s*(\d+[.,]?\d*)/i);
        if (ouMatch) {
          const line = parseFloat(ouMatch[2].replace(",", ".")).toFixed(1);
          if (!mOU[line]) mOU[line] = { over: 0, under: 0 };
          if (ouMatch[1].startsWith("po") || ouMatch[1] === "over") mOU[line].over = value;
          else mOU[line].under = value;
        }
      });

      return { homeTeam: hTeam, awayTeam: aTeam, market1X2: m1X2, marketDoubleChance: mDC, marketOverUnder: mOU, marketBTTS: mBTTS };
    }, SELECTORS);

    if (!data) return this.createMatchDetailNotFoundResult("Could not parse data", Date.now() - startTime);

    return {
      status: "success",
      bookmaker: this.bookmaker,
      data: {
        bookmaker: "pzbuk",
        eventName: `${data.homeTeam} - ${data.awayTeam}`,
        homeTeam: data.homeTeam,
        awayTeam: data.awayTeam,
        eventUrl,
        hasNoTaxPromo: false,
        scrapedAt: new Date(),
        market1X2: data.market1X2,
        marketDoubleChance: data.marketDoubleChance.homeOrDraw > 0 ? data.marketDoubleChance : undefined,
        marketOverUnder: Object.keys(data.marketOverUnder).length > 0 ? data.marketOverUnder as Record<string, MarketOverUnderOdds> : undefined,
        marketBTTS: data.marketBTTS.yes > 0 ? data.marketBTTS : undefined,
      },
      duration: Date.now() - startTime,
      timestamp: new Date()
    };
  }

  async extractEventUrls(page: Page): Promise<EventUrlEntry[]> {
    const SELECTORS = {
      gameCard: "[data-at='game-card'], [class*='GameCardWrapper']",
      teamName: "[class*='ParticipantLabel'], small[class*='Participant']",
    };

    return page.evaluate((selectors) => {
      const entries: EventUrlEntry[] = [];
      document.querySelectorAll(selectors.gameCard).forEach((card) => {
        const teamNames = card.querySelectorAll(selectors.teamName);
        if (teamNames.length < 2) return;
        const h = teamNames[0]?.textContent?.trim() || "";
        const a = teamNames[1]?.textContent?.trim() || "";
        const link = card.querySelector("a[href*='/event/']") as HTMLAnchorElement || card.closest("a") as HTMLAnchorElement;
        if (h && a && link?.href) {
          entries.push({ matchKey: `${h} vs ${a}`, eventUrl: link.href });
        }
      });
      return entries;
    }, SELECTORS);
  }
}

export const pzbukScraper = new PzbukPlaywrightScraper();
