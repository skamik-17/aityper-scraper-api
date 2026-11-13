/**
 * The STS sportsbook WebSocket protocol as the direct (browserless) client
 * speaks it. Verified against the site's own framing (plan 05a Observations):
 *
 * - `{"t":1,"u":[...]}` subscribes topics. `{"s":"<topic>","n":0}` asks for a
 *   snapshot; a topic listed without `n` stays subscribed without a new one.
 *   Every `t:1` repeats the whole topic set, like the browser does.
 * - `{"t":4}` follows the first subscription. The server's `{"t":5}` is NOT an
 *   end-of-snapshots marker, so a wait ends when every asked id has a snapshot.
 * - A data frame is `<header JSON>\n<body JSON>`; snapshots carry `"f":1` in the
 *   header, deltas do not.
 *
 * Kept out of constants.ts, which the recovery tasks edit.
 */
import { DEFAULT_USER_AGENT } from "../../shared/http/http-client.js";
import { MAX_SKIPPED_DETAIL_RATIO } from "../../shared/detail-fetch.js";
import { hasFixtureSnapshot, isSnapshotFrame, recordStsFrame } from "./navigation.js";
import type { WSCaptureResult } from "./types.js";

export const STS_WS_URL = "wss://www.sts.pl/sbk/api/sbk";

/** Exactly these three; no cookies (the cookie-less handshake was accepted in every probe) */
export const STS_WS_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  origin: "https://www.sts.pl",
  "user-agent": DEFAULT_USER_AGENT,
  "accept-language": "pl-PL,pl;q=0.9",
});

export const STS_WS_CONNECT_TIMEOUT_MS = 10_000;
/** The ~3 MB i_pl snapshot arrived ~0.4 s after the subscription in the probes */
export const STS_IPL_TIMEOUT_MS = 10_000;
/** Per round of fixture snapshots (first request, then one re-send for the missing ids) */
export const STS_SNAPSHOT_TIMEOUT_MS = 5_000;
/** This many fixtures still without a snapshot after the re-send fail the whole run */
export const STS_SNAPSHOT_MISS_LIMIT = 3;
export const STS_SYNC_MESSAGE = '{"t":4}';
export const STS_FALLBACK_HINT = "set SCRAPER_TRANSPORT_STS=browser to use the browser path";

export interface StsTopicRequest {
  topic: string;
  /** true = ask for a snapshot (`n:0`); false = keep the topic subscribed */
  snapshot: boolean;
}

export function fixtureTopic(fixtureId: string): string {
  return `f_${fixtureId}_pl`;
}

export function buildStsSubscription(requests: readonly StsTopicRequest[]): string {
  return JSON.stringify({ t: 1, u: requests.map((r) => (r.snapshot ? { s: r.topic, n: 0 } : { s: r.topic })) });
}

export function emptyStsCapture(): WSCaptureResult {
  return { initialData: "", fixtureData: new Map() };
}

/** WsSession reducer: records text frames with the browser path's recorder, ignores binary ones */
export function reduceStsFrame(state: WSCaptureResult, frame: Buffer, isBinary: boolean): WSCaptureResult {
  if (!isBinary) recordStsFrame(state, frame.toString("utf8"));
  return state;
}

/** True once the stored i_pl frame is a snapshot (a delta alone lists no fixtures) */
export function hasIplSnapshot(state: WSCaptureResult): boolean {
  return state.initialData !== "" && isSnapshotFrame(state.initialData);
}

/** The ids without a recorded snapshot, in the given (listing) order */
export function missingSnapshots(state: WSCaptureResult, fixtureIds: readonly string[]): string[] {
  return fixtureIds.filter((id) => !hasFixtureSnapshot(state, id));
}

export function shouldTripStsBreaker(missing: number, requested: number): boolean {
  return missing >= STS_SNAPSHOT_MISS_LIMIT || (requested > 0 && missing / requested > MAX_SKIPPED_DETAIL_RATIO);
}

/**
 * - blocked: Cloudflare/edge refuses non-browser clients (flip to the browser path)
 * - protocol: the upgrade was accepted but subscriptions go unanswered (framing changed)
 * - transient: network or edge hiccups, the run deadline, and anything that is not a
 *   transport fault (an unknown league, an empty strict listing)
 */
export type StsWsFailureKind = "blocked" | "transient" | "protocol";

export function classifyStsWsFailure(message: string): StsWsFailureKind {
  if (/^ws handshake HTTP (403|429|503) /.test(message) || /^ws closed 1008 /.test(message)) return "blocked";
  if (message.includes(" | ws timeout ")) return "protocol";
  return "transient";
}
