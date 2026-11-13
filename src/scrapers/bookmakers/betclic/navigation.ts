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
  GRPC_FRAME_DEADLINE,
  MAX_RETRIES,
  RETRY_DELAY,
  MARKET_GROUP_FILTERS,
} from "./constants.js";
import type { IncomingMessage } from "node:http";
import { pipeline } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { createGunzip } from "node:zlib";
import type { HttpStats } from "../../shared/http/http-client.js";
import { encodeVarint, encodeBigVarint } from "./parser.js";
import { MIN_GROUP_BYTES, type BetclicGroupName, type BetclicGroupResult } from "./match-groups.js";

/**
 * gRPC transport counters with HttpStats semantics: requests = HTTP attempts sent,
 * retries = attempts after the first per fetchGrpcStream call, failures =
 * fetchGrpcStream calls that rejected, bytes = response body bytes as received
 * (compressed when gzip), byStatus = status per response, or "timeout" / "network"
 * for an attempt that got no response headers. gzipResponses counts gzip bodies.
 */
export interface BetclicTransportStats extends HttpStats {
  gzipResponses: number;
}

export function createBetclicTransportStats(): BetclicTransportStats {
  return { requests: 0, retries: 0, failures: 0, bytes: 0, byStatus: {}, gzipResponses: 0 };
}

/** Adds `from` into `into`, summing every counter and merging byStatus. */
export function addBetclicTransportStats(into: BetclicTransportStats, from: Readonly<BetclicTransportStats>): void {
  into.requests += from.requests;
  into.retries += from.retries;
  into.failures += from.failures;
  into.bytes += from.bytes;
  into.gzipResponses += from.gzipResponses;
  for (const [status, n] of Object.entries(from.byStatus)) into.byStatus[status] = (into.byStatus[status] ?? 0) + n;
}

export function formatBetclicTransportStats(s: Readonly<BetclicTransportStats>): string {
  return `wire ${s.bytes} B, ${s.requests} requests, ${s.retries} retries, ${s.failures} failures, gzip ${s.gzipResponses}/${s.byStatus["200"] ?? 0}`;
}

/** Per-call options: counters to add to, the frame deadline (default GRPC_FRAME_DEADLINE) and a run signal. */
export interface GrpcCallOptions {
  stats?: BetclicTransportStats;
  deadlineMs?: number;
  /** Aborts the call: the stream is destroyed, the call rejects "gRPC aborted <url>" and is never retried. */
  signal?: AbortSignal;
}

const abortedError = (url: string): Error => new Error(`gRPC aborted ${url}`);

function countStatus(stats: BetclicTransportStats | undefined, key: string): void {
  if (stats) stats.byStatus[key] = (stats.byStatus[key] ?? 0) + 1;
}

/**
 * Fetch data from gRPC-web endpoint with retry logic
 * Handles the gRPC-web frame encoding/decoding
 *
 * Note: gRPC-web uses streaming responses which may not auto-close.
 * We use node's https module, resolving on the first complete frame.
 *
 * @param url - gRPC endpoint URL
 * @param body - Protobuf message body (without frame header)
 * @param timeoutMs - Request timeout in milliseconds
 * @param opts - Transport counters and the frame deadline
 * @returns Decoded response buffer
 */
export async function fetchGrpcStream(
  url: string,
  body: Buffer,
  timeoutMs: number = REQUEST_TIMEOUT,
  opts: GrpcCallOptions = {}
): Promise<Buffer> {
  // Build gRPC-web frame: 1 byte flag + 4 bytes length (big endian) + message
  const frame = Buffer.alloc(5 + body.length);
  frame[0] = 0; // Uncompressed flag
  frame.writeUInt32BE(body.length, 1);
  body.copy(frame, 5);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0 && opts.stats) opts.stats.retries++;
    try {
      const result = await fetchGrpcWithNodeHttp(url, frame, timeoutMs, opts);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(
        `[Betclic/Navigation] Attempt ${attempt + 1}/${MAX_RETRIES} failed: ${lastError.message}`
      );
      // Never retry after an abort: the run is over
      if (opts.signal?.aborted) {
        lastError = abortedError(url);
        break;
      }

      if (attempt < MAX_RETRIES - 1) {
        // Wait before retry with linear backoff; an abort ends the wait at once
        const delay = RETRY_DELAY * (attempt + 1);
        try {
          await sleep(delay, undefined, opts.signal ? { signal: opts.signal } : undefined);
        } catch {
          lastError = abortedError(url);
          break;
        }
      }
    }
  }

  if (opts.stats) opts.stats.failures++;
  throw lastError || new Error("All retry attempts failed");
}

