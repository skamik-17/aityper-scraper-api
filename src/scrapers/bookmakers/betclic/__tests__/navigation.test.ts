import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encodeBigVarint } from "../parser.js";
import { MARKET_GROUP_FILTERS } from "../constants.js";
import { buildMatchDetailsRequestWithFilter } from "../navigation.js";

describe("buildMatchDetailsRequestWithFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("encodes matchId correctly in Field 1 with tag 0x08", () => {
    const matchId = "905675290968064";
    const categoryId = "ca_ftb_rslt";

    const result = buildMatchDetailsRequestWithFilter(matchId, categoryId);

    expect(result[0]).toBe(0x08);

    const expectedMatchIdBytes = encodeBigVarint(BigInt(matchId));
    const actualMatchIdBytes = result.slice(1, 1 + expectedMatchIdBytes.length);
    expect(Buffer.from(actualMatchIdBytes)).toEqual(
      Buffer.from(expectedMatchIdBytes)
    );
  });

  it("correctly encodes large match ID values", () => {
    const largeMatchId = "18446744073709551615";
    const categoryId = "ca_ftb_rslt";

    const result = buildMatchDetailsRequestWithFilter(largeMatchId, categoryId);

    expect(result[0]).toBe(0x08);

    const expectedMatchIdBytes = encodeBigVarint(BigInt(largeMatchId));
    const actualMatchIdBytes = result.slice(1, 1 + expectedMatchIdBytes.length);
    expect(Buffer.from(actualMatchIdBytes)).toEqual(
      Buffer.from(expectedMatchIdBytes)
    );
  });

  it("encodes language field correctly in Field 2 with tag 0x12", () => {
    const matchId = "905675290968064";
    const categoryId = "ca_ftb_rslt";

    const result = buildMatchDetailsRequestWithFilter(matchId, categoryId);

    const matchIdBytes = encodeBigVarint(BigInt(matchId));
    const field2Offset = 1 + matchIdBytes.length;

    expect(result[field2Offset]).toBe(0x12);
    expect(result[field2Offset + 1]).toBe(2);
    expect(result.slice(field2Offset + 2, field2Offset + 4).toString()).toBe("pl");
  });

  it("encodes category field correctly in Field 3 with tag 0x1a", () => {
    const matchId = "905675290968064";
    const categoryId = "ca_ftb_rslt";

    const result = buildMatchDetailsRequestWithFilter(matchId, categoryId);

    const matchIdBytes = encodeBigVarint(BigInt(matchId));
    const field2Offset = 1 + matchIdBytes.length;
    const field3Offset = field2Offset + 4;

    expect(result[field3Offset]).toBe(0x1a);
    expect(result[field3Offset + 1]).toBe(categoryId.length);
    expect(result.slice(field3Offset + 2, field3Offset + 2 + categoryId.length).toString()).toBe(categoryId);
  });

  it("correctly encodes all market group filter values", () => {
    const matchId = "905675290968064";

    for (const [groupName, categoryId] of Object.entries(MARKET_GROUP_FILTERS)) {
      const result = buildMatchDetailsRequestWithFilter(matchId, categoryId);

      expect(result[0]).toBe(0x08);

      const matchIdBytes = encodeBigVarint(BigInt(matchId));
      const field2Offset = 1 + matchIdBytes.length;
      expect(result[field2Offset]).toBe(0x12);

      if (categoryId !== null) {
        const field3Offset = field2Offset + 4;
        expect(result[field3Offset]).toBe(0x1a);
      }
    }
  });

  it("produces request without category field when categoryId is null", () => {
    const matchId = "123456789";
    const categoryId = null;

    const result = buildMatchDetailsRequestWithFilter(matchId, categoryId);

    const matchIdBytes = encodeBigVarint(BigInt(matchId));
    const expectedLength = 1 + matchIdBytes.length + 4;
    expect(result.length).toBe(expectedLength);

    expect(result[0]).toBe(0x08);
    const field2Offset = 1 + matchIdBytes.length;
    expect(result[field2Offset]).toBe(0x12);
  });

  it("produces complete request with all fields in correct order", () => {
    const matchId = "123456789";
    const categoryId = "ca_ftb_goa";

    const result = buildMatchDetailsRequestWithFilter(matchId, categoryId);

    const matchIdBytes = encodeBigVarint(BigInt(matchId));
    const expectedLength = 1 + matchIdBytes.length + 4 + 2 + categoryId.length;
    expect(result.length).toBe(expectedLength);

    expect(result[0]).toBe(0x08);
    expect(Buffer.from(result.slice(1, 1 + matchIdBytes.length))).toEqual(
      Buffer.from(matchIdBytes)
    );

    const field2Offset = 1 + matchIdBytes.length;
    expect(result[field2Offset]).toBe(0x12);
    expect(result[field2Offset + 1]).toBe(2);

    const field3Offset = field2Offset + 4;
    expect(result[field3Offset]).toBe(0x1a);
    expect(result[field3Offset + 1]).toBe(categoryId.length);
  });

  it("handles empty string categoryId by not including field 3", () => {
    const matchId = "905675290968064";
    const categoryId = "";

    const result = buildMatchDetailsRequestWithFilter(matchId, categoryId);

    const matchIdBytes = encodeBigVarint(BigInt(matchId));
    const expectedLength = 1 + matchIdBytes.length + 4;
    expect(result.length).toBe(expectedLength);
  });
});
