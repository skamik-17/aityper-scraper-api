import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { decodeFrame, initialStatesOf, subscribedGroupIds, FrameAssembler } from "../ws-protocol.js";
import { WEBSOCKET_URL_PATTERN } from "../constants.js";

const load = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const league = load("ws-league-frames.json");
const event = load("ws-event-frames.json");
const group1 = event.frames.find((f: any) => f.dir === "recv" && f.text.startsWith('{"type":"DATA","streamId":5,')).text;

describe("pzbuk ws transport", () => {
  it("matches the captured sportsbook socket URL", () => {
    expect(league.socketUrl).toBe("wss://www.pzbuk.pl/sportsbook-api/ws?franchiseCode=POLAND_PZBUK&locale=pl");
    expect(league.socketUrl.includes(WEBSOCKET_URL_PATTERN)).toBe(true);
    // The legacy RSocket path ("/websocket") does not contain "sportsbook-api/ws": a transport
    // rollback surfaces as a concrete "no socket matched" capture failure, never as silent data.
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
