import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  decodeFrame,
  initialStatesOf,
  subscribedGroupIds,
  FrameAssembler,
  SingleEventAccumulator,
  describeCaptureFailure,
  emptyDiagnostics,
  isEmptyListing,
} from "../ws-protocol.js";
import { WEBSOCKET_URL_PATTERN } from "../constants.js";
import { parseAllMarkets, parseTeamNames } from "../parser.js";
import type { PZBukInitialState } from "../types.js";

const load = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const league = load("ws-league-frames.json");
const event = load("ws-event-frames.json");
const group1 = event.frames.find((f: any) => f.dir === "recv" && f.text.startsWith('{"type":"DATA","streamId":5,')).text;

describe("pzbuk ws transport", () => {
  it("matches the captured sportsbook socket URL", () => {
    expect(league.socketUrl).toBe("wss://www.pzbuk.pl/sportsbook-api/ws?franchiseCode=POLAND_PZBUK&locale=pl");
    expect(league.socketUrl.includes(WEBSOCKET_URL_PATTERN)).toBe(true);
    // The legacy RSocket path ("/websocket") does not contain "sportsbook-api/ws": a transport
    // rollback to it captures no frames, so the scrape fails instead of returning data.
    expect("wss://www.pzbuk.pl/sportsbook-api/websocket".includes(WEBSOCKET_URL_PATTERN)).toBe(false);
  });
  it("reads chunkSize from the SETUP frame", () => {
    expect(decodeFrame(league.frames[0].text)).toEqual({ kind: "setup", chunkSize: 1048576 });
  });
  it("unwraps the DATA envelope into INITIAL_STATE messages", () => {
    const f = decodeFrame(league.frames[2].text);
    if (f.kind !== "data") throw new Error(f.kind);
    expect(f.streamId).toBe(1);
    expect(f.messages.map((m) => m.type)).toEqual(["INITIAL_STATE"]);
    const [state] = initialStatesOf(f);
    expect(state.events.map((e) => e.id)).toEqual([4408475, 4408509, 4408525]);
    expect(state.selections).toHaveLength(18);
  });
  it("keeps delta messages but yields no INITIAL_STATE for them", () => {
    // Synthetic: the 17:56 live capture recorded only the 60-char head of SELECTION_DELTA / EVENT_DELTA frames.
    const f = decodeFrame('{"type":"DATA","streamId":1,"payload":[{"type":"SELECTION_DELTA","payload":{"id":1,"trueOdds":1.7}}]}');
    expect(f).toMatchObject({ kind: "data", streamId: 1, messages: [{ type: "SELECTION_DELTA" }] });
    expect(initialStatesOf(f)).toEqual([]);
  });
  it("classifies CLOSE and ERROR as control frames with their message", () => {
    expect(decodeFrame('{"type":"CLOSE","streamId":7,"reason":"NORMAL","message":null}')).toEqual({ kind: "control", type: "CLOSE", message: null });
    // Synthetic shape: no server ERROR frame has been observed.
    expect(decodeFrame('{"type":"ERROR","streamId":1,"message":"Unknown route"}')).toEqual({ kind: "control", type: "ERROR", message: "Unknown route" });
  });
  it("reads subscribed market-group ids from sent SUBSCRIBE frames", () => {
    const sent: number[][] = event.frames.filter((f: any) => f.dir === "sent").map((f: any) => subscribedGroupIds(f.text));
    expect(sent.find((ids) => ids.length > 0)).toEqual([1]); // stream 5, sent at page load (default-open "Popularne")
    expect(sent.flat().sort((a, b) => a - b)).toEqual([1, 2, 7, 8, 12, 13, 15, 17, 19, 28]);
    expect(subscribedGroupIds('{"type":"CLOSE","streamId":5,"reason":"NORMAL","message":null}')).toEqual([]);
  });
  it("still decodes a legacy RSocket frame (binary header + bare array)", () => {
    const legacy = "\u0000\u0000\u0000\u0001\u0010" + JSON.stringify([{ type: "INITIAL_STATE", payload: { events: [], markets: [], selections: [] } }]);
    expect(decodeFrame(legacy)).toMatchObject({ kind: "data", streamId: null, messages: [{ type: "INITIAL_STATE" }] });
  });
  it("reports truncated JSON as invalid instead of throwing", () => {
    expect(decodeFrame(league.frames[2].text.slice(0, 1000)).kind).toBe("invalid");
    expect(decodeFrame("garbage").kind).toBe("invalid");
  });
  it("rejects a whole frame whose INITIAL_STATE has a non-object entry (fail closed)", () => {
    const data = (state: string) => `{"type":"DATA","streamId":5,"payload":[{"type":"INITIAL_STATE","payload":${state}}]}`;
    expect(decodeFrame(data('{"events":[null],"markets":[],"selections":[]}')))
      .toEqual({ kind: "invalid", error: "INITIAL_STATE events[0] is not an object" });
    expect(decodeFrame(data('{"events":[{"id":1}],"markets":[{"id":"m1"},7],"selections":[null]}')))
      .toEqual({ kind: "invalid", error: "INITIAL_STATE markets[1] is not an object" });
    expect(decodeFrame('[{"type":"INITIAL_STATE","payload":{"events":[{"id":1}],"markets":[],"selections":[[]]}}]'))
      .toEqual({ kind: "invalid", error: "INITIAL_STATE selections[0] is not an object" });
    // Delta messages are not snapshots and pass through unchecked, as before.
    expect(decodeFrame('{"type":"DATA","streamId":1,"payload":[{"type":"SELECTION_DELTA","payload":[null]}]}').kind).toBe("data");
  });
});