/**
 * One gRPC-web attempt over node:https (node:http for an http: URL, as tests use).
 * This avoids fetch's stream handling issues with gRPC-web streaming endpoints.
 *
 * Asks for gzip and decodes it in front of the complete-frame reader. On every
 * settle (frame complete, deadline, error, non-200, trailers-only, unsupported
 * encoding) the SOURCE response and the request are destroyed, so the socket
 * never outlives the call: Betclic never ends these streams.
 */
export async function fetchGrpcWithNodeHttp(
  url: string,
  frame: Buffer,
  timeoutMs: number,
  opts: GrpcCallOptions = {}
): Promise<Buffer> {
  const { stats, signal } = opts;
  if (signal?.aborted) throw abortedError(url);
  const parsedUrl = new URL(url);
  // Dynamic import to avoid top-level import issues
  const transport = parsedUrl.protocol === "http:" ? await import("node:http") : await import("node:https");
  if (signal?.aborted) throw abortedError(url);

  return new Promise((outerResolve, outerReject) => {
    // The abort listener lives exactly as long as the call
    const onAbort = (): void => {
      const error = abortedError(url);
      if (!response) countStatus(stats, "aborted");
      response?.destroy(error);
      req.destroy(error);
      reject(error);
    };
    const detach = (): void => signal?.removeEventListener("abort", onAbort);
    const resolve = (value: Buffer): void => {
      detach();
      outerResolve(value);
    };
    const reject = (error: Error): void => {
      detach();
      outerReject(error);
    };
    let response: IncomingMessage | undefined;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname,
      method: "POST",
      headers: { ...GRPC_HEADERS, "Accept-Encoding": "gzip" },
      // Socket idle timeout: it guards the wait for the response headers.
      // Once they arrive, the frame deadline below bounds the body.
      timeout: timeoutMs,
    };

    // The frame deadline counts from the request start, not from the headers
    const startedAt = Date.now();
    if (stats) stats.requests++;

    const req = transport.request(options, (res) => {
      response = res;
      // The SOURCE response and the request/socket, never only a wrapper stream
      const release = () => {
        res.destroy();
        req.destroy();
      };
      countStatus(stats, String(res.statusCode));
      res.on("data", (chunk: Buffer) => {
        if (stats) stats.bytes += chunk.length;
      });

      if (res.statusCode !== 200) {
        release();
        reject(new Error(`gRPC request failed: HTTP ${res.statusCode}`));
        return;
      }

      // Trailers-only response: the call failed and no data frame follows
      const grpcStatus = res.headers["grpc-status"];
      if (grpcStatus !== undefined && grpcStatus !== "0") {
        release();
        reject(new Error(`gRPC error ${grpcStatus}: ${res.headers["grpc-message"] ?? ""}`));
        return;
      }

      const encoding = String(res.headers["content-encoding"] ?? "identity").toLowerCase();
      if (encoding !== "gzip" && encoding !== "identity") {
        release();
        reject(new Error(`gRPC-web unsupported content-encoding ${encoding}`));
        return;
      }
      if (encoding === "gzip" && stats) stats.gzipResponses++;

      const deadlineMs = Math.max(1, (opts.deadlineMs ?? GRPC_FRAME_DEADLINE) - (Date.now() - startedAt));
      // pipeline needs its callback (else ERR_INVALID_ARG_TYPE); errors reach the reader as body 'error'
      const body = encoding === "gzip" ? pipeline(res, createGunzip(), () => {}) : res;
      readGrpcWebTextStream(body, { deadlineMs, release }).then(resolve, (error: NodeJS.ErrnoException) =>
        reject(
          error.code?.startsWith("Z_") ? new Error(`Incomplete gRPC-web frame: gzip ${error.code} ${error.message}`) : error
        )
      );
    });

    req.on("error", (error) => {
      // An abort destroys the request with its own error and is counted in onAbort
      if (!response && !signal?.aborted) countStatus(stats, "network");
      reject(error);
    });
    req.on("timeout", () => {
      if (!response) countStatus(stats, "timeout");
      req.destroy();
      reject(new Error("Request timeout"));
    });
    signal?.addEventListener("abort", onAbort, { once: true });

    req.write(frame.toString("base64"));
    req.end();
  });
}

