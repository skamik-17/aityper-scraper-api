/**
 * PZBuk WebSocket protocol (pure, no Playwright).
 *
 * The sportsbook socket (`sportsbook-api/ws?franchiseCode=…`) speaks UTF-8 JSON
 * envelopes:
 * - `{"type":"SETUP","chunkSize":N}` opens the connection; frames with
 *   `byteLength >= chunkSize` are continuations of one logical frame.
 * - `{"type":"DATA","streamId":N,"payload":[{type,payload}, …]}` carries
 *   INITIAL_STATE snapshots and SELECTION_DELTA / EVENT_DELTA updates.
 * - Any other type (`CLOSE`, a server `ERROR`, …) is a control frame.
 *
 * The legacy RSocket frame shape (binary header followed by a bare
 * `[{type:"INITIAL_STATE",…}]` array) is still decoded in case the matched
 * socket serves it again.
 *
 * An event page subscribes one stream per market group; `SingleEventAccumulator`
 * merges their INITIAL_STATE payloads into one snapshot. `CaptureDiagnostics`
 * records what a capture saw, and `describeCaptureFailure` names why it
 * produced nothing.
 */

import { WEBSOCKET_URL_PATTERN } from "./constants.js";
import type {
  PZBukEvent,
  PZBukInitialState,
  PZBukMarket,
  PZBukSelection,
  PZBukWebSocketMessage,
} from "./types.js";

export type DecodedFrame =
  | { kind: "setup"; chunkSize: number }
  | { kind: "data"; streamId: number | null; messages: PZBukWebSocketMessage[] }
  | { kind: "control"; type: string; message: string | null }
  | { kind: "invalid"; error: string };

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMessage(value: unknown): value is PZBukWebSocketMessage {
  return isRecord(value) && typeof value.type === "string";
}

/** Keeps only well-formed `{type: string, payload}` entries of a DATA payload. */
function toMessages(payload: unknown): PZBukWebSocketMessage[] {
  return Array.isArray(payload) ? payload.filter(isMessage) : [];
}

function decodeEnvelope(frame: unknown): DecodedFrame {
  if (!isRecord(frame) || typeof frame.type !== "string") return { kind: "invalid", error: "frame has no type" };
  if (frame.type === "SETUP") {
    const chunkSize = typeof frame.chunkSize === "number" && Number.isFinite(frame.chunkSize) ? frame.chunkSize : 0;
    return { kind: "setup", chunkSize };
  }
  if (frame.type === "DATA") {
    return {
      kind: "data",
      streamId: typeof frame.streamId === "number" ? frame.streamId : null,
      messages: toMessages(frame.payload),
    };
  }
  return { kind: "control", type: frame.type, message: typeof frame.message === "string" ? frame.message : null };
}

function decodeText(trimmed: string): DecodedFrame {
  if (trimmed.startsWith("{")) return decodeEnvelope(JSON.parse(trimmed));
  if (trimmed.startsWith("[")) {
    return { kind: "data", streamId: null, messages: toMessages(JSON.parse(trimmed)) };
  }
  // Legacy RSocket frame: binary header, then the JSON message array.
  const start = trimmed.indexOf("[{");
  if (start === -1) return { kind: "invalid", error: "not JSON" };
  return { kind: "data", streamId: null, messages: toMessages(JSON.parse(trimmed.slice(start))) };
}

const STATE_ARRAYS = ["events", "markets", "selections"] as const;

/** `<array>[<index>]` of the first INITIAL_STATE entry that is not an object, or null. */
function firstNonObjectEntry(state: PZBukInitialState): string | null {
  for (const key of STATE_ARRAYS) {
    const index = (state[key] as unknown[]).findIndex((entry) => !isRecord(entry));
    if (index !== -1) return `${key}[${index}]`;
  }
  return null;
}

/**
 * A DATA frame whose INITIAL_STATE has a non-object entry is invalid as a
 * whole (fail closed): the frame is dropped instead of being merged partially
 * or dereferenced, and the error names the entry.
 */
function rejectMalformedStates(frame: DecodedFrame): DecodedFrame {
  for (const state of initialStatesOf(frame)) {
    const entry = firstNonObjectEntry(state);
    if (entry !== null) return { kind: "invalid", error: `INITIAL_STATE ${entry} is not an object` };
  }
  return frame;
}