describe("pzbuk FrameAssembler", () => {
  const split = (bytes: Buffer, size: number) => {
    const out: Buffer[] = [];
    for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size));
    return out;
  };
  it("passes frames through while chunking is disabled", () => {
    expect(new FrameAssembler().push(Buffer.from(group1))).toBe(group1);
  });
  it("reassembles a frame split into chunkSize-byte chunks", () => {
    const a = new FrameAssembler();
    a.setChunkSize(32768);
    const parts = split(Buffer.from(group1), 32768);
    expect(parts.at(-1)!.length).toBeLessThan(32768);
    const results = parts.map((p) => a.push(p));
    expect(results.slice(0, -1).every((r) => r === null)).toBe(true);
    expect(results.at(-1)).toBe(group1);
    expect(initialStatesOf(decodeFrame(results.at(-1)!))[0].markets).toHaveLength(28);
  });
  it("reassembles when a chunk boundary splits a multi-byte character", () => {
    const bytes = Buffer.from(group1);
    const size = bytes.indexOf(Buffer.from("ł")) + 1; // first chunk ends mid-"ł"
    const a = new FrameAssembler();
    a.setChunkSize(size);
    const results = split(bytes, size).map((p) => a.push(p));
    expect(results.at(-1)).toBe(group1);
  });
});

const states = (frames: any[], skipStream?: number) => frames.filter((f) => f.dir === "recv").flatMap((f) => {
  const d = decodeFrame(f.text);
  return d.kind === "data" && d.streamId !== skipStream ? initialStatesOf(d) : [];
});
const GROUPS = [1, 2, 7, 8, 12, 13, 15, 17, 19, 28];

