#!/usr/bin/env npx tsx
/**
 * Betclic gRPC to JSON Decoder
 * 
 * Fetches raw gRPC data from Betclic API and saves as structured JSON.
 * No normalization - just raw protobuf structure decoded to JSON.
 * 
 * Usage:
 *   npx tsx scripts/betclic-grpc-to-json.ts --match 905675290968064
 *   npx tsx scripts/betclic-grpc-to-json.ts --match 905675290968064 --tab HANDICAP
 *   npx tsx scripts/betclic-grpc-to-json.ts --match 905675290968064 --all
 */

import * as fs from "fs";
import * as path from "path";
import {
  fetchGrpcStream,
  buildMatchDetailsRequest,
  buildMatchDetailsRequestWithFilter,
} from "../src/scrapers/bookmakers/betclic/navigation.js";
import { ENDPOINTS, MARKET_GROUP_FILTERS } from "../src/scrapers/bookmakers/betclic/constants.js";

interface ProtobufValue {
  fieldNumber: number;
  wireType: number;
  wireTypeName: string;
  value: number | bigint | string | Buffer | ProtobufValue[];
  valuePreview?: string;
}

interface DecodedMessage {
  fields: ProtobufValue[];
  rawSize: number;
}

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

function getWireTypeName(wireType: number): string {
  switch (wireType) {
    case 0: return "varint";
    case 1: return "fixed64";
    case 2: return "length-delimited";
    case 5: return "fixed32";
    default: return `unknown(${wireType})`;
  }
}

function tryDecodeAsString(buf: Buffer): string | null {
  try {
    const str = buf.toString("utf8");
    // Check if it looks like valid UTF-8 text
    if (/^[\x20-\x7E\xA0-\xFF\u0100-\uFFFF]+$/.test(str) && str.length > 0) {
      return str;
    }
    return null;
  } catch {
    return null;
  }
}

function decodeProtobuf(buf: Buffer, depth: number = 0): DecodedMessage {
  const fields: ProtobufValue[] = [];
  let offset = 0;
  const maxDepth = 10;

  while (offset < buf.length) {
    const tagResult = readVarint(buf, offset);
    if (tagResult.bytesRead === 0) break;
    offset += tagResult.bytesRead;

    const fieldNumber = tagResult.value >> 3;
    const wireType = tagResult.value & 0x07;
    const wireTypeName = getWireTypeName(wireType);

    if (fieldNumber === 0 || fieldNumber > 536870911) break;

    let value: number | bigint | string | Buffer | ProtobufValue[];
    let valuePreview: string | undefined;

    if (wireType === 0) {
      // Varint
      const result = readVarintBigInt(buf, offset);
      offset += result.bytesRead;
      value = result.value <= Number.MAX_SAFE_INTEGER ? Number(result.value) : result.value;
      valuePreview = String(value);
    } else if (wireType === 1) {
      // Fixed64 (double)
      if (offset + 8 > buf.length) break;
      const doubleVal = buf.readDoubleLE(offset);
      offset += 8;
      value = doubleVal;
      valuePreview = doubleVal.toFixed(4);
    } else if (wireType === 2) {
      // Length-delimited
      const lenResult = readVarint(buf, offset);
      offset += lenResult.bytesRead;
      const len = lenResult.value;

      if (offset + len > buf.length) break;
      const data = buf.slice(offset, offset + len);
      offset += len;

      // Try to decode as string first
      const strValue = tryDecodeAsString(data);
      if (strValue !== null) {
        value = strValue;
        valuePreview = strValue.length > 50 ? strValue.substring(0, 50) + "..." : strValue;
      } else if (depth < maxDepth) {
        // Try to decode as nested message
        try {
          const nested = decodeProtobuf(data, depth + 1);
          if (nested.fields.length > 0) {
            value = nested.fields;
            valuePreview = `[${nested.fields.length} nested fields]`;
          } else {
            value = data;
            valuePreview = `<${data.length} bytes>`;
          }
        } catch {
          value = data;
          valuePreview = `<${data.length} bytes>`;
        }
      } else {
        value = data;
        valuePreview = `<${data.length} bytes>`;
      }
    } else if (wireType === 5) {
      // Fixed32 (float)
      if (offset + 4 > buf.length) break;
      const floatVal = buf.readFloatLE(offset);
      offset += 4;
      value = floatVal;
      valuePreview = floatVal.toFixed(4);
    } else {
      // Unknown wire type
      break;
    }

    fields.push({
      fieldNumber,
      wireType,
      wireTypeName,
      value,
      valuePreview,
    });
  }

  return { fields, rawSize: buf.length };
}

