/**
 * Test-only accessors for the recorded direct-session fixture
 * (`fixtures/ws-direct-session.json`): the SETUP frame, the league listing
 * (stream 1, 3 events, 0 markets) and the offer of 4408475 (stream 3).
 * Every accessor returns a deep copy, so a test may mutate what it gets.
 */
import { readFileSync } from "node:fs";
import type { PZBukEvent, PZBukInitialState } from "../../types.js";

export interface DataMessage {
  type: "DATA";
  streamId: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: [{ type: "INITIAL_STATE"; payload: any }];
}

const raw = JSON.parse(readFileSync(new URL("../fixtures/ws-direct-session.json", import.meta.url), "utf8")) as {
  messages: [setup: unknown, listing: DataMessage, offer: DataMessage];
};

export const fx: { messages: [setup: unknown, listing: DataMessage, offer: DataMessage] } = raw;

/** The bytes a server would send for `message`. */
export function wire(message: unknown): Buffer {
  return Buffer.from(JSON.stringify(message));
}

/** Splits `bytes` into consecutive pieces of `size` bytes (the last one shorter or equal). */
export function chunk(bytes: Buffer, size: number): Buffer[] {
  const pieces: Buffer[] = [];
  for (let at = 0; at < bytes.length; at += size) pieces.push(bytes.subarray(at, at + size));
  return pieces;
}

/** The listing message; with `eventIds`, only those events (in listing order). */
export function listingMessage(eventIds?: number[]): DataMessage {
  const message = structuredClone(raw.messages[1]);
  if (eventIds) {
    const state = message.payload[0].payload as PZBukInitialState;
    state.events = state.events.filter((e) => eventIds.includes(Number(e.id)));
  }
  return message;
}

export function offerMessage(): DataMessage {
  return structuredClone(raw.messages[2]);
}

/** The listed events, in order 4408475, 4408509, 4408525. */
export function listingEvents(): PZBukEvent[] {
  return (listingMessage().payload[0].payload as PZBukInitialState).events;
}

export function offerState(): PZBukInitialState {
  return offerMessage().payload[0].payload as PZBukInitialState;
}

export const SETUP_32K: Buffer = Buffer.from('{"type":"SETUP","chunkSize":32768}');
