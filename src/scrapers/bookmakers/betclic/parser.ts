/**
 * Betclic Parser Module
 *
 * Pure parsing logic for transforming Betclic gRPC/protobuf responses
 * into the unified market format.
 *
 * This module has NO network dependencies - it only works with
 * raw Buffer data from the gRPC API.
 */

import type { MarketSelection, ScrapedMarket } from "../../../types/full-offer.js";
import type {
  ParsedFields,
  ProtobufFieldValue,
  ExtractedOutcome,
  BetclicListingMatch,
  BetclicMatchDetails,
  ParsedTeams,
  Market1X2,
  MarketDoubleChance,
  MarketBTTS,
  MarketOverUnder,
  VarintReadResult,
  BigIntVarintReadResult,
} from "./types.js";
import {
  PROTO_FIELDS,
  OUTCOME_NAMES,
  TEAM_SEPARATOR,
  OVER_UNDER_LINES,
  MARKET_GROUPS,
  MARKET_TYPES,
} from "./constants.js";

// ============ Protobuf Parsing Helpers ============

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
 * Parse all fields from a protobuf buffer
 */
export function parseFields(buf: Buffer): ParsedFields {
  const fields = new Map<number, ProtobufFieldValue[]>();
  let offset = 0;

  while (offset < buf.length) {
    const tag = readVarint(buf, offset);
    if (tag.bytesRead === 0) break;
    offset += tag.bytesRead;

    const fieldNum = tag.value >> 3;
    const wireType = tag.value & 0x07;

    let value: ProtobufFieldValue | null = null;

    if (wireType === 0) {
      // Varint
      const v = readVarint(buf, offset);
      offset += v.bytesRead;
      value = { type: "varint", data: v.value };
    } else if (wireType === 2) {
      // Length-delimited (bytes/string/embedded message)
      const len = readVarint(buf, offset);
      offset += len.bytesRead;
      if (offset + len.value > buf.length) break;
      const data = buf.slice(offset, offset + len.value);
      offset += len.value;
      value = { type: "bytes", data };
    } else if (wireType === 5) {
      // 32-bit (float)
      if (offset + 4 > buf.length) break;
      value = { type: "float", data: buf.readFloatLE(offset) };
      offset += 4;
    } else if (wireType === 1) {
      // 64-bit (double)
      if (offset + 8 > buf.length) break;
      value = { type: "double", data: buf.readDoubleLE(offset) };
      offset += 8;
    } else {
      // Unknown wire type
      break;
    }

    if (value) {
      if (!fields.has(fieldNum)) {
        fields.set(fieldNum, []);
      }
      fields.get(fieldNum)!.push(value);
    }
  }

  return fields;
}

/**
 * Get string value from parsed fields
 */
export function getString(fields: ParsedFields, num: number): string | null {
  const f = fields.get(num)?.[0];
  if (f?.type === "bytes" && Buffer.isBuffer(f.data)) {
    return f.data.toString("utf8");
  }
  return null;
}

/**
 * Get varint value from parsed fields
 */
export function getVarint(fields: ParsedFields, num: number): number | null {
  const f = fields.get(num)?.[0];
  if (f?.type === "varint" && typeof f.data === "number") {
    return f.data;
  }
  return null;
}

/**
 * Get BigInt varint from raw buffer for a specific field number
 * Re-parses to handle large values
 */
