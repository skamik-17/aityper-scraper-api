/**
 * Betclic gRPC API Scraper
 * Scrapes odds from betclic.pl using gRPC-web API endpoints
 */

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
import { DEFAULT_SCRAPER_CONFIGS } from "../../types/scraper.js";
import { PlaywrightScraper } from "../base/playwright-base.js";
import { findMatchingEvent, getCanonicalTeamName } from "../team-matcher.js";

// Competition IDs for gRPC API
const COMPETITION_IDS: Record<string, number> = {
  "premier-league": 3,
  ekstraklasa: 221, // May not have matches currently
};

// URL slugs for leagues
const LEAGUE_SLUGS: Record<string, string> = {
  "premier-league": "premier-league-c3",
  ekstraklasa: "ekstraklasa-c221",
};

// gRPC endpoints
const GRPC_BASE = "https://offering.begmedia.com/web/offering.access.api/offering.access.api.MatchService";
const ENDPOINTS = {
  listing: `${GRPC_BASE}/GetMatchesByCompetitionWithNotifications`,
  match: `${GRPC_BASE}/GetMatchWithNotification`,
};

// Headers for gRPC-web requests
const GRPC_HEADERS = {
  "Content-Type": "application/grpc-web-text",
  Accept: "application/grpc-web-text",
  "X-Grpc-Web": "1",
  "X-Bg-Ref-Brand": "BETCLIC",
  "X-Bg-Ref-Platform": "DESKTOP",
  "X-Bg-Ref-Regulator-Zone": "PL",
  "X-Bg-Regulation": "PL",
};

// ============ Protobuf Helpers ============

function readVarint(buf: Buffer, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  while (offset + bytesRead < buf.length) {
    const b = buf[offset + bytesRead++];
    value |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return { value, bytesRead };
}

function encodeVarint(n: number): number[] {
  const bytes: number[] = [];
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n);
  return bytes;
}

function encodeBigVarint(n: bigint): number[] {
  const bytes: number[] = [];
  while (n > 0x7fn) {
    bytes.push(Number(n & 0x7fn) | 0x80);
    n >>= 7n;
  }
  bytes.push(Number(n));
  return bytes;
}

function parseFields(buf: Buffer): Map<number, any[]> {
  const fields = new Map<number, any[]>();
  let offset = 0;

  while (offset < buf.length) {
    const tag = readVarint(buf, offset);
    if (tag.bytesRead === 0) break;
    offset += tag.bytesRead;
    const fieldNum = tag.value >> 3;
    const wireType = tag.value & 0x07;

    let value: any;

    if (wireType === 0) {
      const v = readVarint(buf, offset);
      offset += v.bytesRead;
      value = { type: "varint", data: v.value };
    } else if (wireType === 2) {
      const len = readVarint(buf, offset);
      offset += len.bytesRead;
      if (offset + len.value > buf.length) break;
      const data = buf.slice(offset, offset + len.value);
      offset += len.value;
      value = { type: "bytes", data };
    } else if (wireType === 5) {
      if (offset + 4 > buf.length) break;
      value = { type: "float", data: buf.readFloatLE(offset) };
      offset += 4;
    } else if (wireType === 1) {
      if (offset + 8 > buf.length) break;
      value = { type: "double", data: buf.readDoubleLE(offset) };
      offset += 8;
    } else {
      break;
    }

    if (!fields.has(fieldNum)) fields.set(fieldNum, []);
    fields.get(fieldNum)!.push(value);
  }

  return fields;
}

function getString(fields: Map<number, any[]>, num: number): string | null {
  const f = fields.get(num)?.[0];
  if (f?.type === "bytes") {
    return f.data.toString("utf8");
  }
  return null;
}

function getVarint(fields: Map<number, any[]>, num: number): number | null {
  const f = fields.get(num)?.[0];
  if (f?.type === "varint") {
    return f.data;
  }
  return null;
}

// Read varint as BigInt for large values
function readVarintBigInt(buf: Buffer, offset: number): { value: bigint; bytesRead: number } {
  let value = 0n;
  let shift = 0n;
  let bytesRead = 0;
  while (offset + bytesRead < buf.length) {
    const b = buf[offset + bytesRead++];
    value |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7n;
  }
  return { value, bytesRead };
}

function getVarintBigInt(fields: Map<number, any[]>, num: number, buf: Buffer): bigint | null {
  // Re-parse to get bigint value - look for field with this number
  let offset = 0;
  while (offset < buf.length) {
    const tagResult = readVarintBigInt(buf, offset);
    offset += tagResult.bytesRead;
    const tag = Number(tagResult.value);
    const fieldNum = tag >> 3;
    const wireType = tag & 0x07;

    if (wireType === 0) {
      const v = readVarintBigInt(buf, offset);
      if (fieldNum === num) return v.value;
      offset += v.bytesRead;
    } else if (wireType === 2) {
      const len = readVarint(buf, offset);
      offset += len.bytesRead + len.value;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      break;
    }
  }
  return null;
}

