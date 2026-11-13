/**
 * PZBuk direct WebSocket session (pure, no browser, no socket).
 *
 * The site's own `sportsbook-api/ws` socket is driven without a page:
 * 1. after the server's SETUP frame, subscribe the league listing on stream 1
 *    with the filter the site's sidebar sends;
 * 2. on the listing's INITIAL_STATE, close stream 1 and subscribe the offer of
 *    every valid listed event that declares market groups on stream 3, in one
 *    SUBSCRIBE with no market-group filter (all groups);
 * 3. merge the offer's INITIAL_STATE messages by id until every target event's
 *    declared groups are covered (`offer-coverage.ts`).
 *
 * `reduceDirectFrame` is the frame reducer for `WsSession.collect`; it reuses
 * the browser path's FrameAssembler, decodeFrame and CaptureDiagnostics.
 * Wire ids are JSON numbers: they are sent back as given and looked up by
 * `String(id)`. Deltas are ignored; odds come from the INITIAL_STATE snapshot.
 */
import { DEFAULT_USER_AGENT } from "../../shared/http/http-client.js";
import { groupCoverage, isCoverageComplete, type GroupCoverage } from "./offer-coverage.js";
import { isValidEvent } from "./parser.js";
import type { PZBukEvent, PZBukInitialState, PZBukMarket, PZBukSelection } from "./types.js";
import {
  FrameAssembler,
  decodeFrame,
  emptyDiagnostics,
  initialStatesOf,
  lastFrameDetails,
  type CaptureDiagnostics,
} from "./ws-protocol.js";

export const PZBUK_WS_URL = "wss://www.pzbuk.pl/sportsbook-api/ws?franchiseCode=POLAND_PZBUK&locale=pl";

/** Exactly the two headers the probes used; no cookies, no page load. */
export const PZBUK_WS_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  origin: "https://www.pzbuk.pl",
  "user-agent": DEFAULT_USER_AGENT,
});

export const LISTING_STREAM_ID = 1;
export const OFFER_STREAM_ID = 3;
/** The server's announced chunk size (SETUP), pre-set so a lost SETUP still reassembles. */
export const PZBUK_DEFAULT_CHUNK_SIZE = 1_048_576;

/** The league listing subscription, byte-identical to the site's sidebar filter apart from the stream id. */
export function listingSubscribe(leagueId: number): string {
  return JSON.stringify({
    type: "SUBSCRIBE",
    streamId: LISTING_STREAM_ID,
    route: "events",
    version: 1,
    payload: {
      filters: { sportIds: [1], leagueIds: [leagueId], eventTypes: ["Fixture"], marketTypeFilters: [], isLive: false },
      orders: [2, 5],
    },
  });
}

/** One offer subscription for all events, every market group. Ids are serialized as given (numbers on the wire). */
export function offerSubscribe(eventIds: ReadonlyArray<string | number>): string {
  return JSON.stringify({
    type: "SUBSCRIBE",
    streamId: OFFER_STREAM_ID,
    route: "events",
    version: 1,
    payload: { filters: { eventIds: [...eventIds], includeEntities: ["MARKET", "SELECTION"] } },
  });
}

export function closeStream(streamId: number): string {
  return JSON.stringify({ type: "CLOSE", streamId, reason: "NORMAL", message: null });
}

export interface DirectSessionState {
  assembler: FrameAssembler;
  /** Bytes pushed since the last complete message. */
  pendingBytes: number;
  listing: PZBukInitialState | null;
  targetIds: Array<string | number>;
  offerEvents: Map<string, PZBukEvent>;
  offerMarkets: Map<string, PZBukMarket>;
  offerSelections: Map<string, PZBukSelection>;
  /** INITIAL_STATE messages merged on the offer stream. */
  offerMessages: number;
  diagnostics: CaptureDiagnostics;
}

export function initialDirectState(): DirectSessionState {
  const assembler = new FrameAssembler();
  assembler.setChunkSize(PZBUK_DEFAULT_CHUNK_SIZE);
  return {
    assembler,
    pendingBytes: 0,
    listing: null,
    targetIds: [],
    offerEvents: new Map(),
    offerMarkets: new Map(),
    offerSelections: new Map(),
    offerMessages: 0,
    diagnostics: { ...emptyDiagnostics(), socketUrls: [PZBUK_WS_URL], matchedSockets: 1 },
  };
}

const hasDeclaredGroups = (e: PZBukEvent) => Object.keys(e.marketGroups ?? {}).length > 0;

