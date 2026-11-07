import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureWebSocketData } from "../navigation.js";
import { describeCaptureFailure, isEmptyListing, SingleEventAccumulator } from "../ws-protocol.js";

const load = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const league = load("ws-league-frames.json");
const event = load("ws-event-frames.json");
const fakePage = () => new EventEmitter() as unknown as Page & EventEmitter;
const fakeSocket = (url: string) => Object.assign(new EventEmitter(), { url: () => url });
const replay = (ws: EventEmitter, frames: any[]) => frames.filter((f) => f.dir === "recv").forEach((f) => ws.emit("framereceived", { payload: Buffer.from(f.text) }));
const recv = (ws: EventEmitter, text: string) => ws.emit("framereceived", { payload: Buffer.from(text) });

describe("pzbuk captureWebSocketData", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("captures the league snapshot from the new socket and detaches", async () => {
    const page = fakePage();
    const p = captureWebSocketData(page, false);
    const ws = fakeSocket(league.socketUrl); page.emit("websocket", ws); replay(ws, league.frames);
    await vi.advanceTimersByTimeAsync(1500);
    const r = await p;
    expect([r.state?.events.length, r.state?.selections.length]).toEqual([3, 18]);
    expect(r.diagnostics).toMatchObject({ matchedSockets: 1, framesReceived: 2, invalidFrames: 0, initialStates: 1, maxEvents: 3 });
    expect(page.listenerCount("websocket")).toBe(0);
  });
  it("accepts a one-event listing", async () => {
    const env = JSON.parse(league.frames[2].text);
    const st = env.payload[0].payload;
    st.events = st.events.slice(0, 1);
    st.markets = st.markets.filter((m: any) => m.eventId === 4408475);
    st.selections = st.selections.filter((s: any) => s.eventId === 4408475);
    const page = fakePage();
    const p = captureWebSocketData(page, false);
    const ws = fakeSocket(league.socketUrl); page.emit("websocket", ws); recv(ws, JSON.stringify(env));
    await vi.advanceTimersByTimeAsync(1500);
    const r = await p;
    expect([r.state?.events.length, r.state?.selections.length]).toEqual([1, 6]);
  });
  it("treats a 0-event listing as empty, not as a failure", async () => {
    const page = fakePage();
    const p = captureWebSocketData(page, false);
    const ws = fakeSocket(league.socketUrl); page.emit("websocket", ws);
    recv(ws, '{"type":"DATA","streamId":1,"payload":[{"type":"INITIAL_STATE","payload":{"events":[],"markets":[],"selections":[]}}]}');
    await vi.advanceTimersByTimeAsync(1500); // resolves after WS_MIN_WAIT, not at WS_MAX_WAIT
    const r = await p;
    expect(r.state).toBeNull();
    expect(isEmptyListing(r.diagnostics)).toBe(true);
  });
  it("accumulates the event offer across market-group streams", async () => {
    const page = fakePage();
    const p = captureWebSocketData(page, true, 4408475);
    const ws = fakeSocket(event.socketUrl); page.emit("websocket", ws); replay(ws, event.frames);
    await vi.advanceTimersByTimeAsync(26_000);
    const r = await p;
    expect([r.state?.markets.length, r.state?.selections.length]).toEqual([157, 656]);
    expect(r.diagnostics.groups).toEqual({ declared: [1, 2, 7, 8, 12, 13, 15, 17, 19, 28], seen: [1, 2, 7, 8, 12, 13, 15, 17, 19, 28] });
  });
  it("counts chunked frames and the largest reassembled frame", async () => {
    // Synthetic chunking: no live frame has reached the announced 1048576 B yet.
    const group1 = Buffer.from(event.frames.find((f: any) => f.dir === "recv" && f.text.startsWith('{"type":"DATA","streamId":5,')).text);
    const page = fakePage();
    const p = captureWebSocketData(page, true, 4408475);
    const ws = fakeSocket(event.socketUrl); page.emit("websocket", ws);
    recv(ws, '{"type":"SETUP","chunkSize":32768}');
    for (let i = 0; i < group1.length; i += 32768) ws.emit("framereceived", { payload: group1.subarray(i, i + 32768) }); // 32768, 32768, 16671 B
    await vi.advanceTimersByTimeAsync(26_000);
    const r = await p;
    expect([r.state?.markets.length, r.state?.selections.length]).toEqual([28, 169]);
    expect(r.diagnostics).toMatchObject({ framesReceived: 4, invalidFrames: 0, chunkedFrames: 2, maxFrameBytes: 82207, initialStates: 1 });
  });
  it("single-event mode resolves at WS_MAX_WAIT with no frames", async () => {
    const page = fakePage();
    const p = captureWebSocketData(page, true);
    await vi.advanceTimersByTimeAsync(25_500);
    const r = await p;
    expect(r.state).toBeNull();
    expect(describeCaptureFailure(r.diagnostics)).toBe('no socket matched "sportsbook-api/ws" (sockets seen: none)');
    expect(page.listenerCount("websocket")).toBe(0);
  });
  it("names the unmatched socket when the URL pattern drifts", async () => {
    const page = fakePage();
    const p = captureWebSocketData(page, false);
    page.emit("websocket", fakeSocket("wss://www.pzbuk.pl/sportsbook-api/v3/stream"));
    await vi.advanceTimersByTimeAsync(25_500);
    const r = await p;
    expect(r.state).toBeNull();
    expect(describeCaptureFailure(r.diagnostics)).toBe('no socket matched "sportsbook-api/ws" (sockets seen: wss://www.pzbuk.pl/sportsbook-api/v3/stream)');
  });
  it("reports undecodable frames on a matched socket", async () => {
    const page = fakePage();
    const p = captureWebSocketData(page, false);
    const ws = fakeSocket(league.socketUrl); page.emit("websocket", ws);
    recv(ws, league.frames[2].text.slice(0, 1000));
    await vi.advanceTimersByTimeAsync(25_500);
    expect(describeCaptureFailure((await p).diagnostics)).toMatch(/^socket matched but no INITIAL_STATE decoded \(frames: 1, invalid: 1, last error: /);
  });
  it("records a server control frame", async () => {
    const page = fakePage();
    const p = captureWebSocketData(page, false);
    const ws = fakeSocket(league.socketUrl); page.emit("websocket", ws);
    recv(ws, '{"type":"ERROR","streamId":1,"message":"Unknown route"}'); // synthetic shape
    await vi.advanceTimersByTimeAsync(25_500);
    expect(describeCaptureFailure((await p).diagnostics)).toBe("socket matched but no INITIAL_STATE decoded (frames: 1, invalid: 0, last control: ERROR Unknown route)");
  });

  // Playwright runs frame listeners outside any promise chain, so a throw in one
  // is an uncaughtException that ends the whole service. The fake socket's emit()
  // rethrows it synchronously instead, which is what `not.toThrow()` checks.
  const group1Frame = () => event.frames.find((f: any) => f.dir === "recv" && f.text.startsWith('{"type":"DATA","streamId":5,')).text;
  it.each([
    ['{"events":[null],"markets":[],"selections":[]}', "events[0]"],
    ['{"events":[{"id":4408475}],"markets":[null],"selections":[null]}', "markets[0]"],
  ])("drops a single-event INITIAL_STATE with a non-object entry and keeps capturing: %s", async (payload, entry) => {
    const page = fakePage();
    const p = captureWebSocketData(page, true, 4408475);
    const ws = fakeSocket(event.socketUrl); page.emit("websocket", ws);
    expect(() => recv(ws, `{"type":"DATA","streamId":5,"payload":[{"type":"INITIAL_STATE","payload":${payload}}]}`)).not.toThrow();
    recv(ws, group1Frame());
    await vi.advanceTimersByTimeAsync(26_000);
    const r = await p;
    expect([r.state?.markets.length, r.state?.selections.length]).toEqual([28, 169]);
    expect(r.diagnostics).toMatchObject({ framesReceived: 2, invalidFrames: 1, lastInvalidError: `INITIAL_STATE ${entry} is not an object`, initialStates: 1 });
  });
  it("reports a dropped single-event frame as the capture failure", async () => {
    const page = fakePage();
    const p = captureWebSocketData(page, true, 4408475);
    const ws = fakeSocket(event.socketUrl); page.emit("websocket", ws);
    recv(ws, '{"type":"DATA","streamId":5,"payload":[{"type":"INITIAL_STATE","payload":{"events":[null],"markets":[],"selections":[]}}]}');
    await vi.advanceTimersByTimeAsync(26_000);
    const r = await p;
    expect(r.state).toBeNull();
    expect(describeCaptureFailure(r.diagnostics)).toBe("socket matched but no INITIAL_STATE decoded (frames: 1, invalid: 1, last error: INITIAL_STATE events[0] is not an object)");
  });
  it("rejects a listing INITIAL_STATE with a non-object entry instead of resolving with it", async () => {
    const env = JSON.parse(league.frames[2].text);
    env.payload[0].payload.selections.push(null);
    const page = fakePage();
    const p = captureWebSocketData(page, false);
    const ws = fakeSocket(league.socketUrl); page.emit("websocket", ws);
    expect(() => recv(ws, JSON.stringify(env))).not.toThrow();
    await vi.advanceTimersByTimeAsync(25_500);
    const r = await p;
    expect(r.state).toBeNull();
    expect(describeCaptureFailure(r.diagnostics)).toBe("socket matched but no INITIAL_STATE decoded (frames: 1, invalid: 1, last error: INITIAL_STATE selections[18] is not an object)");
  });
  it("contains an unexpected throw in the frame handler, counts the frame invalid and keeps capturing", async () => {
    vi.spyOn(SingleEventAccumulator.prototype, "add").mockImplementationOnce(() => {
      throw new TypeError("Cannot read properties of null (reading 'status')");
    });
    const page = fakePage();
    const p = captureWebSocketData(page, true, 4408475);
    const ws = fakeSocket(event.socketUrl); page.emit("websocket", ws);
    expect(() => recv(ws, group1Frame())).not.toThrow();
    recv(ws, group1Frame()); // the next frame is still processed
    await vi.advanceTimersByTimeAsync(26_000);
    const r = await p;
    expect([r.state?.markets.length, r.state?.selections.length]).toEqual([28, 169]);
    expect(r.diagnostics).toMatchObject({ framesReceived: 2, invalidFrames: 1, lastInvalidError: "Cannot read properties of null (reading 'status')" });
  });
});