function getDouble(fields: Map<number, any[]>, num: number): number | null {
  const f = fields.get(num)?.[0];
  if (f?.type === "double") return f.data;
  if (f?.type === "float") return f.data;
  return null;
}

function getMessage(fields: Map<number, any[]>, num: number): Map<number, any[]> | null {
  const f = fields.get(num)?.[0];
  if (f?.type === "bytes") {
    try {
      return parseFields(f.data);
    } catch {
      return null;
    }
  }
  return null;
}

function getMessages(fields: Map<number, any[]>, num: number): Map<number, any[]>[] {
  const results: Map<number, any[]>[] = [];
  const arr = fields.get(num) || [];
  for (const f of arr) {
    if (f?.type === "bytes") {
      try {
        results.push(parseFields(f.data));
      } catch {
        // Skip invalid messages
      }
    }
  }
  return results;
}

// ============ API Request Helpers ============

async function fetchGrpcStream(url: string, body: Buffer, timeoutMs: number = 8000): Promise<Buffer> {
  const frame = Buffer.alloc(5 + body.length);
  frame[0] = 0;
  frame.writeUInt32BE(body.length, 1);
  body.copy(frame, 5);

  const response = await fetch(url, {
    method: "POST",
    headers: GRPC_HEADERS,
    body: frame.toString("base64"),
  });

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body reader");

  const chunks: Uint8Array[] = [];
  const timeout = setTimeout(() => reader.cancel(), timeoutMs);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    clearTimeout(timeout);
  }

  const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
  const decoded = Buffer.from(text.replace(/[\r\n]/g, ""), "base64");

  // Extract message from frame (skip 5-byte header)
  if (decoded.length > 5) {
    const msgLen = decoded.readUInt32BE(1);
    return decoded.slice(5, 5 + msgLen);
  }

  return decoded.slice(5);
}

// ============ Main Scraper Class ============

export class BetclicPlaywrightScraper extends PlaywrightScraper {
  bookmaker: PolishBookmaker = "betclic";
  config: ScraperConfig;

  constructor(config?: Partial<ScraperConfig>) {
    super();
    this.config = { ...DEFAULT_SCRAPER_CONFIGS.betclic, ...config, enabled: true };
  }

  async scrapeLeague(league: string): Promise<ScraperResult> {
    const startTime = Date.now();

    const competitionId = COMPETITION_IDS[league];
    if (!competitionId) {
      return this.createNotFoundResult(`Unknown league: ${league}`, Date.now() - startTime);
    }

    try {
      // Build request: field 1 = competition ID as varint
      const msgBytes = Buffer.from([0x08, ...encodeVarint(competitionId)]);
      const data = await fetchGrpcStream(ENDPOINTS.listing, msgBytes);

      if (data.length < 10) {
        return this.createNotFoundResult(
          `No ${league} matches found on Betclic`,
          Date.now() - startTime
        );
      }

      const matches = this.parseListingResponse(data, league);

      if (matches.length === 0) {
        return this.createNotFoundResult(
          `Could not parse any ${league} match data from Betclic`,
          Date.now() - startTime
        );
      }

      console.log(`[Betclic] Successfully scraped ${matches.length} ${league} matches via API`);

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data: matches,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("[Betclic] API scraping error:", error);
      return this.createErrorResult(error, Date.now() - startTime);
    }
  }