/**
 * First frame of a gRPC-web-text (base64) response, decoded as far as the
 * text received so far allows.
 */
export interface GrpcWebTextFrame {
  /** True once all expectedLength message bytes are decoded */
  complete: boolean;
  /** Message length from the 5-byte frame header; null until the header is decoded */
  expectedLength: number | null;
  /** Frame flag byte (0x80 marks a trailer, 0x01 a compressed message); null until the header is decoded */
  flag: number | null;
  /** Message bytes after the header, capped at expectedLength */
  message: Buffer;
}

/** gRPC-web frame header: 1 flag byte + 4-byte big-endian message length */
const GRPC_WEB_HEADER_BYTES = 5;
/** Two base64 quadruplets always decode to at least the 5 header bytes */
const GRPC_WEB_HEADER_CHARS = 8;
/** Flag bit that marks a trailer frame (grpc-status / grpc-message lines) */
const GRPC_WEB_TRAILER_FLAG = 0x80;
/** Flag bit that marks a compressed message (we send no grpc-accept-encoding) */
const GRPC_WEB_COMPRESSED_FLAG = 0x01;

/** Base64 length of a whole frame (header + message), padding included */
function grpcWebTextFrameChars(messageLength: number): number {
  return Math.ceil((GRPC_WEB_HEADER_BYTES + messageLength) / 3) * 4;
}

/**
 * Decode the first frame of a gRPC-web-text response.
 *
 * A chunk boundary can fall inside a base64 quadruplet, so only whole
 * quadruplets are decoded. Characters past the first frame (a following
 * frame on the still-open stream) are ignored.
 */
export function decodeGrpcWebTextFrame(data: string): GrpcWebTextFrame {
  const text = data.replace(/[\r\n]/g, "");
  const usable = text.length - (text.length % 4);

  const header = Buffer.from(text.slice(0, Math.min(usable, GRPC_WEB_HEADER_CHARS)), "base64");
  if (header.length < GRPC_WEB_HEADER_BYTES) {
    return { complete: false, expectedLength: null, flag: null, message: Buffer.alloc(0) };
  }

  const flag = header[0];
  const expectedLength = header.readUInt32BE(1);
  const frameChars = Math.min(usable, grpcWebTextFrameChars(expectedLength));
  const decoded = Buffer.from(text.slice(0, frameChars), "base64");
  const message = decoded.subarray(GRPC_WEB_HEADER_BYTES, GRPC_WEB_HEADER_BYTES + expectedLength);

  return { complete: message.length === expectedLength, expectedLength, flag, message };
}

/**
 * Read the first data frame of a gRPC-web-text response stream.
 *
 * Betclic never ends these streams, so this resolves as soon as the first
 * frame is complete, without waiting for 'end', and destroys the stream.
 * It never resolves partial data: it rejects when the stream ends first,
 * when the deadline passes, when the first frame is a trailer, or on a
 * stream error, so that fetchGrpcStream retries. It also rejects a first
 * frame that is compressed or empty: resolving either would lose the
 * response silently, because the callers skip short responses and
 * compressed bytes parse to no markets.
 */
