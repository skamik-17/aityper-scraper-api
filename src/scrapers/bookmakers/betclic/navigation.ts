/**
 * Betclic Navigation Module
 *
 * Handles gRPC-web API interactions for the Betclic scraper.
 * Betclic uses Protocol Buffers over gRPC-web for data fetching.
 *
 * This module handles:
 * - Building gRPC request payloads
 * - Fetching listing data (matches by competition)
 * - Fetching match details (full offer)
 * - Frame encoding/decoding for gRPC-web transport
 *
 * NOTE: Unlike DOM scrapers, Betclic doesn't need Playwright for navigation.
 * We use native fetch with gRPC-web encoding.
 */

import {
  ENDPOINTS,
  GRPC_HEADERS,
  COMPETITION_IDS,
  LEAGUE_SLUGS,
  REQUEST_TIMEOUT,
  MAX_RETRIES,
  RETRY_DELAY,
} from "./constants.js";
import { encodeVarint, encodeBigVarint } from "./parser.js";

/**
 * Fetch data from gRPC-web endpoint with retry logic
 * Handles the gRPC-web frame encoding/decoding
 *
 * Note: gRPC-web uses streaming responses which may not auto-close.
 * We use node's https module with a read timeout to handle this.
 *
 * @param url - gRPC endpoint URL
 * @param body - Protobuf message body (without frame header)
 * @param timeoutMs - Request timeout in milliseconds
 * @returns Decoded response buffer
 */
export async function fetchGrpcStream(
  url: string,
  body: Buffer,
  timeoutMs: number = REQUEST_TIMEOUT
): Promise<Buffer> {
  // Build gRPC-web frame: 1 byte flag + 4 bytes length (big endian) + message
  const frame = Buffer.alloc(5 + body.length);
  frame[0] = 0; // Uncompressed flag
  frame.writeUInt32BE(body.length, 1);
  body.copy(frame, 5);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await fetchGrpcWithNodeHttp(url, frame, timeoutMs);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(
        `[Betclic/Navigation] Attempt ${attempt + 1}/${MAX_RETRIES} failed: ${lastError.message}`
      );

      if (attempt < MAX_RETRIES - 1) {
        // Wait before retry with exponential backoff
        const delay = RETRY_DELAY * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error("All retry attempts failed");
}

/**
 * Internal function to perform gRPC request using Node.js https module
 * This avoids fetch's stream handling issues with gRPC-web streaming endpoints
 */
async function fetchGrpcWithNodeHttp(
  url: string,
  frame: Buffer,
  timeoutMs: number
): Promise<Buffer> {
  // Dynamic import to avoid top-level import issues
  const https = await import("https");

  const parsedUrl = new URL(url);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname,
      method: "POST",
      headers: GRPC_HEADERS,
      timeout: timeoutMs,
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`gRPC request failed: HTTP ${res.statusCode}`));
        return;
      }

      let data = "";
      let readComplete = false;

      // Set a read timeout - gRPC-web streams may stay open
      // We collect data for a reasonable period then process what we have
      const readTimeout = setTimeout(() => {
        if (!readComplete && data.length > 0) {
          readComplete = true;
          res.destroy();
          processResponse(data, resolve, reject);
        }
      }, 5000); // 5 second read timeout

      res.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });

      res.on("end", () => {
        if (!readComplete) {
          readComplete = true;
          clearTimeout(readTimeout);
          processResponse(data, resolve, reject);
        }
      });

      res.on("error", (err) => {
        if (!readComplete) {
          readComplete = true;
          clearTimeout(readTimeout);
          reject(err);
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    req.write(frame.toString("base64"));
    req.end();
  });
}

/**
 * Process the base64-encoded gRPC-web response
 */
