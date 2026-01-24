/**
 * Betclic Parser Module
 *
 * Pure parsing logic for transforming Betclic gRPC/protobuf responses
 * into the unified market format.
 *
 * This module has NO network dependencies - it only works with
 * raw Buffer data from the gRPC API.
 *
 * ARCHITECTURE:
 * - Uses recursive protobuf parsing that handles both TOP tab (flat) and other tabs (grouped)
 * - No fallback strategies - single clean parsing path
 * - Outputs ScrapedMarket[] compatible with the rest of the system
 */

import type { MarketSelection, ScrapedMarket } from "../../../types/full-offer.js";
import type { BetclicListingMatch, ParsedTeams } from "./types.js";
import {
  PROTO_FIELDS,
  TEAM_SEPARATOR,
  MARKET_TYPES,
} from "./constants.js";

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface RawField {
  fieldNumber: number;
  wireType: number;
  value: number | bigint | string | Buffer | RawField[];
}

interface ParsedSelection {
  id: string;
  name: string;
  nameLong?: string;
  odds: number;
}

interface ParsedMarket {
  id: string;
  name: string;
  nameLong?: string;
  selections: ParsedSelection[];
}

interface ParsedMarketGroup {
  id: string;
  name: string;
  markets: ParsedMarket[];
}

interface VarintReadResult {
  value: number;
  bytesRead: number;
}

interface BigIntVarintReadResult {
  value: bigint;
  bytesRead: number;
}

// ============================================================================
// PROTOBUF LOW-LEVEL
// ============================================================================

/**
 * Read a varint from buffer at offset
 * Returns value and number of bytes read
 */
