// Offline FetchText that serves the copied Betby evidence by URL shape, so unit
// tests make zero live requests. Routing rules are checked in order; the first
// match wins.
import { existsSync } from "node:fs";
import { httpStatusError } from "../../http/http-error.js";
import type { BetbyBookmaker, FetchText } from "../types.js";
import { fixturePath, loadJson, loadText } from "./fixtures.js";

export interface EvidenceFetchOptions {
  /** `url.includes(key)` -> throw the HttpClient's `fetch HTTP <status> <url>` error. */
  failures?: Record<string, number>;
  /** `url.includes(key)` -> serve this body on every matching request. */
  overrides?: Record<string, string>;
  /** `url.includes(key)` -> serve this body for the first matching request only. */
  overridesOnce?: Record<string, string>;
}

export type EvidenceFetch = FetchText & { calls: string[] };

interface TrimmedChunk {
  requestedVersion: number;
}

const DESCRIPTIONS_RE = /\/descriptions\/brand\/\d+\/markets\/pl$/;
const EVENT_RE = /\/event\/pl\/(\d+)$/;
const MANIFEST_RE = /\/pl\/0$/;
const CHUNK_RE = /\/pl\/(\d+)$/;

function findKey(map: Record<string, unknown> | undefined, url: string, skip?: Set<string>): string | undefined {
  if (!map) return undefined;
  return Object.keys(map).find((key) => url.includes(key) && !skip?.has(key));
}

export function createEvidenceFetch(bm: BetbyBookmaker, opts: EvidenceFetchOptions = {}): EvidenceFetch {
  const calls: string[] = [];
  const consumedOnce = new Set<string>();
  let chunks: TrimmedChunk[] | undefined;

  const fetchText = async (url: string): Promise<string> => {
    calls.push(url);

    // 1. Injected HTTP failures.
    const failureKey = findKey(opts.failures, url);
    if (failureKey !== undefined) throw httpStatusError(url, opts.failures![failureKey], null, "");

    // 2. One-shot overrides.
    const onceKey = findKey(opts.overridesOnce, url, consumedOnce);
    if (onceKey !== undefined) {
      consumedOnce.add(onceKey);
      return opts.overridesOnce![onceKey];
    }

    // 3. Permanent overrides.
    const overrideKey = findKey(opts.overrides, url);
    if (overrideKey !== undefined) return opts.overrides![overrideKey];

    // 4-6. Discovery documents.
    if (url.includes("share/bootstrap")) return loadText(bm, "bootstrap.json");
    if (url.includes("bt-renderer.min.js")) return loadText(bm, "bt-renderer.head.js");
    if (url.includes("assets/public/config.json")) return loadText(bm, "sb-config.json");

    // 7. Market descriptions: the trimmed file wraps the raw response under `markets`.
    if (DESCRIPTIONS_RE.test(url)) {
      return JSON.stringify(loadJson<{ markets: unknown }>(bm, "descriptions-markets.trimmed.json").markets);
    }

    // 8. Full event. Checked before 9-10 because `/event/pl/<id>` also ends in `/pl/<digits>`.
    // An id without a captured payload gets the live HTTP 200 envelope without `events`.
    const event = EVENT_RE.exec(url);
    if (event) {
      const file = `event-${event[1]}.json`;
      return loadText(bm, existsSync(fixturePath(bm, file)) ? file : "event-missing-envelope.json");
    }

    // 9. Snapshot manifest.
    if (MANIFEST_RE.test(url)) return loadText(bm, "manifest.json");

    // 10. Snapshot chunk, keyed by the version it was requested with.
    const chunk = CHUNK_RE.exec(url);
    if (chunk) {
      chunks ??= loadJson<{ chunks: TrimmedChunk[] }>(bm, "snapshot-trimmed.json").chunks;
      const hit = chunks.find((c) => c.requestedVersion === Number(chunk[1]));
      if (!hit) throw httpStatusError(url, 404, null, "");
      return JSON.stringify(hit);
    }

    // 11. Anything else is a test bug.
    throw new Error("fake-fetch: unrouted " + url);
  };

  return Object.assign(fetchText, { calls });
}