describe("pzbuk SingleEventAccumulator", () => {
  it("unions markets and selections across all market-group messages", () => {
    const acc = new SingleEventAccumulator();
    states(event.frames).forEach((s) => acc.add(s));
    const snap = acc.snapshot()!;
    expect(snap.events[0].id).toBe(4408475);
    expect(acc.stats()).toEqual({ selections: 656, markets: 157, marketGroupsDeclared: GROUPS, marketGroupsSeen: GROUPS });
  });
  it("ignores multi-event listing messages on the event page", () => {
    const acc = new SingleEventAccumulator();
    const listing = states(event.frames).find((s) => s.events.length === 3 && s.selections.length === 18)!;
    expect(acc.add(listing)).toBe(false);
    expect(acc.snapshot()).toBeNull();
  });
  it("reports a market group that never answered", () => {
    const acc = new SingleEventAccumulator();
    states(event.frames, 11).forEach((s) => acc.add(s)); // stream 11 = group 28 "Zawodnicy"
    expect(acc.stats().marketGroupsSeen).toEqual([1, 2, 7, 8, 12, 13, 15, 17, 19]);
    expect(acc.snapshot()).not.toBeNull();
  });
  it("rejects single-event payloads for another event", () => {
    const acc = new SingleEventAccumulator(4408509);
    expect(states(event.frames).map((s) => acc.add(s)).some(Boolean)).toBe(false);
    expect(acc.snapshot()).toBeNull();
  });
  it("keeps only the latest Active copy of a selection (no stale price)", () => {
    // Synthetic: no fixture selection changes price or status between streams.
    const ev = states(event.frames).find((s) => s.events.length === 1)!.events[0];
    const sel = { id: "s1", name: "x", trueOdds: 1.8, marketId: "m1", marketTypeId: "1", eventId: ev.id, outcomeType: "Home", status: "Active", order: 0 };
    const acc = new SingleEventAccumulator(ev.id);
    acc.add({ events: [ev], markets: [], selections: [sel] });
    acc.add({ events: [ev], markets: [], selections: [{ ...sel, trueOdds: 1.85 }] });
    expect(acc.snapshot()!.selections.map((s) => s.trueOdds)).toEqual([1.85]);
    acc.add({ events: [ev], markets: [], selections: [{ ...sel, status: "Suspended" }] });
    expect(acc.stats().selections).toBe(0);
    expect(acc.snapshot()).toBeNull();
  });
  it("rejects a payload with a non-object entry without throwing or merging any of it", () => {
    const acc = new SingleEventAccumulator(1);
    const malformed = { events: [{ id: 1 }], markets: [null], selections: [null] } as unknown as PZBukInitialState;
    expect(() => acc.add(malformed)).not.toThrow();
    expect(acc.add(malformed)).toBe(false);
    expect(acc.add({ events: [null], markets: [], selections: [] } as unknown as PZBukInitialState)).toBe(false);
    expect(acc.snapshot()).toBeNull();
    expect(acc.stats()).toEqual({ selections: 0, markets: 0, marketGroupsDeclared: [], marketGroupsSeen: [] });
  });
  it("maps header texts to market-group ids", () => {
    const acc = new SingleEventAccumulator(4408475);
    states(event.frames).forEach((s) => acc.add(s));
    // marketGroups["2"].name is "Gole " (trailing space) on the wire
    expect(["Popularne", "Gole", "1 połowa", "Nieznane"].map((t) => acc.groupIdForHeader(t))).toEqual([1, 2, 7, null]);
  });
  it("feeds parseAllMarkets real API names (no placeholders) and raw selection labels", () => {
    const acc = new SingleEventAccumulator();
    states(event.frames).forEach((s) => acc.add(s));
    const snap = acc.snapshot()!;
    const markets = parseAllMarkets(snap, snap.events[0].id, parseTeamNames(snap.events[0]));
    expect(markets).toHaveLength(147);
    expect(markets.filter((m) => /^Rynek \d+$/.test(m.name))).toEqual([]);
    expect(markets.find((m) => m.bookmakerMarketId === "167" && m.paramValue === "4.5")?.name).toBe("1. Połowa - Suma rzutów rożnych");
    const x12 = markets.find((m) => m.bookmakerMarketId === "1")!;
    expect([x12.name, x12.selections.map((s) => [s.name, s.odds])]).toEqual(["1x2", [["Everton FC", 1.66], ["Remis", 3.92], ["Coventry City", 4.91]]]);
    expect(markets.find((m) => m.bookmakerMarketId === "10")!.selections.map((s) => s.name))
      .toEqual(["Everton FC lub remis", "Everton FC lub Coventry City", "remis lub Coventry City"]);
  });
});

describe("pzbuk describeCaptureFailure", () => {
  const WS = "wss://www.pzbuk.pl/sportsbook-api/ws?franchiseCode=POLAND_PZBUK&locale=pl";
  it("names the sockets when none matched", () => {
    expect(describeCaptureFailure(emptyDiagnostics())).toBe('no socket matched "sportsbook-api/ws" (sockets seen: none)');
  });
  it("names the decode error when the socket matched", () => {
    expect(describeCaptureFailure({ ...emptyDiagnostics(), socketUrls: [WS], matchedSockets: 1, framesReceived: 2, invalidFrames: 1,
      lastInvalidError: "Unexpected non-whitespace character after JSON at position 233949" }))
      .toBe("socket matched but no INITIAL_STATE decoded (frames: 2, invalid: 1, last error: Unexpected non-whitespace character after JSON at position 233949)");
  });
  it("reports INITIAL_STATE without a usable snapshot", () => {
    expect(describeCaptureFailure({ ...emptyDiagnostics(), socketUrls: [WS], matchedSockets: 1, framesReceived: 3, initialStates: 2, maxEvents: 20 }))
      .toBe("2 INITIAL_STATE message(s) but no usable snapshot (max events per message: 20, frames: 3)");
  });
  it("reports an empty listing", () => {
    const d = { ...emptyDiagnostics(), socketUrls: [WS], matchedSockets: 1, framesReceived: 2, initialStates: 1, maxEvents: 0 };
    expect([isEmptyListing(d), isEmptyListing(emptyDiagnostics())]).toEqual([true, false]);
    expect(describeCaptureFailure(d)).toBe("listing is empty (1 INITIAL_STATE message(s) with 0 events, frames: 2)");
  });
  it("names the last server control frame", () => {
    expect(describeCaptureFailure({ ...emptyDiagnostics(), socketUrls: [WS], matchedSockets: 1, framesReceived: 2,
      lastControl: { type: "ERROR", message: "Unknown route" } }))
      .toBe("socket matched but no INITIAL_STATE decoded (frames: 2, invalid: 0, last control: ERROR Unknown route)");
  });
});