export function readVarint(buf: Buffer, offset: number): VarintReadResult {
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

/**
 * Read a varint as BigInt for large values (match IDs)
 */
export function readVarintBigInt(buf: Buffer, offset: number): BigIntVarintReadResult {
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

/**
 * Encode a number as varint bytes
 */
export function encodeVarint(n: number): number[] {
  const bytes: number[] = [];
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n);
  return bytes;
}

/**
 * Encode a BigInt as varint bytes (for large match IDs)
 */
export function encodeBigVarint(n: bigint): number[] {
  const bytes: number[] = [];
  while (n > 0x7fn) {
    bytes.push(Number(n & 0x7fn) | 0x80);
    n >>= 7n;
  }
  bytes.push(Number(n));
  return bytes;
}

/**
 * Try to decode buffer as UTF-8 string
 * Returns null if buffer contains non-printable characters
 */
function tryDecodeString(buf: Buffer): string | null {
  try {
    const str = buf.toString("utf8");
    if (/^[\x20-\x7E\xA0-\xFF\u0100-\uFFFF\s]+$/.test(str) && str.length > 0) {
      return str;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse protobuf buffer into field array
 * Recursively parses nested messages
 */
function parseProtobuf(buf: Buffer, depth: number = 0): RawField[] {
  const fields: RawField[] = [];
  let offset = 0;
  const maxDepth = 15;

  while (offset < buf.length) {
    const tagResult = readVarint(buf, offset);
    if (tagResult.bytesRead === 0) break;
    offset += tagResult.bytesRead;

    const fieldNumber = tagResult.value >> 3;
    const wireType = tagResult.value & 0x07;

    if (fieldNumber === 0 || fieldNumber > 536870911) break;

    let value: number | bigint | string | Buffer | RawField[];

    if (wireType === 0) {
      // Varint
      const result = readVarintBigInt(buf, offset);
      offset += result.bytesRead;
      value = result.value <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(result.value)
        : result.value;
    } else if (wireType === 1) {
      // 64-bit (double)
      if (offset + 8 > buf.length) break;
      value = buf.readDoubleLE(offset);
      offset += 8;
    } else if (wireType === 2) {
      // Length-delimited (bytes/string/embedded message)
      const lenResult = readVarint(buf, offset);
      offset += lenResult.bytesRead;
      const len = lenResult.value;
      if (offset + len > buf.length) break;
      const data = buf.slice(offset, offset + len);
      offset += len;

      const str = tryDecodeString(data);
      if (str !== null) {
        value = str;
      } else if (depth < maxDepth) {
        const nested = parseProtobuf(data, depth + 1);
        value = nested.length > 0 ? nested : data;
      } else {
        value = data;
      }
    } else if (wireType === 5) {
      // 32-bit (float)
      if (offset + 4 > buf.length) break;
      value = buf.readFloatLE(offset);
      offset += 4;
    } else {
      // Unknown wire type
      break;
    }

    fields.push({ fieldNumber, wireType, value });
  }

  return fields;
}

// ============================================================================
// FIELD ACCESSORS
// ============================================================================

function getField(fields: RawField[], num: number): RawField | undefined {
  return fields.find((f) => f.fieldNumber === num);
}

function getFieldValue<T>(fields: RawField[], num: number): T | undefined {
  const field = getField(fields, num);
  return field?.value as T | undefined;
}

function getAllFields(fields: RawField[], num: number): RawField[] {
  return fields.filter((f) => f.fieldNumber === num);
}

// ============================================================================
// EXTRACTION FUNCTIONS
// ============================================================================

/**
 * Extract a single selection from protobuf fields
 *
 * Selection structure:
 * - Field 1: selection id (varint)
 * - Field 10: short name (string)
 * - Field 11: long name (string)
 * - Field 12: odds (double, wireType 1)
 */
function extractSelection(selFields: RawField[]): ParsedSelection | null {
  const id = String(getFieldValue<number | bigint>(selFields, 1) || "");
  const name = getFieldValue<string>(selFields, 10) || "";
  const nameLong = getFieldValue<string>(selFields, 11);

  const oddsField = getField(selFields, 12);
  let odds = 0;

  if (oddsField?.wireType === 1) {
    odds = oddsField.value as number;
  }

  if (!name || odds <= 0 || odds > 1000) return null;

  // Round to 2 decimal places
  odds = Math.round(odds * 100) / 100;

  return {
    id,
    name,
    nameLong: nameLong !== name ? nameLong : undefined,
    odds,
  };
}

/**
 * Extract market from protobuf fields
 *
 * Handles TWO selection patterns:
 * 1. TOP tab: selections directly in Field 16
 * 2. Other tabs: selections nested in Field 10 → Field 1 → Field 1
 *
 * Market structure:
 * - Field 1: market id (varint)
 * - Field 2: market name (string)
 * - Field 3: market name long (string)
 * - Field 16: direct selections (TOP tab)
 * - Field 10: nested selection groups (other tabs)
 */
function extractMarket(marketFields: RawField[]): ParsedMarket | null {
  const id = String(getFieldValue<number | bigint>(marketFields, 1) || "");
  const name = getFieldValue<string>(marketFields, 2) || "";
  const nameLong = getFieldValue<string>(marketFields, 3);

  if (!name) return null;

  const selections: ParsedSelection[] = [];

  // Strategy 1: Direct selections in Field 16 (TOP tab style)
  const directSelections = getAllFields(marketFields, 16);
  for (const selField of directSelections) {
    if (Array.isArray(selField.value)) {
      const sel = extractSelection(selField.value);
      if (sel) selections.push(sel);
    }
  }

  // Strategy 2: Nested selections in Field 10 (other tabs style)
  if (selections.length === 0) {
    const selectionGroups = getAllFields(marketFields, 10);

    for (const selGroup of selectionGroups) {
      if (Array.isArray(selGroup.value)) {
        // Field 10 → Field 1 → Field 1 → selection
        for (const wrapper of selGroup.value) {
          if (wrapper.fieldNumber === 1 && Array.isArray(wrapper.value)) {
            for (const innerWrapper of wrapper.value) {
              if (innerWrapper.fieldNumber === 1 && Array.isArray(innerWrapper.value)) {
                const sel = extractSelection(innerWrapper.value);
                if (sel) selections.push(sel);
              }
            }
          }
        }
      }
    }
  }

  if (selections.length === 0) return null;

  return {
    id,
    name,
    nameLong: nameLong !== name ? nameLong : undefined,
    selections,
  };
}

/**
 * Extract market groups from Field 11 entries
 *
 * Handles TWO structures:
 *
 * 1. TOP tab (flat structure - no group wrapper):
 *    Field 11 contains directly:
 *    - Field 3: market data (id, name, selections in Field 16)
 *
 * 2. Other tabs (grouped structure):
 *    Field 11 contains:
 *    - Field 1: group id (string like "subca_ftb_bgo")
 *    - Field 2: group name (string like "Gole - popularne")
 *    - Field 3: market data (id, name, selections in Field 10)
 */
function extractMarketGroups(matchFields: RawField[]): ParsedMarketGroup[] {
  const groups: ParsedMarketGroup[] = [];
  const field11Entries = getAllFields(matchFields, 11);

  // Collect ungrouped markets (for TOP tab)
  const ungroupedMarkets: ParsedMarket[] = [];

  for (const entry of field11Entries) {
    if (!Array.isArray(entry.value)) continue;

    const groupId = getFieldValue<string>(entry.value, 1);
    const groupName = getFieldValue<string>(entry.value, 2);
    const marketFields = getAllFields(entry.value, 3);

    // Check if this is a grouped structure (has Field 1 and Field 2 with content)
    const hasGroupWrapper =
      typeof groupId === "string" &&
      typeof groupName === "string" &&
      groupName.length > 0;

    if (hasGroupWrapper) {
      // Grouped structure (WYNIK, STRZELCY, GOLE, etc.)
      const markets: ParsedMarket[] = [];
      for (const marketField of marketFields) {
        if (Array.isArray(marketField.value)) {
          const market = extractMarket(marketField.value);
          if (market) markets.push(market);
        }
      }

      if (markets.length > 0) {
        groups.push({ id: groupId, name: groupName, markets });
      }
    } else {
      // Flat structure (TOP tab) - markets directly in Field 3
      for (const marketField of marketFields) {
        if (Array.isArray(marketField.value)) {
          const market = extractMarket(marketField.value);
          if (market) ungroupedMarkets.push(market);
        }
      }
    }
  }

  // Create synthetic group for TOP tab markets
  if (ungroupedMarkets.length > 0) {
    groups.unshift({
      id: "top_markets",
      name: "Top zakłady",
      markets: ungroupedMarkets,
    });
  }

  return groups;
}

// ============================================================================
// MARKET TYPE INFERENCE
// ============================================================================

/**
 * Infer market type from market name
 * Matches Polish market names to canonical market types
 */
function inferMarketType(name: string): string {
  const lower = name.toLowerCase();

  // Match result
  if (lower.includes("wynik meczu") || lower.includes("1x2")) return MARKET_TYPES.MATCH_1X2;
  if (lower.includes("podwójna szansa") || lower.includes("podwojna szansa")) return MARKET_TYPES.DOUBLE_CHANCE;
  if (lower.includes("remis nie obowiązuje") || lower.includes("remis zwrot")) return MARKET_TYPES.DRAW_NO_BET;

  // Goals
  if (lower.includes("obie drużyny") || lower.includes("obie druzyny") || lower.includes("btts")) return MARKET_TYPES.BTTS;
  if ((lower.includes("gol") || lower.includes("bramk")) && (lower.includes("powyżej") || lower.includes("poniżej"))) return MARKET_TYPES.OVER_UNDER;
  if (lower.includes("dokładny wynik") || lower.includes("dokladny wynik") || lower.includes("correct score")) return MARKET_TYPES.CORRECT_SCORE;

  // Handicap
  if (lower.includes("handicap")) return MARKET_TYPES.HANDICAP;

  // Half time
  if (lower.includes("połowa") || lower.includes("polowa") || lower.includes("1. poł") || lower.includes("przerw")) return MARKET_TYPES.HALF_TIME_1X2;

  // Statistics
  if (lower.includes("rzut rożny") || lower.includes("rożne") || lower.includes("corner") || lower.includes("róg")) return MARKET_TYPES.CORNERS_TOTAL;
  if (lower.includes("kartki") || lower.includes("czerwona kartka") || lower.includes("żółta kartka") || lower.includes("card")) return MARKET_TYPES.CARDS_TOTAL;
  if (lower.includes("strzały") || lower.includes("celne strzały") || lower.includes("shot")) return MARKET_TYPES.MOST_SHOTS_ON_TARGET;
  if (lower.includes("faule") || lower.includes("foul")) return MARKET_TYPES.FOULS_TOTAL;
  if (lower.includes("spalone") || lower.includes("offside")) return MARKET_TYPES.OFFSIDES_TOTAL;

  // Goal method
  if (lower.includes("rzut karny") || lower.includes("penalty") || lower.includes("karny")) return MARKET_TYPES.PENALTY_AWARDED;
  if (lower.includes("głową") || lower.includes("header")) return MARKET_TYPES.HEADER_GOAL;
  if (lower.includes("rzut wolny") || lower.includes("free kick")) return MARKET_TYPES.FREE_KICK_GOAL;

  // Players
  if (lower.includes("asysta") || lower.includes("asysty") || lower.includes("assist")) return MARKET_TYPES.PLAYER_ASSISTS;
  if (lower.includes("strzel") || lower.includes("gola") || lower.includes("bramkę")) return MARKET_TYPES.ANYTIME_GOALSCORER;

  return "OTHER";
}

// ============================================================================
// OVER/UNDER MARKET SPLITTING
// ============================================================================

/**
 * Pattern to match Over/Under selection names with line values
 * Matches: "Powyżej 2,5", "Poniżej 3,5", "Powyżej 4,5", etc.
 * Captures the line value (e.g., "2,5", "3,5")
 */
const OVER_UNDER_SELECTION_PATTERN = /^(Powyżej|Poniżej)\s+(\d+[,\.]\d+)$/i;

/**
 * Split a market with multiple Over/Under lines into separate markets per line.
 *
 * Betclic returns markets like "1. połowa - Rzuty rożne" with selections:
 * - "Powyżej 2,5", "Poniżej 2,5", "Powyżej 3,5", "Poniżej 3,5", etc.
 *
 * This function splits them into separate markets:
 * - "1. połowa - Rzuty rożne" with paramValue="2.5" and selections for 2.5
 * - "1. połowa - Rzuty rożne" with paramValue="3.5" and selections for 3.5
 *
 * @param market - Original market with multiple O/U lines
 * @returns Array of markets, one per line (or original if not O/U pattern)
 */
function splitOverUnderMarket(market: ScrapedMarket): ScrapedMarket[] {
  // Group selections by line value
  const lineGroups = new Map<string, MarketSelection[]>();
  const nonOverUnderSelections: MarketSelection[] = [];

  for (const selection of market.selections) {
    const match = selection.name.match(OVER_UNDER_SELECTION_PATTERN);
    if (match) {
      // Normalize line: replace comma with dot (e.g., "2,5" -> "2.5")
      const line = match[2].replace(",", ".");
      if (!lineGroups.has(line)) {
        lineGroups.set(line, []);
      }
      lineGroups.get(line)!.push(selection);
    } else {
      nonOverUnderSelections.push(selection);
    }
  }

  // If no O/U patterns found or only one line, return original market
  if (lineGroups.size <= 1) {
    return [market];
  }

  // Create separate market for each line
  const splitMarkets: ScrapedMarket[] = [];

  for (const [line, selections] of lineGroups) {
    // Only create market if we have both OVER and UNDER for this line
    const hasOver = selections.some((s) => s.name.toLowerCase().includes("powyżej"));
    const hasUnder = selections.some((s) => s.name.toLowerCase().includes("poniżej"));

    if (hasOver && hasUnder) {
      splitMarkets.push({
        name: market.name,
        groupName: market.groupName,
        type: market.type,
        paramValue: line,
        selections: selections,
      });
    }
  }

  // If we couldn't split properly, return original
  if (splitMarkets.length === 0) {
    return [market];
  }

  return splitMarkets;
}

/**
 * Process all markets and split Over/Under markets with multiple lines
 *
 * @param markets - Array of markets to process
 * @returns Array of markets with O/U markets split by line
 */
function splitOverUnderMarkets(markets: ScrapedMarket[]): ScrapedMarket[] {
  const result: ScrapedMarket[] = [];

  for (const market of markets) {
    const splitResult = splitOverUnderMarket(market);
    result.push(...splitResult);
  }

  return result;
}

// ============================================================================
// MAIN API
// ============================================================================

/**
 * Parse all markets from raw protobuf data into unified ScrapedMarket format
 * This is the main function for full offer scraping
 *
 * @param rawData - Raw protobuf buffer from match details response
 * @returns Array of ScrapedMarket objects
 */
export function parseAllMarketsFromProto(rawData: Buffer): ScrapedMarket[] {
  const rootFields = parseProtobuf(rawData);
  const wrapperFields = getFieldValue<RawField[]>(rootFields, 1) || [];
  const matchFields = getFieldValue<RawField[]>(wrapperFields, 1) || [];

  const marketGroups = extractMarketGroups(matchFields);

  const markets: ScrapedMarket[] = [];
  for (const group of marketGroups) {
    for (const market of group.markets) {
      markets.push({
        name: market.name,
        groupName: group.name,
        type: inferMarketType(market.name),
        selections: market.selections.map((sel) => ({
          name: sel.name,
          odds: sel.odds,
        })),
      });
    }
  }

  // Split Over/Under markets with multiple lines into separate markets
  return splitOverUnderMarkets(markets);
}

/**
 * Parse markets from multiple gRPC responses and merge with deduplication
 *
 * This function is used for multi-tab fetching where each tab (market group)
 * returns a separate response buffer. Markets are deduplicated by 'name:type'
 * combination to avoid duplicates when the same market appears in multiple tabs.
 *
 * @param responses - Array of raw protobuf buffers from multiple market group fetches
 * @returns Merged and deduplicated array of ScrapedMarket objects
 */
export function parseAllMarketsFromMultipleResponses(responses: Buffer[]): ScrapedMarket[] {
  if (!responses || responses.length === 0) {
    console.log("[Betclic/Parser] No responses to parse");
    return [];
  }

  const allMarkets: ScrapedMarket[] = [];
  let totalMarketsBeforeDedup = 0;

  for (let i = 0; i < responses.length; i++) {
    const response = responses[i];

    if (!response || response.length === 0) {
      continue;
    }

    try {
      const markets = parseAllMarketsFromProto(response);
      totalMarketsBeforeDedup += markets.length;
      allMarkets.push(...markets);
    } catch (error) {
      console.warn(`[Betclic/Parser] Error parsing response ${i + 1}/${responses.length}:`, error);
    }
  }

  // Deduplicate markets using 'name:type:paramValue' as unique key
  const seen = new Map<string, ScrapedMarket>();

  for (const market of allMarkets) {
    const key = `${market.name}:${market.type}:${market.paramValue || ""}`;

    if (!seen.has(key)) {
      seen.set(key, market);
    } else {
      const existing = seen.get(key)!;
      if (market.selections.length > existing.selections.length) {
        seen.set(key, market);
      }
    }
  }

  const dedupedMarkets = Array.from(seen.values());

  console.log(
    `[Betclic/Parser] Parsed ${responses.length} responses: ` +
      `${totalMarketsBeforeDedup} total markets, ${dedupedMarkets.length} after deduplication`
  );

  return dedupedMarkets;
}

// ============================================================================
// LISTING RESPONSE PARSER
// ============================================================================

/**
 * Helper to get BigInt varint from raw buffer
 */
function getVarintBigInt(buf: Buffer, targetField: number): bigint | null {
  let offset = 0;

  while (offset < buf.length) {
    const tagResult = readVarintBigInt(buf, offset);
    offset += tagResult.bytesRead;
    const tag = Number(tagResult.value);
    const fieldNum = tag >> 3;
    const wireType = tag & 0x07;

    if (wireType === 0) {
      const v = readVarintBigInt(buf, offset);
      if (fieldNum === targetField) return v.value;
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

/**
 * Parse listing response for matches with 1X2 odds
 */
export function parseListingResponse(data: Buffer, league: string): BetclicListingMatch[] {
  const matches: BetclicListingMatch[] = [];

  try {
    const rootFields = parseProtobuf(data);
    const wrapperField = getField(rootFields, PROTO_FIELDS.ROOT_WRAPPER);
    if (!wrapperField || !Array.isArray(wrapperField.value)) return matches;

    const wrapperFields = wrapperField.value;

    // Field 3 contains match entries
    const matchEntries = getAllFields(wrapperFields, PROTO_FIELDS.MATCH_ENTRIES);

    for (const matchEntry of matchEntries) {
      if (!Array.isArray(matchEntry.value)) continue;

      const matchFields = matchEntry.value;
      const matchName = getFieldValue<string>(matchFields, PROTO_FIELDS.MATCH_NAME) || "";
      const parts = matchName.split(TEAM_SEPARATOR).map((t) => t.trim());
      if (parts.length !== 2) continue;

      const [homeTeam, awayTeam] = parts;

      // Extract match ID as BigInt (can be very large)
      let matchId: string | null = null;
      const idField = getField(matchFields, PROTO_FIELDS.MATCH_ID);
      if (idField) {
        if (typeof idField.value === "number" || typeof idField.value === "bigint") {
          matchId = String(idField.value);
        }
      }

      // Field 9 contains markets
      const marketEntries = getAllFields(matchFields, PROTO_FIELDS.MATCH_MARKETS);
      if (marketEntries.length === 0) continue;

      // First market should be 1X2
      const firstMarket = marketEntries[0];
      if (!Array.isArray(firstMarket.value)) continue;

      // Field 16 contains outcomes
      const outcomeEntries = getAllFields(firstMarket.value, PROTO_FIELDS.MARKET_OUTCOMES);
      if (outcomeEntries.length < 3) continue;

      const odds: number[] = [];
      for (const outcomeEntry of outcomeEntries) {
        if (!Array.isArray(outcomeEntry.value)) continue;

        const oddsField = getField(outcomeEntry.value, PROTO_FIELDS.OUTCOME_ODDS);
        if (oddsField?.wireType === 1 && typeof oddsField.value === "number" && oddsField.value > 1) {
          odds.push(oddsField.value);
        }
      }

      if (odds.length >= 3) {
        matches.push({
          matchId,
          matchName,
          homeTeam,
          awayTeam,
          homeOdds: odds[0],
          drawOdds: odds[1],
          awayOdds: odds[2],
        });
      }
    }
  } catch (error) {
    console.error("[Betclic/Parser] Error parsing listing response:", error);
  }

  return matches;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse team names from Betclic matchName format
 * Format: "HomeTeam - AwayTeam"
 */
export function parseTeamNames(matchName: string): ParsedTeams {
  const parts = matchName.split(TEAM_SEPARATOR);
  return {
    homeTeam: (parts[0] || "").trim(),
    awayTeam: (parts[1] || "").trim(),
  };
}

/**
 * Validate that an event has minimum required data
 */
export function isValidMatch(match: BetclicListingMatch): boolean {
  return (
    !!match.homeTeam &&
    !!match.awayTeam &&
    match.homeOdds > 0 &&
    match.drawOdds > 0 &&
    match.awayOdds > 0
  );
}

// ============================================================================
// MATCH DETAILS HELPERS (for scrapeMatchDetails compatibility)
// ============================================================================

/**
 * Extract 1X2 odds from parsed markets
 */
export function extract1X2FromMarkets(
  markets: ScrapedMarket[],
  homeTeam: string,
  awayTeam: string
): { home: number; draw: number; away: number } | null {
  const market = markets.find(
    (m) => m.type === MARKET_TYPES.MATCH_1X2 || m.name.toLowerCase().includes("wynik meczu")
  );

  if (!market || market.selections.length < 3) return null;

  const homeOdds = market.selections.find(
    (s) => s.name === homeTeam || s.name === "1" || s.name.toLowerCase().includes("gospodarz")
  )?.odds;

  const drawOdds = market.selections.find(
    (s) => s.name === "Remis" || s.name === "Remis " || s.name === "X" || s.name.toLowerCase() === "remis"
  )?.odds;

  const awayOdds = market.selections.find(
    (s) => s.name === awayTeam || s.name === "2" || s.name.toLowerCase().includes("gość")
  )?.odds;

  if (!homeOdds || !drawOdds || !awayOdds) return null;

  return { home: homeOdds, draw: drawOdds, away: awayOdds };
}

/**
 * Extract Double Chance odds from parsed markets
 */
export function extractDoubleChanceFromMarkets(
  markets: ScrapedMarket[]
): { homeOrDraw: number; drawOrAway: number; homeOrAway: number } | null {
  const market = markets.find(
    (m) => m.type === MARKET_TYPES.DOUBLE_CHANCE || m.name.toLowerCase().includes("podwójna szansa")
  );

  if (!market || market.selections.length < 3) return null;

  const homeOrDraw = market.selections.find((s) => s.name.includes("1X") || s.name.includes("lub Remis"))?.odds;
  const drawOrAway = market.selections.find((s) => s.name.includes("X2") || s.name.includes("Remis lub"))?.odds;
  const homeOrAway = market.selections.find((s) => s.name.includes("12") || (s.name.includes("lub") && !s.name.includes("Remis")))?.odds;

  if (!homeOrDraw || !drawOrAway || !homeOrAway) return null;

  return { homeOrDraw, drawOrAway, homeOrAway };
}

/**
 * Extract BTTS odds from parsed markets
 */
export function extractBTTSFromMarkets(
  markets: ScrapedMarket[]
): { yes: number; no: number } | null {
  const market = markets.find(
    (m) => m.type === MARKET_TYPES.BTTS || m.name.toLowerCase().includes("obie drużyny")
  );

  if (!market || market.selections.length < 2) return null;

  const yes = market.selections.find((s) => s.name === "Tak" || s.name.toLowerCase() === "yes")?.odds;
  const no = market.selections.find((s) => s.name === "Nie" || s.name.toLowerCase() === "no")?.odds;

  if (!yes || !no) return null;

  return { yes, no };
}

/**
 * Extract Over/Under odds from parsed markets
 */
export function extractOverUnderFromMarkets(
  markets: ScrapedMarket[]
): Record<string, { over: number; under: number }> | null {
  const ouMarkets = markets.filter(
    (m) => m.type === MARKET_TYPES.OVER_UNDER || m.name.toLowerCase().includes("powyżej")
  );

  if (ouMarkets.length === 0) return null;

  const result: Record<string, { over: number; under: number }> = {};

  for (const market of ouMarkets) {
    // Extract line from market name (e.g., "Gole Powyżej/Poniżej 2,5")
    const lineMatch = market.name.match(/(\d+[,\.]\d+)/);
    if (!lineMatch) continue;

    const line = lineMatch[1].replace(",", ".");

    const over = market.selections.find((s) => s.name.toLowerCase().includes("powyżej"))?.odds;
    const under = market.selections.find((s) => s.name.toLowerCase().includes("poniżej"))?.odds;

    if (over && under) {
      result[line] = { over, under };
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}