  /**
   * Parse listing response for 1X2 odds
   */
  private parseListingResponse(data: Buffer, league: string): RawScrapedOdds[] {
    const matches: RawScrapedOdds[] = [];
    const leagueSlug = LEAGUE_SLUGS[league] || league;

    try {
      const root = parseFields(data);
      const wrapper = getMessage(root, 1);
      if (!wrapper) return matches;

      // Field 3 contains match entries
      const matchMsgs = getMessages(wrapper, 3);

      // Get raw match message bytes for BigInt parsing
      const matchRawMsgs = wrapper.get(3) || [];

      for (let i = 0; i < matchMsgs.length; i++) {
        const match = matchMsgs[i];
        const matchRaw = matchRawMsgs[i];

        const matchName = getString(match, 2) || "";
        const parts = matchName.split(" - ").map((t) => t.trim());
        if (parts.length !== 2) continue;

        const [homeTeam, awayTeam] = parts;

        // Extract match ID from field 1 as BigInt (can be very large)
        let matchId: string | null = null;
        if (matchRaw?.type === "bytes") {
          const bigId = getVarintBigInt(match, 1, matchRaw.data);
          if (bigId !== null) {
            matchId = bigId.toString();
          }
        }

        // Field 9 contains markets
        const markets = getMessages(match, 9);
        if (markets.length === 0) continue;

        // First market should be 1X2
        const market = markets[0];

        // Field 16 contains outcomes
        const outcomes = getMessages(market, 16);
        if (outcomes.length < 3) continue;

        const odds: number[] = [];
        for (const outcome of outcomes) {
          const outcomeOdds = getDouble(outcome, 12);
          if (outcomeOdds && outcomeOdds > 1) {
            odds.push(outcomeOdds);
          }
        }

        if (odds.length >= 3) {
          // Build event URL (format: https://www.betclic.pl/pilka-nozna-sfootball/premier-league-c3/team1-team2-m123456)
          const homeSlug = homeTeam.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
          const awaySlug = awayTeam.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
          const eventUrl = matchId !== null
            ? `https://www.betclic.pl/pilka-nozna-sfootball/${leagueSlug}/${homeSlug}-${awaySlug}-m${matchId}`
            : undefined;

          matches.push({
            bookmaker: "betclic",
            eventName: matchName,
            homeTeam: getCanonicalTeamName(homeTeam, league),
            awayTeam: getCanonicalTeamName(awayTeam, league),
            homeOdds: odds[0],
            drawOdds: odds[1],
            awayOdds: odds[2],
            hasNoTaxPromo: false,
            scrapedAt: new Date(),
            eventUrl,
          });
        }
      }
    } catch (error) {
      console.error("[Betclic] Error parsing listing response:", error);
    }

    return matches;
  }