export function readGrpcWebTextStream(
  res: NodeJS.ReadableStream & { destroy?(): void },
  opts: { deadlineMs: number; release?: () => void }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    let receivedChars = 0;
    // Base64 length of the first frame, known once its header has arrived
    let frameChars: number | null = null;
    let settled = false;

    const progress = (): string => {
      const frame = decodeGrpcWebTextFrame(chunks.join(""));
      return `${frame.message.length}/${frame.expectedLength} bytes`;
    };

    // Settles exactly once. The listeners below stay attached as no-ops:
    // destroying the stream can still emit events, and an 'error' event
    // without a listener would crash the process.
    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      res.destroy?.();
      // The caller's source (response + request) behind a decoding wrapper
      opts.release?.();
      outcome();
    };

    const deadline = setTimeout(() => {
      const error = new Error(`gRPC-web frame deadline (${opts.deadlineMs} ms): ${progress()}`);
      settle(() => reject(error));
    }, opts.deadlineMs);

    res.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const text = chunk.toString().replace(/[\r\n]/g, "");
      if (text.length === 0) return;
      chunks.push(text);
      receivedChars += text.length;

      if (frameChars === null) {
        if (receivedChars < GRPC_WEB_HEADER_CHARS) return;
        // Decode the header once; later chunks only grow the character count
        const header = decodeGrpcWebTextFrame(chunks.join("").slice(0, GRPC_WEB_HEADER_CHARS));
        if (header.flag !== null && (header.flag & GRPC_WEB_TRAILER_FLAG) !== 0) {
          const trailer = decodeGrpcWebTextFrame(chunks.join(""))
            .message.toString("latin1")
            .trim()
            .replace(/\r?\n/g, "; ");
          const error = new Error(`gRPC-web trailer frame instead of data: ${trailer}`);
          settle(() => reject(error));
          return;
        }
        if (header.flag !== null && (header.flag & GRPC_WEB_COMPRESSED_FLAG) !== 0) {
          const error = new Error("gRPC-web compressed frame not supported");
          settle(() => reject(error));
          return;
        }
        if (header.expectedLength === 0) {
          const error = new Error("gRPC-web empty data frame");
          settle(() => reject(error));
          return;
        }
        // No length decoded means this is not a gRPC-web frame: never
        // resolve it, let 'end' or the deadline reject
        frameChars =
          header.expectedLength === null ? Infinity : grpcWebTextFrameChars(header.expectedLength);
      }

      if (receivedChars >= frameChars) {
        const frame = decodeGrpcWebTextFrame(chunks.join(""));
        if (frame.complete) {
          settle(() => resolve(frame.message));
        } else {
          // Enough characters but too few bytes: malformed base64. Never
          // resolve it, let 'end' or the deadline reject.
          frameChars = Infinity;
        }
      }
    });

    res.on("end", () => {
      if (settled) return;
      const error = new Error(`Incomplete gRPC-web frame: ${progress()}`);
      settle(() => reject(error));
    });

    res.on("error", (error: Error) => {
      settle(() => reject(error));
    });
  });
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
export async function fetchLeagueMatches(league: string, opts: GrpcCallOptions = {}): Promise<Buffer | null> {
  const competitionId = COMPETITION_IDS[league];
  if (!competitionId) {
    console.error(`[Betclic/Navigation] Unknown league: ${league}`);
    return null;
  }

  try {
    console.log(`[Betclic/Navigation] Fetching ${league} (competition ID: ${competitionId})`);
    const requestBody = buildListingRequest(competitionId);
    const response = await fetchGrpcStream(ENDPOINTS.listing, requestBody, REQUEST_TIMEOUT, opts);

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
 * Fetch every market group of a match in parallel.
 *
 * Returns one entry per group in MARKET_GROUP_FILTERS order and never
 * throws: a failed group carries its error message so the caller can decide
 * whether the match is complete enough to be written (see match-groups.ts).
 */
export async function fetchMarketGroupResults(
  matchId: string,
  opts: GrpcCallOptions = {}
): Promise<BetclicGroupResult[]> {
  const filterEntries = Object.entries(MARKET_GROUP_FILTERS) as [BetclicGroupName, string | null][];

  console.log(
    `[Betclic/Navigation] Fetching ${filterEntries.length} market groups in parallel for match ${matchId}`
  );

  const results = await Promise.all(
    filterEntries.map(async ([group, categoryId]): Promise<BetclicGroupResult> => {
      try {
        const requestBody = buildMatchDetailsRequestWithFilter(matchId, categoryId);
        const response = await fetchGrpcStream(ENDPOINTS.match, requestBody, REQUEST_TIMEOUT, opts);
        return { group, response, error: null };
      } catch (error) {
        console.warn(
          `[Betclic/Navigation] Failed to fetch group ${group}:`,
          error instanceof Error ? error.message : error
        );
        return { group, response: null, error: error instanceof Error ? error.message : String(error) };
      }
    })
  );

  let valid = 0;
  for (const { group, response } of results) {
    if (response && response.length >= MIN_GROUP_BYTES) {
      valid++;
      console.log(`[Betclic/Navigation] Group ${group}: ${response.length} bytes`);
    }
  }

  console.log(
    `[Betclic/Navigation] Fetched ${valid}/${filterEntries.length} valid responses for match ${matchId}`
  );

  return results;
}

/**
 * Fetch markets from all market groups of a match: the completed responses of
 * at least MIN_GROUP_BYTES, in group order. Kept for the audit scripts.
 */
export async function fetchAllMarketGroups(matchId: string): Promise<Buffer[]> {
  const results = await fetchMarketGroupResults(matchId);
  return results
    .filter((r): r is BetclicGroupResult & { response: Buffer } => r.response !== null && r.response.length >= MIN_GROUP_BYTES)
    .map((r) => r.response);
}