export function getVarintBigInt(fields: ParsedFields, num: number, buf: Buffer): bigint | null {
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

/**
 * Get double value from parsed fields
 */
export function getDouble(fields: ParsedFields, num: number): number | null {
  const f = fields.get(num)?.[0];
  if (f?.type === "double" && typeof f.data === "number") return f.data;
  if (f?.type === "float" && typeof f.data === "number") return f.data;
  return null;
}

/**
 * Get embedded message from parsed fields
 */
export function getMessage(fields: ParsedFields, num: number): ParsedFields | null {
  const f = fields.get(num)?.[0];
  if (f?.type === "bytes" && Buffer.isBuffer(f.data)) {
    try {
      return parseFields(f.data);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Get all embedded messages from a repeated field
 */
export function getMessages(fields: ParsedFields, num: number): ParsedFields[] {
  const results: ParsedFields[] = [];
  const arr = fields.get(num) || [];

  for (const f of arr) {
    if (f?.type === "bytes" && Buffer.isBuffer(f.data)) {
      try {
        results.push(parseFields(f.data));
      } catch {
        // Skip invalid messages
      }
    }
  }

  return results;
}

// ============ Team Name Parsing ============

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

// ============ Outcome Extraction ============

/**
 * Extract all outcomes by scanning buffer for odds patterns
 * This is the core algorithm for parsing Betclic's protobuf structure
 */
export function extractAllOutcomes(buf: Buffer): ExtractedOutcome[] {
  const outcomes: ExtractedOutcome[] = [];
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

              // Validate string contains printable characters
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

// ============ Listing Response Parser ============

/**
 * Parse listing response for matches with 1X2 odds
 */
export function parseListingResponse(data: Buffer, league: string): BetclicListingMatch[] {
  const matches: BetclicListingMatch[] = [];

  try {
    const root = parseFields(data);
    const wrapper = getMessage(root, PROTO_FIELDS.ROOT_WRAPPER);
    if (!wrapper) return matches;

    // Field 3 contains match entries
    const matchMsgs = getMessages(wrapper, PROTO_FIELDS.MATCH_ENTRIES);

    // Get raw match message bytes for BigInt parsing
    const matchRawMsgs = wrapper.get(PROTO_FIELDS.MATCH_ENTRIES) || [];

    for (let i = 0; i < matchMsgs.length; i++) {
      const match = matchMsgs[i];
      const matchRaw = matchRawMsgs[i];

      const matchName = getString(match, PROTO_FIELDS.MATCH_NAME) || "";
      const parts = matchName.split(TEAM_SEPARATOR).map((t) => t.trim());
      if (parts.length !== 2) continue;

      const [homeTeam, awayTeam] = parts;

      // Extract match ID from field 1 as BigInt (can be very large)
      let matchId: string | null = null;
      if (matchRaw?.type === "bytes" && Buffer.isBuffer(matchRaw.data)) {
        const bigId = getVarintBigInt(match, PROTO_FIELDS.MATCH_ID, matchRaw.data);
        if (bigId !== null) {
          matchId = bigId.toString();
        }
      }

      // Field 9 contains markets
      const markets = getMessages(match, PROTO_FIELDS.MATCH_MARKETS);
      if (markets.length === 0) continue;

      // First market should be 1X2
      const market = markets[0];

      // Field 16 contains outcomes
      const outcomes = getMessages(market, PROTO_FIELDS.MARKET_OUTCOMES);
      if (outcomes.length < 3) continue;

      const odds: number[] = [];
      for (const outcome of outcomes) {
        const outcomeOdds = getDouble(outcome, PROTO_FIELDS.OUTCOME_ODDS);
        if (outcomeOdds && outcomeOdds > 1) {
          odds.push(outcomeOdds);
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

// ============ Match Details Response Parser ============

/**
 * Parse match details response for all outcomes
 */
export function parseMatchDetailsResponse(data: Buffer): BetclicMatchDetails | null {
  try {
    const outcomes = extractAllOutcomes(data);
    if (outcomes.length === 0) return null;

    // Get match info
    const root = parseFields(data);
    const wrapper = getMessage(root, PROTO_FIELDS.ROOT_WRAPPER);
    const matchInfo = wrapper ? getMessage(wrapper, PROTO_FIELDS.MATCH_ID) : null;
    const matchName = matchInfo ? getString(matchInfo, PROTO_FIELDS.MATCH_NAME) || "" : "";
    const parts = matchName.split(TEAM_SEPARATOR).map((t) => t.trim());

    return {
      matchName,
      homeTeam: parts[0] || "",
      awayTeam: parts[1] || "",
      outcomes,
    };
  } catch (error) {
    console.error("[Betclic/Parser] Error parsing match details:", error);
    return null;
  }
}

// ============ Market Extraction from Outcomes ============

/**
 * Extract 1X2 market from outcomes
 */
export function extract1X2Market(
  outcomes: ExtractedOutcome[],
  homeTeam: string,
  awayTeam: string
): Market1X2 | null {
  const result: Market1X2 = { home: 0, draw: 0, away: 0 };

  const homeOutcome = outcomes.find(
    (o) => o.name === homeTeam && o.odds > 1.5 && o.odds < 10
  );
  const drawOutcome = outcomes.find(
    (o) =>
      (o.name === OUTCOME_NAMES.DRAW || o.name === OUTCOME_NAMES.DRAW_ALT) &&
      o.odds > 2 &&
      o.odds < 10
  );
  const awayOutcome = outcomes.find(
    (o) => o.name === awayTeam && o.odds > 1.5 && o.odds < 10
  );

  if (homeOutcome && drawOutcome && awayOutcome) {
    result.home = homeOutcome.odds;
    result.draw = drawOutcome.odds;
    result.away = awayOutcome.odds;
    return result;
  }

  return null;
}

/**
 * Extract Double Chance market from outcomes
 */
export function extractDoubleChanceMarket(
  outcomes: ExtractedOutcome[],
  homeTeam: string,
  awayTeam: string
): MarketDoubleChance | null {
  const result: MarketDoubleChance = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
  let found = false;

  const dc1X = outcomes.find(
    (o) => o.name.includes(OUTCOME_NAMES.OR_DRAW_PATTERN) && o.name.includes(homeTeam)
  );
  const dcX2 = outcomes.find(
    (o) => o.name.includes(OUTCOME_NAMES.DRAW_OR_PATTERN) && o.name.includes(awayTeam)
  );
  const dc12 = outcomes.find(
    (o) =>
      o.name.includes(homeTeam) &&
      o.name.includes(awayTeam) &&
      o.name.includes(OUTCOME_NAMES.OR_PATTERN)
  );

  if (dc1X) {
    result.homeOrDraw = dc1X.odds;
    found = true;
  }
  if (dcX2) {
    result.drawOrAway = dcX2.odds;
    found = true;
  }
  if (dc12) {
    result.homeOrAway = dc12.odds;
    found = true;
  }

  return found ? result : null;
}

/**
 * Extract BTTS market from outcomes
 */
export function extractBTTSMarket(outcomes: ExtractedOutcome[]): MarketBTTS | null {
  const result: MarketBTTS = { yes: 0, no: 0 };

  const bttsYes = outcomes.find(
    (o) => o.name === OUTCOME_NAMES.YES && o.odds > 1.5 && o.odds < 3
  );
  const bttsNo = outcomes.find(
    (o) => o.name === OUTCOME_NAMES.NO && o.odds > 1.5 && o.odds < 3
  );

  if (bttsYes && bttsNo) {
    result.yes = bttsYes.odds;
    result.no = bttsNo.odds;
    return result;
  }

  return null;
}

/**
 * Extract Over/Under markets from outcomes
 */
export function extractOverUnderMarkets(outcomes: ExtractedOutcome[]): MarketOverUnder | null {
  const result: MarketOverUnder = {};

  for (const line of OVER_UNDER_LINES) {
    const lineStr = line.toString().replace(".", ",");

    const overOutcome = outcomes.find(
      (o) => o.name === `${OUTCOME_NAMES.OVER_PREFIX} ${lineStr}` && o.odds > 1.01
    );
    const underOutcome = outcomes.find(
      (o) => o.name === `${OUTCOME_NAMES.UNDER_PREFIX} ${lineStr}` && o.odds > 1.01
    );

    if (overOutcome && underOutcome) {
      result[line.toFixed(1)] = {
        over: overOutcome.odds,
        under: underOutcome.odds,
      };
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

// ============ Full Market Parsing for scrapeFullOffer ============

/**
 * Parse all markets from raw protobuf data into unified ScrapedMarket format
 * This is the main function for full offer scraping
 *
 * @param rawData - Raw protobuf buffer from match details response
 * @param teams - Parsed team names (for fallback if structured parsing fails)
 * @returns Array of ScrapedMarket objects
 */
export function parseAllMarketsFromProto(rawData: Buffer): ScrapedMarket[] {
  const markets: ScrapedMarket[] = [];

  try {
    const root = parseFields(rawData);
    const wrapper = getMessage(root, 1);
    if (!wrapper) return markets;

    // Field 2 in wrapper contains market groups
    const marketGroupMsgs = wrapper.get(2) || [];

    for (const msgValue of marketGroupMsgs) {
      if (msgValue.type !== "bytes" || !Buffer.isBuffer(msgValue.data)) continue;

      const groupFields = parseFields(msgValue.data);

      // Extract market group name (field 2)
      const groupName = getString(groupFields, 2) || "Other";

      // Look for nested market messages in fields 3-20
      for (let fieldNum = 1; fieldNum <= 20; fieldNum++) {
        const nestedMsgs = groupFields.get(fieldNum) || [];

        for (const nested of nestedMsgs) {
          if (nested.type !== "bytes" || !Buffer.isBuffer(nested.data)) continue;

          const nestedFields = parseFields(nested.data);

          // Market name is usually in field 2
          const marketName = getString(nestedFields, 2);
          if (!marketName) continue;

          // Extract outcomes from field 16
          const outcomesMsgs = getMessages(nestedFields, 16);
          if (outcomesMsgs.length === 0) continue;

          const selections: MarketSelection[] = [];

          for (const outcomeFields of outcomesMsgs) {
            // Outcome name - prefer field 11 (long name), fallback to field 10 (short name)
            const outcomeName = getString(outcomeFields, 11) || getString(outcomeFields, 10) || "";
            const odds = getDouble(outcomeFields, 12);

            if (outcomeName && odds && odds > 1.0) {
              selections.push({
                name: outcomeName.trim(),
                odds: odds,
              });
            }
          }

          if (selections.length > 0) {
            markets.push({
              name: marketName,
              groupName: groupName,
              type: inferMarketType(marketName),
              selections: selections,
            });
          }
        }
      }
    }
  } catch (error) {
    console.warn("[Betclic/Parser] Error in structured parsing, falling back to outcome scan");
  }

  // If structured parsing found markets, return them
  if (markets.length > 0) {
    return markets;
  }

  // Fallback: use extractAllOutcomes and group by pattern
  return parseAllMarketsFromOutcomes(rawData);
}

/**
 * Fallback market parsing using outcome scanning
 * Groups outcomes into markets based on name patterns
 */
function parseAllMarketsFromOutcomes(rawData: Buffer): ScrapedMarket[] {
  const markets: ScrapedMarket[] = [];
  const outcomes = extractAllOutcomes(rawData);

  if (outcomes.length === 0) {
    return markets;
  }

  // Group outcomes by pattern analysis
  const groups: Map<string, ExtractedOutcome[]> = new Map();

  for (const outcome of outcomes) {
    const groupKey = categorizeOutcome(outcome.name);
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(outcome);
  }

  // Convert groups to markets
  for (const [groupKey, groupOutcomes] of groups) {
    if (groupOutcomes.length === 0) continue;

    // Special handling for Over/Under - split by line
    if (groupKey === "over_under") {
      const byLine = new Map<string, ExtractedOutcome[]>();
      for (const o of groupOutcomes) {
        const lineMatch = o.name.match(/(\d+,\d+)/);
        const line = lineMatch ? lineMatch[1] : "default";
        if (!byLine.has(line)) {
          byLine.set(line, []);
        }
        byLine.get(line)!.push(o);
      }

      for (const [line, lineOutcomes] of byLine) {
        if (lineOutcomes.length >= 2) {
          markets.push({
            name: `Liczba goli ${line.replace(",", ".")}`,
            groupName: MARKET_GROUPS.GOALS,
            type: MARKET_TYPES.OVER_UNDER,
            selections: lineOutcomes.map((o) => ({
              name: o.name,
              odds: o.odds,
            })),
          });
        }
      }
      continue;
    }

    // Special handling for goalscorer - split by odds range into different market types
    if (groupKey === "goalscorer") {
      const goalscorerMarkets = splitGoalscorerOutcomes(groupOutcomes);
      markets.push(...goalscorerMarkets);
      continue;
    }

    // Create market from group
    const marketInfo = getMarketInfo(groupKey);
    markets.push({
      name: marketInfo.name,
      groupName: marketInfo.groupName,
      type: marketInfo.type,
      selections: groupOutcomes.map((o) => ({
        name: o.name,
        odds: o.odds,
      })),
    });
  }

  return markets;
}

/**
 * Split goalscorer outcomes into multiple markets
 *
 * Strategy: Group player outcomes by the player name, creating one market per player
 * where each market contains all the different goalscorer bets for that player
 * (anytime, first, last, 2+, etc.)
 *
 * This results in many markets (one per player) which matches how bookmakers
 * typically structure their goalscorer offerings.
 */
function splitGoalscorerOutcomes(outcomes: ExtractedOutcome[]): ScrapedMarket[] {
  const markets: ScrapedMarket[] = [];

  // Group outcomes by player name
  const byPlayer = new Map<string, ExtractedOutcome[]>();

  for (const o of outcomes) {
    const name = o.name.trim();
    if (!byPlayer.has(name)) {
      byPlayer.set(name, []);
    }
    byPlayer.get(name)!.push(o);
  }

  // Create one market per player
  for (const [playerName, playerOutcomes] of byPlayer) {
    // Skip if player name looks like a team or other non-player entry
    if (playerOutcomes.length === 0) continue;

    // Sort by odds to show most likely first
    playerOutcomes.sort((a, b) => a.odds - b.odds);

    markets.push({
      name: `Strzelec: ${playerName}`,
      groupName: MARKET_GROUPS.OTHER,
      type: "GOALSCORER",
      selections: playerOutcomes.map((o) => ({
        name: describeGoalscorerOdds(o.odds),
        odds: o.odds,
      })),
    });
  }

  return markets;
}

/**
 * Describe the type of goalscorer bet based on odds
 */
function describeGoalscorerOdds(odds: number): string {
  if (odds < 3.0) return "Anytime scorer";
  if (odds < 6.0) return "First/Last scorer";
  if (odds < 12.0) return "2+ goals";
  return "Special";
}

/**
 * Categorize an outcome name into a group key
 */
function categorizeOutcome(name: string): string {
  if (name.startsWith("Powyżej") || name.startsWith("Poniżej")) {
    return "over_under";
  }
  if (name === "Tak" || name === "Nie") {
    return "btts";
  }
  if (name.includes(" lub ")) {
    return "double_chance";
  }
  if (name === "Remis" || name === "Remis ") {
    return "match_result";
  }
  if (/^[0-9]+-[0-9]+$/.test(name) || /^[0-9]:[0-9]$/.test(name)) {
    return "correct_score";
  }
  // Default: treat as goalscorer or other outcome
  return "goalscorer";
}

/**
 * Get market name and group info from category key
 */
function getMarketInfo(key: string): { name: string; groupName: string; type: string } {
  switch (key) {
    case "match_result":
      return { name: "Wynik meczu", groupName: MARKET_GROUPS.MATCH_RESULT, type: MARKET_TYPES.MATCH_1X2 };
    case "double_chance":
      return { name: "Podwójna szansa", groupName: MARKET_GROUPS.MATCH_RESULT, type: MARKET_TYPES.DOUBLE_CHANCE };
    case "btts":
      return { name: "Obie drużyny strzelą", groupName: MARKET_GROUPS.GOALS, type: MARKET_TYPES.BTTS };
    case "correct_score":
      return { name: "Dokładny wynik", groupName: MARKET_GROUPS.CORRECT_SCORE, type: MARKET_TYPES.CORRECT_SCORE };
    case "goalscorer":
      return { name: "Strzelcy", groupName: MARKET_GROUPS.OTHER, type: "GOALSCORER" };
    default:
      return { name: "Inne", groupName: MARKET_GROUPS.OTHER, type: "OTHER" };
  }
}

/**
 * Infer market type from market name
 */
function inferMarketType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("wynik meczu")) return MARKET_TYPES.MATCH_1X2;
  if (lower.includes("podwójna szansa") || lower.includes("podwojna szansa")) return MARKET_TYPES.DOUBLE_CHANCE;
  if (lower.includes("obie drużyny") || lower.includes("obie druzyny")) return MARKET_TYPES.BTTS;
  if (lower.includes("gol") && (lower.includes("powyżej") || lower.includes("poniżej"))) return MARKET_TYPES.OVER_UNDER;
  if (lower.includes("dokładny wynik") || lower.includes("dokladny wynik")) return MARKET_TYPES.CORRECT_SCORE;
  if (lower.includes("handicap")) return MARKET_TYPES.HANDICAP;
  if (lower.includes("połowa") || lower.includes("polowa")) return MARKET_TYPES.HALF_TIME_1X2;
  if (lower.includes("strzel")) return "GOALSCORER";
  return "OTHER";
}

/**
 * Legacy parseAllMarkets for backward compatibility
 * Now delegates to parseAllMarketsFromOutcomes with outcome data
 */
export function parseAllMarkets(
  outcomes: ExtractedOutcome[],
  teams: ParsedTeams
): ScrapedMarket[] {
  const markets: ScrapedMarket[] = [];

  if (outcomes.length === 0) {
    return markets;
  }

  // Group outcomes by pattern analysis
  const groups: Map<string, ExtractedOutcome[]> = new Map();

  for (const outcome of outcomes) {
    // Special handling for team names in 1X2
    let groupKey: string;
    if (outcome.name === teams.homeTeam || outcome.name === teams.awayTeam) {
      groupKey = "match_result";
    } else {
      groupKey = categorizeOutcome(outcome.name);
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(outcome);
  }

  // Convert groups to markets
  for (const [groupKey, groupOutcomes] of groups) {
    if (groupOutcomes.length === 0) continue;

    // Special handling for Over/Under - split by line
    if (groupKey === "over_under") {
      const byLine = new Map<string, ExtractedOutcome[]>();
      for (const o of groupOutcomes) {
        const lineMatch = o.name.match(/(\d+,\d+)/);
        const line = lineMatch ? lineMatch[1] : "default";
        if (!byLine.has(line)) {
          byLine.set(line, []);
        }
        byLine.get(line)!.push(o);
      }

      for (const [line, lineOutcomes] of byLine) {
        if (lineOutcomes.length >= 2) {
          markets.push({
            name: `Liczba goli ${line.replace(",", ".")}`,
            groupName: MARKET_GROUPS.GOALS,
            type: MARKET_TYPES.OVER_UNDER,
            selections: lineOutcomes.map((o) => ({
              name: o.name,
              odds: o.odds,
            })),
          });
        }
      }
      continue;
    }

    // Create market from group
    const marketInfo = getMarketInfo(groupKey);
    markets.push({
      name: marketInfo.name,
      groupName: marketInfo.groupName,
      type: marketInfo.type,
      selections: groupOutcomes.map((o) => ({
        name: o.name,
        odds: o.odds,
      })),
    });
  }

  return markets;
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
  // Handle empty input gracefully
  if (!responses || responses.length === 0) {
    console.log("[Betclic/Parser] No responses to parse");
    return [];
  }

  const allMarkets: ScrapedMarket[] = [];
  let totalMarketsBeforeDedup = 0;

  // Parse each response buffer
  for (let i = 0; i < responses.length; i++) {
    const response = responses[i];

    // Skip empty or invalid buffers
    if (!response || response.length === 0) {
      continue;
    }

    try {
      const markets = parseAllMarketsFromProto(response);
      totalMarketsBeforeDedup += markets.length;
      allMarkets.push(...markets);
    } catch (error) {
      console.warn(`[Betclic/Parser] Error parsing response ${i + 1}/${responses.length}:`, error);
      // Continue processing remaining responses
    }
  }

  // Deduplicate markets using 'name:type' as unique key
  const seen = new Map<string, ScrapedMarket>();

  for (const market of allMarkets) {
    const key = `${market.name}:${market.type}`;

    if (!seen.has(key)) {
      seen.set(key, market);
    } else {
      // If duplicate, keep the one with more selections (more complete data)
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