/**
 * Decodes one complete (already reassembled) frame text. Never throws:
 * undecodable input, and a DATA frame with a malformed INITIAL_STATE entry,
 * yield `{ kind: "invalid", error }`.
 */
export function decodeFrame(text: string): DecodedFrame {
  try {
    return rejectMalformedStates(decodeText(text.trimStart()));
  } catch (error) {
    return { kind: "invalid", error: errorMessage(error) };
  }
}

function isInitialState(payload: unknown): payload is PZBukInitialState {
  return (
    isRecord(payload) &&
    Array.isArray(payload.events) &&
    Array.isArray(payload.markets) &&
    Array.isArray(payload.selections)
  );
}

/**
 * INITIAL_STATE payloads of a DATA frame. Delta messages, other frame kinds
 * and payloads without the events/markets/selections arrays yield nothing.
 */
export function initialStatesOf(frame: DecodedFrame): PZBukInitialState[] {
  if (frame.kind !== "data") return [];
  return frame.messages
    .filter((m) => m.type === "INITIAL_STATE")
    .map((m) => m.payload)
    .filter(isInitialState);
}

/**
 * Market-group ids requested by a sent SUBSCRIBE frame
 * (`payload.filters.marketGroupIds`); `[]` for any other or unparsable frame.
 */
export function subscribedGroupIds(sentText: string): number[] {
  try {
    const parsed: unknown = JSON.parse(sentText);
    if (!isRecord(parsed) || parsed.type !== "SUBSCRIBE") return [];
    const filters = isRecord(parsed.payload) ? parsed.payload.filters : undefined;
    const ids = isRecord(filters) ? filters.marketGroupIds : undefined;
    return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === "number") : [];
  } catch {
    return [];
  }
}

/**
 * Reassembles chunked frames the way the site bundle does (`bufferAndAssemble`):
 * once SETUP announces a positive chunkSize, every frame with
 * `byteLength >= chunkSize` is buffered and the next shorter frame completes
 * the message. Chunks are concatenated as bytes before UTF-8 decoding, so a
 * boundary inside a multi-byte character reassembles byte-exact.
 */
export class FrameAssembler {
  private chunkSize = 0;
  private chunks: Buffer[] = [];

  setChunkSize(bytes: number): void {
    this.chunkSize = bytes;
  }

  /** Returns the full frame text, or null while a chunked frame is still buffering. */
  push(payload: Buffer | string): string | null {
    const bytes = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
    if (this.chunkSize <= 0) return typeof payload === "string" ? payload : bytes.toString("utf8");
    this.chunks.push(bytes);
    if (bytes.byteLength >= this.chunkSize) return null;
    const text = Buffer.concat(this.chunks).toString("utf8");
    this.chunks = [];
    return text;
  }
}

export interface AccumulatorStats {
  selections: number;
  markets: number;
  marketGroupsDeclared: number[];
  marketGroupsSeen: number[];
}

const ascending = (a: number, b: number) => a - b;

/** Group ids every market of a payload is listed under (the payload's subscribed group). */
function commonGroupIds(markets: PZBukMarket[]): number[] {
  const lists = markets.map((m) => {
    const ids = m.marketType?.marketGroupIds;
    return Array.isArray(ids) ? ids : [];
  });
  return lists.reduce((common, ids) => common.filter((id) => ids.includes(id)));
}

/**
 * Merges the single-event INITIAL_STATE payloads of one event page into one
 * snapshot. The page opens one stream per market group, and each stream
 * delivers only that group's markets, so the full offer is their union.
 * Multi-event payloads (the listing widget on the event page) are ignored.
 */
export class SingleEventAccumulator {
  private event: PZBukEvent | null = null;
  private readonly markets = new Map<string, PZBukMarket>();
  private readonly selections = new Map<string, PZBukSelection>();
  private readonly seenGroups = new Set<number>();

  /** When set, single-event payloads for any other event are rejected. */
  constructor(private readonly expectedEventId?: number | string) {}