function convertToSerializable(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === "bigint") {
    return obj.toString();
  }
  
  if (Buffer.isBuffer(obj)) {
    return {
      _type: "Buffer",
      hex: obj.toString("hex").substring(0, 100),
      length: obj.length,
    };
  }
  
  if (Array.isArray(obj)) {
    return obj.map(convertToSerializable);
  }
  
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = convertToSerializable(val);
    }
    return result;
  }
  
  return obj;
}

async function fetchAndDecode(matchId: string, categoryId: string | null): Promise<DecodedMessage> {
  const requestBody = categoryId
    ? buildMatchDetailsRequestWithFilter(matchId, categoryId)
    : buildMatchDetailsRequest(matchId);
  
  const response = await fetchGrpcStream(ENDPOINTS.match, requestBody);
  return decodeProtobuf(response);
}

async function main() {
  const args = process.argv.slice(2);
  
  let matchId = "905675290968064"; // Default test match
  let specificTab: string | null = null;
  let fetchAll = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--match" && args[i + 1]) {
      matchId = args[i + 1];
      i++;
    } else if (args[i] === "--tab" && args[i + 1]) {
      specificTab = args[i + 1].toUpperCase();
      i++;
    } else if (args[i] === "--all") {
      fetchAll = true;
    }
  }

  console.log("=".repeat(80));
  console.log("BETCLIC gRPC TO JSON DECODER");
  console.log("=".repeat(80));
  console.log(`Match ID: ${matchId}`);
  console.log();

  const outputDir = path.join(process.cwd(), "data", "betclic-decoded");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const results: Record<string, unknown> = {
    matchId,
    fetchedAt: new Date().toISOString(),
    tabs: {},
  };

  if (fetchAll) {
    console.log("Fetching ALL tabs...\n");
    
    for (const [tabName, categoryId] of Object.entries(MARKET_GROUP_FILTERS)) {
      const categoryDisplay = categoryId || "(no filter)";
      console.log(`Fetching ${tabName} (category=${categoryDisplay})...`);
      
      try {
        const decoded = await fetchAndDecode(matchId, categoryId);
        (results.tabs as Record<string, unknown>)[tabName] = {
          categoryId,
          rawSize: decoded.rawSize,
          fieldsCount: decoded.fields.length,
          fields: convertToSerializable(decoded.fields),
        };
        console.log(`  ✓ ${decoded.rawSize} bytes, ${decoded.fields.length} top-level fields`);
      } catch (error) {
        console.log(`  ✗ Error: ${error instanceof Error ? error.message : error}`);
        (results.tabs as Record<string, unknown>)[tabName] = { error: String(error) };
      }
      
      await new Promise(r => setTimeout(r, 100));
    }
  } else if (specificTab) {
    const categoryId = MARKET_GROUP_FILTERS[specificTab as keyof typeof MARKET_GROUP_FILTERS];
    if (categoryId === undefined) {
      console.error(`Unknown tab: ${specificTab}`);
      console.log(`Available tabs: ${Object.keys(MARKET_GROUP_FILTERS).join(", ")}`);
      process.exit(1);
    }
    
    console.log(`Fetching ${specificTab} (category=${categoryId || "(no filter)"})...`);
    const decoded = await fetchAndDecode(matchId, categoryId);
    (results.tabs as Record<string, unknown>)[specificTab] = {
      categoryId,
      rawSize: decoded.rawSize,
      fieldsCount: decoded.fields.length,
      fields: convertToSerializable(decoded.fields),
    };
    console.log(`  ✓ ${decoded.rawSize} bytes, ${decoded.fields.length} top-level fields`);
  } else {
    console.log("Fetching TOP (no filter - default)...");
    const decoded = await fetchAndDecode(matchId, null);
    (results.tabs as Record<string, unknown>)["TOP"] = {
      categoryId: null,
      rawSize: decoded.rawSize,
      fieldsCount: decoded.fields.length,
      fields: convertToSerializable(decoded.fields),
    };
    console.log(`  ✓ ${decoded.rawSize} bytes, ${decoded.fields.length} top-level fields`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const filename = fetchAll 
    ? `match-${matchId}-all-${timestamp}.json`
    : specificTab 
      ? `match-${matchId}-${specificTab.toLowerCase()}-${timestamp}.json`
      : `match-${matchId}-top-${timestamp}.json`;
  
  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  
  console.log();
  console.log("=".repeat(80));
  console.log(`Output saved to: ${outputPath}`);
  console.log("=".repeat(80));
}

main().catch(console.error);
