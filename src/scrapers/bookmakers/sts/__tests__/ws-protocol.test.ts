import { describe, it, expect } from "vitest";
import { DEFAULT_USER_AGENT } from "../../../shared/http/http-client.js";
import { hasFixtureSnapshot } from "../navigation.js";
import {
  STS_WS_URL,
  STS_WS_HEADERS,
  STS_WS_CONNECT_TIMEOUT_MS,
  STS_IPL_TIMEOUT_MS,
  STS_SNAPSHOT_TIMEOUT_MS,
  STS_SNAPSHOT_MISS_LIMIT,
  STS_SYNC_MESSAGE,
  STS_FALLBACK_HINT,
  fixtureTopic,
  buildStsSubscription,
  emptyStsCapture,
  reduceStsFrame,
  hasIplSnapshot,
  missingSnapshots,
  shouldTripStsBreaker,
  classifyStsWsFailure,
} from "../ws-protocol.js";
import { WS_IDS, readStsFixture, wsIplFrame, wsSnapshotFrame } from "./helpers/sts-frames.js";

const URL = "wss://www.sts.pl/sbk/api/sbk";

describe("sts websocket protocol", () => {
  it("endpoint constants", () => {
    expect(STS_WS_URL).toBe(URL);
    expect(STS_WS_HEADERS).toEqual({
      origin: "https://www.sts.pl", "user-agent": DEFAULT_USER_AGENT, "accept-language": "pl-PL,pl;q=0.9",
    });
    expect(STS_WS_HEADERS["user-agent"]).toBe(DEFAULT_USER_AGENT);
    expect([STS_WS_CONNECT_TIMEOUT_MS, STS_IPL_TIMEOUT_MS, STS_SNAPSHOT_TIMEOUT_MS, STS_SNAPSHOT_MISS_LIMIT])
      .toEqual([10_000, 10_000, 5_000, 3]);
    expect(STS_FALLBACK_HINT).toBe("set SCRAPER_TRANSPORT_STS=browser to use the browser path");
  });

  it("listing request is the browser's first frame", () => {
    expect(buildStsSubscription([{ topic: "i_pl", snapshot: true }])).toBe('{"t":1,"u":[{"s":"i_pl","n":0}]}');
  });

  it("snapshot requests carry n:0, kept topics none, order kept", () => {
    expect(buildStsSubscription([
      { topic: "i_pl", snapshot: false },
      { topic: fixtureTopic("f2921896"), snapshot: true },
      { topic: fixtureTopic("f2921905"), snapshot: false },
    ])).toBe('{"t":1,"u":[{"s":"i_pl"},{"s":"f_f2921896_pl","n":0},{"s":"f_f2921905_pl"}]}');
  });

  it("sync message", () => expect(STS_SYNC_MESSAGE).toBe('{"t":4}'));

  it("reduceStsFrame ignores binary frames and returns the same state", () => {
    const s = emptyStsCapture();
    const frame = Buffer.from(wsSnapshotFrame("f2921905"));
    expect(reduceStsFrame(s, frame, true)).toBe(s);
    expect(hasFixtureSnapshot(s, "f2921905")).toBe(false);
    expect(reduceStsFrame(s, frame, false)).toBe(s);
    expect(hasFixtureSnapshot(s, "f2921905")).toBe(true);
  });

  it("reduceStsFrame ignores control frames", () => {
    expect(reduceStsFrame(emptyStsCapture(), Buffer.from('{"t":5}'), false)).toEqual(emptyStsCapture());
  });

  it("hasIplSnapshot", () => {
    const s = emptyStsCapture();
    expect(hasIplSnapshot(s)).toBe(false);
    reduceStsFrame(s, Buffer.from(readStsFixture("ws-2026-11-07/i_pl.delta.txt")), false);
    expect(hasIplSnapshot(s)).toBe(false);
    reduceStsFrame(s, Buffer.from(wsIplFrame()), false);
    expect(hasIplSnapshot(s)).toBe(true);
  });

  it("missingSnapshots keeps listing order", () => {
    const s = reduceStsFrame(emptyStsCapture(), Buffer.from(wsSnapshotFrame("f2921905")), false);
    expect(missingSnapshots(s, WS_IDS)).toEqual(["f2921896", "f2921906", "f2921911"]);
  });

  it.each([
    [0, 20, false], [2, 20, false], [3, 20, true], [1, 2, false], [2, 3, true], [1, 1, true],
  ])("shouldTripStsBreaker(%i, %i) = %s", (missing, requested, expected) => {
    expect(shouldTripStsBreaker(missing, requested)).toBe(expected);
  });

  it.each([
    [`ws handshake HTTP 403 ${URL}`, "blocked"],
    [`ws handshake HTTP 503 ${URL}`, "blocked"],
    [`ws handshake HTTP 429 ${URL}`, "blocked"],
    [`ws closed 1008 ${URL}`, "blocked"],
    [`no i_pl snapshot | ws timeout 10000ms ${URL}`, "protocol"],
    [`3 of 4 details failed | ws timeout 5000ms ${URL}`, "protocol"],
    [`ws handshake HTTP 502 ${URL}`, "transient"],
    [`ws closed 1006 ${URL}`, "transient"],
    [`ws timeout 10000ms ${URL}`, "transient"],
    [`ws failed ECONNRESET ${URL}`, "transient"],
    ["scrape budget of 120000ms exceeded", "transient"],
    ["Unknown league: bundesliga", "transient"],
    ["No fixtures found for league", "transient"],
  ])("classifyStsWsFailure(%s) = %s", (message, kind) => {
    expect(classifyStsWsFailure(message)).toBe(kind);
  });
});
