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
  MARKET_GROUP_FILTERS,
} from "./constants.js";
import { encodeVarint, encodeBigVarint } from "./parser.js";
import { BetclicPlaywrightTabScraper } from "./tab-scraper.js";
import { createHash } from "crypto";

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
 * Based on HAR analysis (2026-01-24), the correct request structure is:
 * - Field 1 (tag 0x08): match_id as BigInt varint
 * - Field 2 (tag 0x12): language "pl" as length-delimited string
 * - Field 3 (tag 0x1a): category_id as length-delimited string (optional)
 *
 * @param matchId - Match ID as string (BigInt-compatible)
 * @param categoryId - Category ID string (e.g., "ca_ftb_rslt") or null for no filter
 * @returns Encoded protobuf message
 */
export function buildMatchDetailsRequestWithFilter(
  matchId: string,
  categoryId: string | null
): Buffer {
  // Field 1 (tag 0x08): match_id as BigInt varint
  const matchIdBytes = [0x08, ...encodeBigVarint(BigInt(matchId))];

  // Field 2 (tag 0x12): language "pl" as length-delimited string
  // Tag calculation: (fieldNum << 3) | wireType = (2 << 3) | 2 = 18 = 0x12
  const langBuffer = Buffer.from("pl", "utf8");
  const langBytes = [0x12, langBuffer.length, ...langBuffer];

  // Field 3 (tag 0x1a): category_id as length-delimited string (if provided)
  // Tag calculation: (fieldNum << 3) | wireType = (3 << 3) | 2 = 26 = 0x1a
  if (categoryId) {
    const categoryBuffer = Buffer.from(categoryId, "utf8");
    const categoryBytes = [0x1a, categoryBuffer.length, ...categoryBuffer];
    return Buffer.from([...matchIdBytes, ...langBytes, ...categoryBytes]);
  }

  return Buffer.from([...matchIdBytes, ...langBytes]);
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

/**
 * Delay helper for rate limiting between requests
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch markets from all market group tabs for a match
 *
 * Iterates over MARKET_GROUP_FILTERS category IDs, fetching markets from each tab.
 * Includes 100ms delay between requests to avoid rate limiting.
 * Filters out responses smaller than 100 bytes (empty/invalid data).
 */
export async function fetchAllMarketGroups(matchId: string): Promise<Buffer[]> {
  const responses: Buffer[] = [];
  const filterEntries = Object.entries(MARKET_GROUP_FILTERS) as [string, string | null][];

  console.log(
    `[Betclic/Navigation] Fetching ${filterEntries.length} market groups for match ${matchId}`
  );

  for (const [groupName, categoryId] of filterEntries) {
    try {
      const categoryDisplay = categoryId || "(no filter)";
      console.log(`[Betclic/Navigation] Fetching group ${groupName} (category=${categoryDisplay})...`);

      const requestBody = buildMatchDetailsRequestWithFilter(matchId, categoryId);
      const response = await fetchGrpcStream(ENDPOINTS.match, requestBody);

      if (response.length >= 100) {
        responses.push(response);
        console.log(
          `[Betclic/Navigation] Group ${groupName}: ${response.length} bytes received`
        );
      } else {
        console.log(
          `[Betclic/Navigation] Group ${groupName}: skipped (${response.length} bytes < 100)`
        );
      }
    } catch (error) {
      console.warn(
        `[Betclic/Navigation] Failed to fetch group ${groupName}:`,
        error instanceof Error ? error.message : error
      );
    }

    await delay(100);
  }

  console.log(
    `[Betclic/Navigation] Fetched ${responses.length}/${filterEntries.length} valid responses for match ${matchId}`
  );

  return responses;
}

/**
 * Calculate SHA-256 hash of a buffer for comparison
 *
 * This helper is used to detect if API responses are identical across
 * different filter values, which indicates that server-side filtering
 * is not working (as discovered in research-003).
 *
 * @param buffer - Buffer to hash
 * @returns SHA-256 hash string
 */
function calculateBufferHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Calculate unique hashes from an array of buffers
 *
 * @param buffers - Array of Buffers to compare
 * @returns Array of unique hash strings
 */
function calculateBufferHashes(buffers: Buffer[]): string[] {
  const hashes = buffers.map((buffer) => calculateBufferHash(buffer));
  const unique = Array.from(new Set(hashes));
  return unique;
}

/**
 * Fetch markets using hybrid approach (API + Playwright fallback)
 *
 * This function implements graceful degradation:
 * 1. First tries direct API (fetchAllMarketGroups)
 * 2. Detects if all API responses are identical (compare buffer hashes)
 * 3. If identical, falls back to Playwright tab clicking
 * 4. Returns merged markets from whichever method was used
 *
 * This provides a robust scraping strategy that:
 * - Uses fast API method when it works correctly
 * - Falls back to Playwright DOM scraping when API doesn't filter properly
 * - Handles errors gracefully with a fallback chain
 *
 * @param matchId - Match ID as string (BigInt-compatible)
 * @param matchUrl - Full URL to match page (for Playwright fallback)
 * @returns Promise<Buffer[]> - Array of response Buffers containing markets
 *
 * @example
 * ```typescript
 * const matchId = "905675290968064";
 * const matchUrl = "https://www.betclic.pl/pilka-nozna-sfootball/premier-league-c3/west-ham-sunderland-m905675290968064";
 * const responses = await fetchMarketsHybrid(matchId, matchUrl);
 * const markets = parseAllMarketsFromMultipleResponses(responses);
 * ```
 */
export async function fetchMarketsHybrid(
  matchId: string,
  matchUrl: string
): Promise<Buffer[]> {
  console.log(
    `[Betclic/Navigation] Starting hybrid scrape for match ${matchId}`
  );
  console.log(`[Betclic/Navigation] Match URL: ${matchUrl}`);

  let apiResponses: Buffer[] = [];
  let methodUsed: "API" | "Playwright" = "API";
  let apiError: Error | unknown = null;

  try {
    console.log(`[Betclic/Navigation] Trying direct API first...`);
    apiResponses = await fetchAllMarketGroups(matchId);
    console.log(
      `[Betclic/Navigation] API returned ${apiResponses.length} responses`
    );

    const uniqueHashes = calculateBufferHashes(apiResponses);

    if (uniqueHashes.length === 1) {
      methodUsed = "Playwright";
      console.log(
        `[Betclic/Navigation] All API responses identical (${apiResponses.length} responses with same hash)`
      );
      console.log(
        `[Betclic/Navigation] Server-side filtering not working, falling back to Playwright tab clicking`
      );
      console.log(
        `[Betclic/Navigation] Buffer hash (first 16 chars): ${uniqueHashes[0].substring(0, 16)}...`
      );
    } else {
      methodUsed = "API";
      console.log(
        `[Betclic/Navigation] API responses differ (${uniqueHashes.length} unique hashes), using API method`
      );
    }

    if (methodUsed === "API") {
      console.log(`[Betclic/Navigation] Method used: Direct API`);
      return apiResponses;
    }
  } catch (error) {
    apiError = error;
    console.warn(
      `[Betclic/Navigation] API fetch failed:`,
      error instanceof Error ? error.message : error
    );
    methodUsed = "Playwright";
    console.log(`[Betclic/Navigation] Falling back to Playwright (API error)`);
  }

  if (methodUsed === "Playwright") {
    try {
      console.log(
        `[Betclic/Navigation] Fetching markets via Playwright tab clicking...`
      );
      const tabScraper = new BetclicPlaywrightTabScraper();
      const playwrightResponses = await tabScraper.fetchMarketsWithTabClicks(
        matchUrl
      );

      console.log(
        `[Betclic/Navigation] Playwright returned ${playwrightResponses.length} responses`
      );
      console.log(`[Betclic/Navigation] Method used: Playwright tab clicking`);

      if (apiResponses.length > 0) {
        console.log(
          `[Betclic/Navigation] Combining API responses with Playwright responses`
        );
        return [...apiResponses, ...playwrightResponses];
      }

      return playwrightResponses;
    } catch (playwrightError) {
      console.error(
        `[Betclic/Navigation] Playwright fallback failed:`,
        playwrightError instanceof Error ? playwrightError.message : playwrightError
      );

      if (apiResponses.length > 0) {
        console.log(
          `[Betclic/Navigation] Returning API responses as ultimate fallback`
        );
        return apiResponses;
      }

      throw new Error(
        `Both API and Playwright methods failed. API: ${
          apiError instanceof Error ? apiError.message : apiError
        }, Playwright: ${
          playwrightError instanceof Error ? playwrightError.message : playwrightError
        }`
      );
    }
  }

  return apiResponses;
}
