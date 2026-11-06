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
 */

import type { PZBukInitialState, PZBukWebSocketMessage } from "./types.js";

export type DecodedFrame =
  | { kind: "setup"; chunkSize: number }
  | { kind: "data"; streamId: number | null; messages: PZBukWebSocketMessage[] }
  | { kind: "control"; type: string; message: string | null }
  | { kind: "invalid"; error: string };

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
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

/**
 * Decodes one complete (already reassembled) frame text. Never throws:
 * undecodable input yields `{ kind: "invalid", error }`.
 */
export function decodeFrame(text: string): DecodedFrame {
  const trimmed = text.trimStart();
  try {
    if (trimmed.startsWith("{")) return decodeEnvelope(JSON.parse(trimmed));
    if (trimmed.startsWith("[")) {
      return { kind: "data", streamId: null, messages: toMessages(JSON.parse(trimmed)) };
    }
    // Legacy RSocket frame: binary header, then the JSON message array.
    const start = trimmed.indexOf("[{");
    if (start === -1) return { kind: "invalid", error: "not JSON" };
    return { kind: "data", streamId: null, messages: toMessages(JSON.parse(trimmed.slice(start))) };
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