function onListing(state: DirectSessionState, listing: PZBukInitialState, send: (data: string) => void): void {
  state.listing = listing;
  // An event without declared groups could never be complete: never wait for it.
  state.targetIds = listing.events.filter((e) => isValidEvent(e) && hasDeclaredGroups(e)).map((e) => e.id);
  send(closeStream(LISTING_STREAM_ID));
  if (state.targetIds.length > 0) send(offerSubscribe(state.targetIds));
}

function mergeOffer(state: DirectSessionState, offer: PZBukInitialState): void {
  state.offerMessages++;
  for (const e of offer.events) state.offerEvents.set(String(e.id), e);
  for (const m of offer.markets) state.offerMarkets.set(String(m.id), m);
  for (const s of offer.selections) state.offerSelections.set(String(s.id), s);
}

/** Feeds one socket frame through the session; mutates and returns `state`. */
export function reduceDirectFrame(
  state: DirectSessionState,
  frame: Buffer,
  leagueId: number,
  send: (data: string) => void
): DirectSessionState {
  const d = state.diagnostics;
  d.framesReceived++;
  state.pendingBytes += frame.length;

  const text = state.assembler.push(frame);
  if (text === null) {
    d.chunkedFrames++;
    return state;
  }
  state.pendingBytes = 0;
  d.maxFrameBytes = Math.max(d.maxFrameBytes, Buffer.byteLength(text));

  const decoded = decodeFrame(text);
  switch (decoded.kind) {
    case "setup":
      state.assembler.setChunkSize(decoded.chunkSize || PZBUK_DEFAULT_CHUNK_SIZE);
      send(listingSubscribe(leagueId));
      break;
    case "invalid":
      d.invalidFrames++;
      d.lastInvalidError = decoded.error;
      break;
    case "control":
      d.lastControl = { type: decoded.type, message: decoded.message };
      break;
    case "data":
      for (const st of initialStatesOf(decoded)) {
        d.initialStates++;
        d.maxEvents = Math.max(d.maxEvents, st.events.length);
        if (decoded.streamId === LISTING_STREAM_ID && state.listing === null) onListing(state, st, send);
        else if (decoded.streamId === OFFER_STREAM_ID) mergeOffer(state, st);
        // any other stream, or a second listing: ignored
      }
      break;
  }
  return state;
}

function listingEvent(state: DirectSessionState, key: string): PZBukEvent | undefined {
  return state.listing?.events.find((e) => String(e.id) === key);
}

/** The offer's own copy of the event (same snapshot as its markets) when it declares groups, else the listing's. */
function coverageEvent(state: DirectSessionState, key: string): PZBukEvent | undefined {
  const offered = state.offerEvents.get(key);
  if (offered?.marketGroups !== undefined) return offered;
  return listingEvent(state, key) ?? offered;
}

function marketsOf(state: DirectSessionState, key: string): PZBukMarket[] {
  return [...state.offerMarkets.values()].filter((m) => String(m.eventId) === key);
}

export function coverageFor(state: DirectSessionState, eventId: string | number): GroupCoverage {
  const key = String(eventId);
  const markets = marketsOf(state, key);
  const event = coverageEvent(state, key);
  if (event === undefined) {
    return { declared: [], complete: [], declaredMarkets: 0, countedMarkets: 0, uniqueMarkets: markets.length };
  }
  return groupCoverage(event, markets);
}

/** Done once the listing arrived and every target event's declared groups are covered. */
export function isDirectSessionDone(state: DirectSessionState): boolean {
  return state.listing !== null && state.targetIds.every((id) => isCoverageComplete(coverageFor(state, id)));
}

/** One event's snapshot: the offer event (or the listing event) with its markets and selections. */
export function offerFor(state: DirectSessionState, eventId: string | number): PZBukInitialState {
  const key = String(eventId);
  const event = state.offerEvents.get(key) ?? listingEvent(state, key);
  return {
    events: event ? [event] : [],
    markets: marketsOf(state, key),
    selections: [...state.offerSelections.values()].filter((s) => String(s.eventId) === key),
  };
}

/** `frames: N, invalid: N[, last error: …][, last control: TYPE[ message]][, buffered: N bytes]`. */
export function describeDirectState(state: DirectSessionState): string {
  const d = state.diagnostics;
  const buffered = state.pendingBytes > 0 ? `, buffered: ${state.pendingBytes} bytes` : "";
  return `frames: ${d.framesReceived}, invalid: ${d.invalidFrames}${lastFrameDetails(d)}${buffered}`;
}
