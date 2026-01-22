import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encodeVarint, encodeBigVarint } from "../parser.js";
import { MARKET_GROUP_FILTERS } from "../constants.js";
import {
  buildMatchDetailsRequestWithFilter,
  fetchAllMarketGroups,
} from "../navigation.js";

describe("buildMatchDetailsRequestWithFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("encodes matchId correctly in Field 1 with tag 0x08", () => {
    const matchId = "905675290968064";
    const marketGroup = 0;

    const result = buildMatchDetailsRequestWithFilter(matchId, marketGroup);

    expect(result[0]).toBe(0x08);

    const expectedMatchIdBytes = encodeBigVarint(BigInt(matchId));
    const actualMatchIdBytes = result.slice(1, 1 + expectedMatchIdBytes.length);
    expect(Buffer.from(actualMatchIdBytes)).toEqual(
      Buffer.from(expectedMatchIdBytes)
    );
  });

  it("correctly encodes large match ID values", () => {
    const largeMatchId = "18446744073709551615";
    const marketGroup = 0;

    const result = buildMatchDetailsRequestWithFilter(largeMatchId, marketGroup);

    expect(result[0]).toBe(0x08);

    const expectedMatchIdBytes = encodeBigVarint(BigInt(largeMatchId));
    const actualMatchIdBytes = result.slice(1, 1 + expectedMatchIdBytes.length);
    expect(Buffer.from(actualMatchIdBytes)).toEqual(
      Buffer.from(expectedMatchIdBytes)
    );
  });

  it("encodes filter field correctly in Field 2 with tag 0x10", () => {
    const matchId = "905675290968064";
    const marketGroup = 5;

    const result = buildMatchDetailsRequestWithFilter(matchId, marketGroup);

    const matchIdBytes = encodeBigVarint(BigInt(matchId));
    const field2Offset = 1 + matchIdBytes.length;

    expect(result[field2Offset]).toBe(0x10);

    const expectedFilterBytes = encodeVarint(marketGroup);
    const actualFilterBytes = result.slice(
      field2Offset + 1,
      field2Offset + 1 + expectedFilterBytes.length
    );
    expect(Buffer.from(actualFilterBytes)).toEqual(
      Buffer.from(expectedFilterBytes)
    );
  });

  it("correctly encodes all market group filter values", () => {
    const matchId = "905675290968064";

    for (const [groupName, filterValue] of Object.entries(MARKET_GROUP_FILTERS)) {
      const result = buildMatchDetailsRequestWithFilter(matchId, filterValue);

      const matchIdBytes = encodeBigVarint(BigInt(matchId));
      const field2Offset = 1 + matchIdBytes.length;

      expect(result[field2Offset]).toBe(0x10);

      const expectedFilterBytes = encodeVarint(filterValue);
      const actualFilterBytes = result.slice(
        field2Offset + 1,
        field2Offset + 1 + expectedFilterBytes.length
      );
      expect(Buffer.from(actualFilterBytes)).toEqual(
        Buffer.from(expectedFilterBytes)
      );
    }
  });

  it("produces complete request with both fields in correct order", () => {
    const matchId = "123456789";
    const marketGroup = 3;

    const result = buildMatchDetailsRequestWithFilter(matchId, marketGroup);

    const matchIdBytes = encodeBigVarint(BigInt(matchId));
    const filterBytes = encodeVarint(marketGroup);

    const expectedLength = 1 + matchIdBytes.length + 1 + filterBytes.length;
    expect(result.length).toBe(expectedLength);

    expect(result[0]).toBe(0x08);
    expect(Buffer.from(result.slice(1, 1 + matchIdBytes.length))).toEqual(
      Buffer.from(matchIdBytes)
    );
    expect(result[1 + matchIdBytes.length]).toBe(0x10);
    expect(Buffer.from(result.slice(1 + matchIdBytes.length + 1))).toEqual(
      Buffer.from(filterBytes)
    );
  });

  it("returns a Buffer object", () => {
    const result = buildMatchDetailsRequestWithFilter("123", 0);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it("handles zero market group value", () => {
    const matchId = "905675290968064";
    const marketGroup = 0;

    const result = buildMatchDetailsRequestWithFilter(matchId, marketGroup);

    expect(result[0]).toBe(0x08);

    const matchIdBytes = encodeBigVarint(BigInt(matchId));
    const field2Offset = 1 + matchIdBytes.length;

    expect(result[field2Offset]).toBe(0x10);
    expect(result[field2Offset + 1]).toBe(0x00);
  });
});

describe("fetchAllMarketGroups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses MARKET_GROUP_FILTERS to iterate over filter values", async () => {
    const matchId = "905675290968064";
    const filterCount = Object.keys(MARKET_GROUP_FILTERS).length;
    const capturedRequests: Array<{url: string; body: Buffer}> = [];

    vi.spyOn(await import("../navigation.js"), "fetchGrpcStream").mockImplementation(async (url, body) => {
      capturedRequests.push({ url, body });
      return Buffer.alloc(200);
    });

    await fetchAllMarketGroups(matchId);

    expect(capturedRequests.length).toBe(filterCount);

    capturedRequests.forEach((req, i) => {
      const [url, body] = [req.url, req.body];
      expect(url).toBe(
        "https://offering.begmedia.com/web/offering.access.api/offering.access.api.MatchService/GetMatchWithNotification"
      );
      expect(Buffer.isBuffer(body)).toBe(true);
      expect(body[0]).toBe(0x08);
    });
  });

  it("calls fetchGrpcStream with correct URL for each filter", async () => {
    const matchId = "905675290968064";
    const capturedUrls: string[] = [];

    vi.spyOn(await import("../navigation.js"), "fetchGrpcStream").mockImplementation(async (url) => {
      capturedUrls.push(url);
      return Buffer.alloc(200);
    });

    await fetchAllMarketGroups(matchId);

    expect(capturedUrls.length).toBe(Object.keys(MARKET_GROUP_FILTERS).length);
    expect(capturedUrls.every(url => url === "https://offering.begmedia.com/web/offering.access.api/offering.access.api.MatchService/GetMatchWithNotification")).toBe(true);
  });

  it("filters out responses smaller than 100 bytes", async () => {
    const matchId = "905675290968064";

    vi.spyOn(await import("../navigation.js"), "fetchGrpcStream").mockResolvedValue(Buffer.alloc(50));

    const results = await fetchAllMarketGroups(matchId);

    expect(results.length).toBe(0);
    expect(results).toEqual([]);
  });

  it("returns array of Buffer objects", async () => {
    const matchId = "905675290968064";

    vi.spyOn(await import("../navigation.js"), "fetchGrpcStream").mockResolvedValue(Buffer.alloc(200));

    const results = await fetchAllMarketGroups(matchId);

    results.forEach((response) => {
      expect(Buffer.isBuffer(response)).toBe(true);
    });
  });

  it("returns correct number of valid responses", async () => {
    const matchId = "905675290968064";

    vi.spyOn(await import("../navigation.js"), "fetchGrpcStream").mockResolvedValue(Buffer.alloc(200));

    const results = await fetchAllMarketGroups(matchId);

    expect(results.length).toBe(Object.keys(MARKET_GROUP_FILTERS).length);
  });
});
