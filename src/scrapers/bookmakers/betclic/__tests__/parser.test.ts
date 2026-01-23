import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseAllMarketsFromMultipleResponses } from "../parser.js";
import type { ScrapedMarket } from "../../../../types/full-offer.js";

describe("parseAllMarketsFromMultipleResponses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles empty array input gracefully", () => {
    const result = parseAllMarketsFromMultipleResponses([]);
    expect(result).toEqual([]);
  });

  it("handles null/undefined input gracefully", () => {
    const result1 = parseAllMarketsFromMultipleResponses([undefined, null] as any);
    expect(result1).toEqual([]);

    const result2 = parseAllMarketsFromMultipleResponses([undefined] as any);
    expect(result2).toEqual([]);
  });

  it("handles empty buffers gracefully", () => {
    const responses = [Buffer.alloc(0), Buffer.alloc(0)];
    const result = parseAllMarketsFromMultipleResponses(responses);
    expect(result).toEqual([]);
  });

  it("handles single response with no markets", () => {
    // Test with actual protobuf structure that produces no markets
    // Protobuf with valid structure but no market data
    const protoWithNoMarkets = Buffer.from([
      0x0a, 0x06, // Field 1 (varint) + length 6
      0x08, 0x04, // Field 1, length 4
      0x00, // Value 0 (match ID)
    ]);

    const responses = [protoWithNoMarkets];
    const result = parseAllMarketsFromMultipleResponses(responses);

    expect(result).toEqual([]);
  });

  it("handles empty buffer in middle of responses", () => {
    const responses = [
      Buffer.from([0x01]), // Valid non-empty (though might have no markets)
      Buffer.alloc(0), // Empty
      Buffer.from([0x03]), // Valid non-empty (though might have no markets)
    ];

    const result = parseAllMarketsFromMultipleResponses(responses);

    expect(result).toEqual([]);
  });
});