  /**
   * Returns true only for a merged single-event payload. A payload with a
   * non-object entry is rejected whole, never merged partially, so its group
   * stays unseen and shows up as "never answered".
   */
  add(state: PZBukInitialState): boolean {
    if (state.events.length !== 1 || firstNonObjectEntry(state) !== null) return false;
    const [event] = state.events;
    if (this.expectedEventId !== undefined && String(event.id) !== String(this.expectedEventId)) return false;
    this.event ??= event;
    for (const market of state.markets) this.markets.set(market.id, market);
    for (const selection of state.selections) {
      // The latest state of a selection wins: a later non-Active copy removes
      // the earlier Active price instead of leaving it stale in the snapshot.
      if (selection.status === "Active") this.selections.set(selection.id, selection);
      else this.selections.delete(selection.id);
    }
    if (state.markets.length > 0) {
      for (const id of commonGroupIds(state.markets)) this.seenGroups.add(id);
    }
    return true;
  }

  /** The merged state, or null until at least one Active selection is merged. */
  snapshot(): PZBukInitialState | null {
    if (this.event === null || this.selections.size === 0) return null;
    return {
      events: [this.event],
      markets: [...this.markets.values()],
      selections: [...this.selections.values()],
    };
  }

  stats(): AccumulatorStats {
    return {
      selections: this.selections.size,
      markets: this.markets.size,
      marketGroupsDeclared: Object.keys(this.event?.marketGroups ?? {}).map(Number).sort(ascending),
      marketGroupsSeen: [...this.seenGroups].sort(ascending),
    };
  }

  /** Market-group id whose name matches a header text (trimmed, case-insensitive). */
  groupIdForHeader(headerText: string): number | null {
    const wanted = headerText.trim().toLowerCase();
    for (const [id, group] of Object.entries(this.event?.marketGroups ?? {})) {
      if (typeof group?.name === "string" && group.name.trim().toLowerCase() === wanted) return Number(id);
    }
    return null;
  }
}

/** What one capture saw on the wire, for logs and failure messages. */
export interface CaptureDiagnostics {
  socketUrls: string[];
  matchedSockets: number;
  framesReceived: number;
  invalidFrames: number;
  lastInvalidError: string | null;
  /** FrameAssembler.push calls that returned null (chunk continuations). */
  chunkedFrames: number;
  /** Byte length of the largest complete (reassembled) frame. */
  maxFrameBytes: number;
  initialStates: number;
  /** Max events.length over the decoded INITIAL_STATE payloads. */
  maxEvents: number;
  /** Last received non-SETUP control frame. */
  lastControl: { type: string; message: string | null } | null;
  groups?: { declared: number[]; seen: number[] };
}

export function emptyDiagnostics(): CaptureDiagnostics {
  return {
    socketUrls: [],
    matchedSockets: 0,
    framesReceived: 0,
    invalidFrames: 0,
    lastInvalidError: null,
    chunkedFrames: 0,
    maxFrameBytes: 0,
    initialStates: 0,
    maxEvents: 0,
    lastControl: null,
  };
}

/** The socket answered with INITIAL_STATE, but no message carried any event. */
export function isEmptyListing(d: CaptureDiagnostics): boolean {
  return d.initialStates > 0 && d.maxEvents === 0;
}

function lastFrameDetails(d: CaptureDiagnostics): string {
  let details = "";
  if (d.lastInvalidError) details += `, last error: ${d.lastInvalidError}`;
  if (d.lastControl) {
    details += `, last control: ${d.lastControl.type}`;
    if (d.lastControl.message) details += ` ${d.lastControl.message}`;
  }
  return details;
}

/** One-line cause of a capture that produced no usable snapshot. */
export function describeCaptureFailure(d: CaptureDiagnostics): string {
  if (d.matchedSockets === 0) {
    const seen = d.socketUrls.length > 0 ? d.socketUrls.join(", ") : "none";
    return `no socket matched "${WEBSOCKET_URL_PATTERN}" (sockets seen: ${seen})`;
  }
  const details = lastFrameDetails(d);
  if (d.initialStates === 0) {
    return `socket matched but no INITIAL_STATE decoded (frames: ${d.framesReceived}, invalid: ${d.invalidFrames}${details})`;
  }
  if (isEmptyListing(d)) {
    return `listing is empty (${d.initialStates} INITIAL_STATE message(s) with 0 events, frames: ${d.framesReceived}${details})`;
  }
  return `${d.initialStates} INITIAL_STATE message(s) but no usable snapshot (max events per message: ${d.maxEvents}, frames: ${d.framesReceived}${details})`;
}
