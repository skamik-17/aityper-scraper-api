import { initialDirectState, reduceDirectFrame, isDirectSessionDone, offerFor, coverageFor, describeDirectState, PZBUK_WS_URL } from "../ws-direct.js";
import { describeCoverage } from "../offer-coverage.js";
import { fx, wire, chunk, listingMessage, offerMessage, SETUP_32K } from "./helpers/direct-fixture.js";

const SETUP = wire(fx.messages[0]);
const LISTING_SUB = '{"type":"SUBSCRIBE","streamId":1,"route":"events","version":1,"payload":{"filters":{"sportIds":[1],"leagueIds":[134],"eventTypes":["Fixture"],"marketTypeFilters":[],"isLive":false},"orders":[2,5]}}';
const CLOSE_1 = '{"type":"CLOSE","streamId":1,"reason":"NORMAL","message":null}';
const offerSub = (ids: number[]) => `{"type":"SUBSCRIBE","streamId":3,"route":"events","version":1,"payload":{"filters":{"eventIds":[${ids.join(",")}],"includeEntities":["MARKET","SELECTION"]}}}`;
const run = (frames: Buffer[]) => {
  const sent: string[] = []; const done: boolean[] = []; let s = initialDirectState();
  for (const f of frames) { s = reduceDirectFrame(s, f, 134, (d) => sent.push(d)); done.push(isDirectSessionDone(s)); }
  return { s, sent, done };
};

describe("pzbuk direct session reducer", () => {
  it("subscribes the league listing with the site's own sidebar filter after SETUP", () =>
    expect(run([SETUP]).sent).toEqual([LISTING_SUB]));
  it("closes the listing stream and subscribes the offer for every target event", () => {
    const { s, sent, done } = run([SETUP, wire(listingMessage())]);
    expect(sent).toEqual([LISTING_SUB, CLOSE_1, offerSub([4408475, 4408509, 4408525])]);
    expect([s.targetIds, done.at(-1)]).toEqual([[4408475, 4408509, 4408525], false]);
    expect(s.diagnostics).toMatchObject({ socketUrls: [PZBUK_WS_URL], matchedSockets: 1, initialStates: 1, maxEvents: 3 });
  });
  it("reassembles 32 KiB chunks and is done on the last offer chunk", () => {
    const offerChunks = chunk(wire(offerMessage()), 32768);
    const { s, done } = run([SETUP_32K, ...chunk(wire(listingMessage([4408475])), 32768), ...offerChunks]);
    expect(offerChunks.map((c) => c.length)).toEqual([32768, 32768, 32768, 11284]);
    expect(done).toEqual([false, false, false, false, false, true]);
    expect([offerFor(s, 4408475).markets.length, offerFor(s, 4408475).selections.length]).toEqual([45, 222]);
    expect([s.diagnostics.framesReceived, s.diagnostics.chunkedFrames, s.diagnostics.maxFrameBytes]).toEqual([6, 3, 109588]);
  });
  it("never completes while a listed event is missing from the offer", () => {
    const { s, done } = run([SETUP, wire(listingMessage()), wire(offerMessage())]);
    expect(done.at(-1)).toBe(false);
    expect(describeCoverage(coverageFor(s, 4408509))).toBe("groups 0/10, markets counted 0/235");
    expect(offerFor(s, 4408509)).toMatchObject({ markets: [], selections: [] });
  });
  it("prefers the offer event's marketGroups over the listing's", () => {
    const listing = listingMessage([4408475]); // the listing copy alone also declares Gole (24)
    listing.payload[0].payload.events[0].marketGroups["2"] = { id: 2, name: "Gole ", order: 5, marketsCount: 24 };
    expect(run([SETUP, wire(listing), wire(offerMessage())]).done.at(-1)).toBe(true);
  });
  it("does not target an event that declares no market groups", () => {
    const listing = listingMessage([4408475, 4408509]); listing.payload[0].payload.events[1].marketGroups = {};
    const { s, sent } = run([SETUP, wire(listing)]);
    expect([s.targetIds, sent.at(-1)]).toEqual([[4408475], offerSub([4408475])]);
  });
  it("ignores deltas and foreign streams and merges a split offer by id", () => {
    const st = offerMessage().payload[0].payload; const first = new Set(st.markets.slice(0, 22).map((m: any) => m.id));
    const part = (ms: any[], ss: any[]) => wire({ type: "DATA", streamId: 3, payload: [{ type: "INITIAL_STATE", payload: { ...st, markets: ms, selections: ss } }] });
    const delta = Buffer.from('{"type":"DATA","streamId":3,"payload":[{"type":"SELECTION_DELTA","payload":{"id":1,"trueOdds":1.7}}]}');
    const { s, done } = run([SETUP, wire(listingMessage([4408475])), delta, wire({ ...offerMessage(), streamId: 9 }),
      part(st.markets.slice(0, 22), st.selections.filter((x: any) => first.has(x.marketId))),
      part(st.markets.slice(22), st.selections.filter((x: any) => !first.has(x.marketId)))]);
    expect(done).toEqual([false, false, false, false, false, true]);
    expect([s.offerMessages, offerFor(s, 4408475).markets.length, offerFor(s, 4408475).selections.length]).toEqual([2, 45, 222]);
  });
  it("records invalid frames, the last control frame and buffered bytes", () => {
    const { s } = run([SETUP, Buffer.from("garbage"), Buffer.from('{"type":"ERROR","streamId":3,"message":"Unknown route"}'), Buffer.alloc(1048576, 0x20)]);
    expect(describeDirectState(s)).toBe("frames: 4, invalid: 1, last error: not JSON, last control: ERROR Unknown route, buffered: 1048576 bytes");
    expect(s.diagnostics).toMatchObject({ framesReceived: 4, invalidFrames: 1, chunkedFrames: 1, lastInvalidError: "not JSON", lastControl: { type: "ERROR", message: "Unknown route" } });
  });
  it("is done after an empty listing without subscribing an offer", () => {
    const { s, sent, done } = run([SETUP, wire(listingMessage([]))]);
    expect([sent, done.at(-1)]).toEqual([[LISTING_SUB, CLOSE_1], true]);
    expect([s.diagnostics.initialStates, s.diagnostics.maxEvents]).toEqual([1, 0]);   // isEmptyListing(s.diagnostics) === true
  });
});