function processResponse(
  data: string,
  resolve: (value: Buffer) => void,
  reject: (reason: Error) => void
): void {
  try {
    if (data.length === 0) {
      reject(new Error("Empty response"));
      return;
    }

    // Decode base64 response (may contain multiple frames)
    const decoded = Buffer.from(data.replace(/[\r\n]/g, ""), "base64");

    // Extract message from frame (skip 5-byte header)
    if (decoded.length > 5) {
      const msgLen = decoded.readUInt32BE(1);
      resolve(decoded.slice(5, 5 + msgLen));
    } else {
      resolve(decoded.slice(5));
    }
  } catch (error) {
    reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Build protobuf request for listing matches by competition
 * Field 1 = competition ID (varint)
 *
 * @param competitionId - Betclic's internal competition ID
 * @returns Encoded protobuf message
 */
export function buildListingRequest(competitionId: number): Buffer {
  // Tag 0x08 = field 1, wire type 0 (varint)
  return Buffer.from([0x08, ...encodeVarint(competitionId)]);
}

/**
 * Build protobuf request for match details
 * Field 1 = match ID (varint, can be very large)
 *
 * @param matchId - Match ID as string (BigInt-compatible)
 * @returns Encoded protobuf message
 */
export function buildMatchDetailsRequest(matchId: string): Buffer {
  // Tag 0x08 = field 1, wire type 0 (varint)
  return Buffer.from([0x08, ...encodeBigVarint(BigInt(matchId))]);
}

/**
 * Build protobuf request for match details with market group filter
 *
 * This function builds a request payload that includes both the match ID
 * and a market group filter value. The filter determines which tab's markets
 * are returned by the API.
 *
 * Protobuf encoding:
 * - Field 1 (tag 0x08): match ID as BigInt varint
 * - Field 2 (tag 0x10): market group filter as varint
 *
 * @param matchId - Match ID as string (BigInt-compatible)
 * @param marketGroup - Market group filter value from MARKET_GROUP_FILTERS
 * @returns Encoded protobuf message with both fields
 *
 * @see MARKET_GROUP_FILTERS in constants.ts for valid filter values
 * @see backend/docs/betclic-tab-network-analysis.md for filter discovery details
 */
export function buildMatchDetailsRequestWithFilter(
  matchId: string,
  marketGroup: number
): Buffer {
  // Tag 0x08 = field 1, wire type 0 (varint) - match ID
  const matchIdBytes = [0x08, ...encodeBigVarint(BigInt(matchId))];

  // Tag 0x10 = field 2, wire type 0 (varint) - market group filter
  // Tag calculation: (fieldNum << 3) | wireType = (2 << 3) | 0 = 16 = 0x10
  const filterBytes = [0x10, ...encodeVarint(marketGroup)];

  return Buffer.from([...matchIdBytes, ...filterBytes]);
}

/**
 * Fetch all matches for a league
 *
 * @param league - League slug (e.g., "premier-league")
 * @returns Raw protobuf buffer with listing response
 */
export async function fetchLeagueMatches(league: string): Promise<Buffer | null> {
  const competitionId = COMPETITION_IDS[league];
  if (!competitionId) {
    console.error(`[Betclic/Navigation] Unknown league: ${league}`);
    return null;
  }

  try {
    console.log(`[Betclic/Navigation] Fetching ${league} (competition ID: ${competitionId})`);
    const requestBody = buildListingRequest(competitionId);
    const response = await fetchGrpcStream(ENDPOINTS.listing, requestBody);

    if (response.length < 10) {
      console.warn(`[Betclic/Navigation] Empty response for ${league}`);
      return null;
    }

    return response;
  } catch (error) {
    console.error(`[Betclic/Navigation] Failed to fetch ${league}:`, error);
    return null;
  }
}

/**
 * Fetch full match details by match ID
 *
 * @param matchId - Match ID as string
 * @returns Raw protobuf buffer with match details
 */
export async function fetchMatchDetails(matchId: string): Promise<Buffer | null> {
  try {
    console.log(`[Betclic/Navigation] Fetching match details for: ${matchId}`);
    const requestBody = buildMatchDetailsRequest(matchId);
    const response = await fetchGrpcStream(ENDPOINTS.match, requestBody);

    if (response.length < 100) {
      console.warn(`[Betclic/Navigation] Insufficient data for match ${matchId}`);
      return null;
    }

    return response;
  } catch (error) {
    console.error(`[Betclic/Navigation] Failed to fetch match ${matchId}:`, error);
    return null;
  }
}

/**
 * Extract match ID from Betclic event URL
 * URL format: https://www.betclic.pl/pilka-nozna-sfootball/premier-league-c3/team-team-m12345678901234
 *
 * @param eventUrl - Full URL to the match page
 * @returns Match ID string or null if not found
 */
export function extractMatchIdFromUrl(eventUrl: string): string | null {
  const match = eventUrl.match(/m(\d+)$/);
  return match ? match[1] : null;
}

/**
 * Build the canonical event URL from match data
 *
 * @param matchId - Match ID
 * @param league - League slug
 * @param homeTeam - Home team name
 * @param awayTeam - Away team name
 * @returns Full URL to match page
 */
export function buildEventUrl(
  matchId: string,
  league: string,
  homeTeam: string,
  awayTeam: string
): string {
  const leagueSlug = LEAGUE_SLUGS[league] || league;

  // Slugify team names for URL
  const homeSlug = homeTeam
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const awaySlug = awayTeam
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  return `https://www.betclic.pl/pilka-nozna-sfootball/${leagueSlug}/${homeSlug}-${awaySlug}-m${matchId}`;
}

/**
 * Build a simple event URL when only match ID is known
 */
export function buildEventUrlSimple(matchId: string): string {
  return `https://www.betclic.pl/zaklady/m${matchId}`;
}

/**
 * Check if a league is supported by Betclic scraper
 */
export function isLeagueSupported(league: string): boolean {
  return league in COMPETITION_IDS;
}

/**
 * Get competition ID for a league
 */
export function getCompetitionId(league: string): number | undefined {
  return COMPETITION_IDS[league];
}