  async scrapeMatchDetails(eventUrl: string): Promise<MatchDetailResult> {
    const startTime = Date.now();

    try {
      // Extract match ID from URL (format: .../match-name-m123456789)
      const matchIdMatch = eventUrl.match(/m(\d+)$/);
      if (!matchIdMatch) {
        return {
          status: "error",
          bookmaker: this.bookmaker,
          error: "Could not extract match ID from URL",
          duration: Date.now() - startTime,
          timestamp: new Date(),
        };
      }

      const matchId = matchIdMatch[1];

      // Build request: field 1 = match ID as varint
      const msgBytes = Buffer.from([0x08, ...encodeBigVarint(BigInt(matchId))]);
      const data = await fetchGrpcStream(ENDPOINTS.match, msgBytes);

      if (data.length < 100) {
        return {
          status: "error",
          bookmaker: this.bookmaker,
          error: "No match data received",
          duration: Date.now() - startTime,
          timestamp: new Date(),
        };
      }

      const matchOdds = this.parseMatchDetailsResponse(data, eventUrl);

      if (!matchOdds) {
        return {
          status: "error",
          bookmaker: this.bookmaker,
          error: "Could not parse match data",
          duration: Date.now() - startTime,
          timestamp: new Date(),
        };
      }

      return {
        status: "success",
        bookmaker: this.bookmaker,
        data: matchOdds,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("[Betclic] Error scraping match details:", error);
      return {
        status: "error",
        bookmaker: this.bookmaker,
        error: error instanceof Error ? error.message : "Unknown error",
        duration: Date.now() - startTime,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Parse match details response for extended markets
   */
  private parseMatchDetailsResponse(data: Buffer, eventUrl: string = ""): RawScrapedMatchOdds | null {
    try {
      // Extract all outcomes by scanning for field 12 doubles with preceding name strings
      const outcomes = this.extractAllOutcomes(data);

      if (outcomes.length === 0) return null;

      // Get match info
      const root = parseFields(data);
      const wrapper = getMessage(root, 1);
      const matchInfo = wrapper ? getMessage(wrapper, 1) : null;
      const matchName = matchInfo ? getString(matchInfo, 2) || "" : "";
      const parts = matchName.split(" - ").map((t) => t.trim());
      const homeTeam = parts[0] || "";
      const awayTeam = parts[1] || "";

      // Initialize market data
      const market1X2 = { home: 0, draw: 0, away: 0 };
      const marketDoubleChance = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
      const marketOverUnder: Record<string, { over: number; under: number }> = {};
      const marketBTTS = { yes: 0, no: 0 };

      // Find 1X2 outcomes
      const homeOutcome = outcomes.find(
        (o) => o.name === homeTeam && o.odds > 1.5 && o.odds < 10
      );
      const drawOutcome = outcomes.find(
        (o) => (o.name === "Remis" || o.name === "Remis ") && o.odds > 2 && o.odds < 10
      );
      const awayOutcome = outcomes.find(
        (o) => o.name === awayTeam && o.odds > 1.5 && o.odds < 10
      );

      if (homeOutcome && drawOutcome && awayOutcome) {
        market1X2.home = homeOutcome.odds;
        market1X2.draw = drawOutcome.odds;
        market1X2.away = awayOutcome.odds;
      }

      // Find Double Chance outcomes
      const dc1X = outcomes.find((o) => o.name.includes("lub remis") && o.name.includes(homeTeam));
      const dcX2 = outcomes.find((o) => o.name.includes("Remis lub") && o.name.includes(awayTeam));
      const dc12 = outcomes.find(
        (o) => o.name.includes(homeTeam) && o.name.includes(awayTeam) && o.name.includes("lub")
      );

      if (dc1X && dcX2 && dc12) {
        marketDoubleChance.homeOrDraw = dc1X.odds;
        marketDoubleChance.drawOrAway = dcX2.odds;
        marketDoubleChance.homeOrAway = dc12.odds;
      }

      // Find BTTS outcomes
      const bttsYes = outcomes.find((o) => o.name === "Tak" && o.odds > 1.5 && o.odds < 3);
      const bttsNo = outcomes.find((o) => o.name === "Nie" && o.odds > 1.5 && o.odds < 3);

      if (bttsYes && bttsNo) {
        marketBTTS.yes = bttsYes.odds;
        marketBTTS.no = bttsNo.odds;
      }

      // Find Over/Under outcomes
      const ouLines = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
      for (const line of ouLines) {
        const lineStr = line.toString().replace(".", ",");
        const overOutcome = outcomes.find(
          (o) => o.name === `Powyżej ${lineStr}` && o.odds > 1.01
        );
        const underOutcome = outcomes.find(
          (o) => o.name === `Poniżej ${lineStr}` && o.odds > 1.01
        );

        if (overOutcome && underOutcome) {
          marketOverUnder[line.toFixed(1)] = {
            over: overOutcome.odds,
            under: underOutcome.odds,
          };
        }
      }

      return {
        bookmaker: "betclic",
        eventName: matchName,
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
    } catch (error) {
      console.error("[Betclic] Error parsing match details:", error);
      return null;
    }
  }

  /**
   * Extract all outcomes by scanning buffer for odds patterns
   */
  private extractAllOutcomes(buf: Buffer): { name: string; odds: number }[] {
    const outcomes: { name: string; odds: number }[] = [];
    const seen = new Set<string>();

    // Scan for field 12 doubles (tag 0x61 = field 12, wire type 1)
    for (let i = 1; i < buf.length - 8; i++) {
      if (buf[i - 1] === 0x61) {
        const odds = buf.readDoubleLE(i);
        if (odds >= 1.01 && odds < 100 && isFinite(odds)) {
          // Search backwards for name (field 10: 0x52 or field 11: 0x5a)
          const searchStart = Math.max(0, i - 150);

          for (let j = i - 2; j >= searchStart; j--) {
            if ((buf[j] === 0x52 || buf[j] === 0x5a) && j + 1 < i) {
              const len = buf[j + 1];
              if (len > 0 && len < 60 && j + 2 + len <= i) {
                const str = buf.slice(j + 2, j + 2 + len).toString("utf8");
                if (/^[\x20-\x7E\xA0-\xFF\u0100-\uFFFF]+$/.test(str) && str.length >= 2) {
                  const name = str.trim();
                  const key = `${name}:${odds.toFixed(2)}`;
                  if (!seen.has(key)) {
                    seen.add(key);
                    outcomes.push({ name, odds });
                  }
                  break;
                }
              }
            }
          }
        }
      }
    }

    return outcomes;
  }

  async extractEventUrls(): Promise<EventUrlEntry[]> {
    // Event URLs can be constructed from match IDs obtained via listing
    return [];
  }

  async scrapeMatch(match: MatchIdentifier): Promise<ScraperResult> {
    const startTime = Date.now();
    const league = match.leagueId ?? "premier-league";

    try {
      const allMatches = await this.scrapeLeague(league);

      if (allMatches.status !== "success" || !allMatches.data) {
        return allMatches;
      }

      const matchResult = findMatchingEvent(
        { homeTeam: match.homeTeam, awayTeam: match.awayTeam },
        allMatches.data,
        league
      );

      if (!matchResult) {
        return this.createNotFoundResult(
          `Match not found on Betclic: ${match.homeTeam} vs ${match.awayTeam}`,
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
    } catch (error) {
      return this.createErrorResult(error, Date.now() - startTime);
    }
  }
}

// Singleton instance
export const betclicPlaywrightScraper = new BetclicPlaywrightScraper();
