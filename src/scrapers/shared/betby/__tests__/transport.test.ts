import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { BettersPlaywrightScraper, bettersScraper } from "../../../bookmakers/betters/index.js";
import { createScrapeBudget } from "../../budget.js";
import { DEFAULT_USER_AGENT, type HttpClient, type HttpRequestOptions } from "../../http/http-client.js";
import { abortedError } from "../../http/http-error.js";
import { BETBY_EVENT_TIMEOUT_MS, BETBY_LOAD_TIMEOUT_MS } from "../http.js";
import type { FetchText } from "../types.js";
import { createEvidenceFetch } from "./fake-fetch.js";

const NOW = () => Date.parse("2026-11-06T16:00:00Z");
const EVERTON = "2725815896848338956";
const EVENT_RE = /\/event\/pl\/\d+$/;
const MANIFEST_RE = /\/prematch\/brand\/\d+\/pl\/0$/;
const CHUNK_RE = /\/prematch\/brand\/\d+\/pl\/[1-9]\d*$/;
// betters premier-league in the evidence: 11 upcoming matches, so 11 event requests per scrape.
const PL_EVENTS = 11;

// fetch() over the betters evidence: 200 with the evidence body, or the fake's HTTP status.
// `holdMs` delays a response so concurrent requests overlap.
function evidenceFetch(holdMs: (url: string) => number = () => 0) {
  const evidence = createEvidenceFetch("betters");
  let inFlightChunks = 0;
  const seen = { peakChunks: 0, userAgents: new Set<string>() };
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    seen.userAgents.add(new Headers(init?.headers).get("user-agent") ?? "");
    const chunk = CHUNK_RE.test(url);
    if (chunk) seen.peakChunks = Math.max(seen.peakChunks, ++inFlightChunks);
    try {
      const ms = holdMs(url);
      if (ms > 0) await new Promise((r) => setTimeout(r, ms));
      const body = await evidence(url);
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    } catch (err) {
      return new Response("error", { status: (err as { status?: number }).status ?? 500 });
    } finally {
      if (chunk) inFlightChunks--;
    }
  });
  return { impl, seen };
}

describe("Betby transport", () => {
  let warn: MockInstance;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network disabled in unit tests");
    }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("a budget abort leaves the shared snapshot load to the other league", async () => {
    const evidence = createEvidenceFetch("betters");
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // Holds the manifest until release(); everything else answers at once.
    const fetchText: FetchText = async (url) => {
      calls.push(url);
      if (MANIFEST_RE.test(url)) await gate;
      return evidence(url);
    };
    const s = new BettersPlaywrightScraper({ fetchText, now: NOW, eventDelayMs: 0 });
    const parentA = new AbortController();
    const a = s.scrapeFullOffer("premier-league", createScrapeBudget(60_000, parentA.signal));
    const b = s.scrapeFullOffer("laliga", createScrapeBudget(60_000));
    await vi.waitFor(() => expect(calls.some((u) => MANIFEST_RE.test(u))).toBe(true));
    parentA.abort(new Error("shutdown"));
    expect(await a).toMatchObject({ success: false, matches: [], error: "scrape aborted: shutdown" });
    release();
    const rb = await b;
    expect(rb.success).toBe(true);
    expect(rb.matches.length).toBeGreaterThan(0);
    expect(calls.filter((u) => MANIFEST_RE.test(u))).toHaveLength(1);
    // League A never asked for an event.
    expect(calls.filter((u) => EVENT_RE.test(u))).toHaveLength(rb.matches.length);
  });

  it("a budget abort fails the scrape instead of falling back", async () => {
    const evidence = createEvidenceFetch("betters");
    const parent = new AbortController();
    const eventUrls: string[] = [];
    // The third event request aborts the budget and then waits on its signal.
    const fetchText: FetchText = async (url, init) => {
      if (EVENT_RE.test(url)) {
        eventUrls.push(url);
        if (eventUrls.length === 3) {
          parent.abort(new Error("shutdown"));
          return new Promise<string>((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) return reject(new Error("no signal on an event request"));
            if (signal.aborted) return reject(abortedError(url));
            signal.addEventListener("abort", () => reject(abortedError(url)), { once: true });
          });
        }
      }
      return evidence(url);
    };
    const s = new BettersPlaywrightScraper({ fetchText, now: NOW, eventDelayMs: 0 });
    const r = await s.scrapeFullOffer("premier-league", createScrapeBudget(60_000, parent.signal));
    expect(r).toMatchObject({ success: false, matches: [], error: "scrape aborted: shutdown" });
    expect(eventUrls).toHaveLength(3);
    // Only the events before the abort could fall back; the aborted one never does.
    const fallbacks = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("using listing markets"));
    expect(fallbacks.some((m) => m.includes(eventUrls[2].split("/").pop()!))).toBe(false);
    // Of the two PL events before the abort, only Everton has no payload in the evidence.
    expect(eventUrls.slice(0, 2).some((u) => u.endsWith(`/${EVERTON}`))).toBe(true);
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]).toContain(`${EVERTON}: no event payload`);
  });

  it("event requests use 5 s and one retry with the budget signal; loads use 10 s and no caller signal", async () => {
    const evidence = createEvidenceFetch("betters");
    const getText = vi.fn(async (url: string, _opts?: HttpRequestOptions) => evidence(url));
    const http: HttpClient = {
      getText,
      getJson: async () => {
        throw new Error("unused");
      },
      stats: { requests: 0, retries: 0, failures: 0, bytes: 0, byStatus: {} },
    };
    await new BettersPlaywrightScraper({ http, now: NOW, eventDelayMs: 0 }).scrapeFullOffer("premier-league");
    const events = getText.mock.calls.filter(([u]) => EVENT_RE.test(u));
    const loads = getText.mock.calls.filter(([u]) => !EVENT_RE.test(u));
    expect(events).toHaveLength(PL_EVENTS);
    expect(new Set(events.map(([, o]) => `${o?.timeoutMs}/${o?.retries}`))).toEqual(new Set([`${BETBY_EVENT_TIMEOUT_MS}/1`]));
    expect(events.every(([, o]) => o?.signal instanceof AbortSignal)).toBe(true);
    expect(loads.length).toBeGreaterThanOrEqual(9); // discovery, manifest, 7 chunks, descriptions
    expect(new Set(loads.map(([, o]) => `${o?.timeoutMs}/${o?.retries}`))).toEqual(new Set([`${BETBY_LOAD_TIMEOUT_MS}/1`]));
    expect(loads.every(([, o]) => o?.signal === undefined)).toBe(true);
    expect([BETBY_EVENT_TIMEOUT_MS, BETBY_LOAD_TIMEOUT_MS]).toEqual([5_000, 10_000]);
  });

  it("snapshot chunks stay parallel on one host, with the shared Chrome user agent", async () => {
    const { impl, seen } = evidenceFetch((url) => (CHUNK_RE.test(url) ? 30 : 0));
    vi.stubGlobal("fetch", impl);
    const r = await new BettersPlaywrightScraper({ now: NOW, eventDelayMs: 0 }).scrapeFullOffer("premier-league");
    expect(r.success).toBe(true);
    expect(seen.peakChunks).toBe(7);
    expect(seen.userAgents).toEqual(new Set([DEFAULT_USER_AGENT]));
  });

  it("transportStats counts requests cumulatively", async () => {
    const { impl } = evidenceFetch();
    vi.stubGlobal("fetch", impl);
    const s = new BettersPlaywrightScraper({ now: NOW, eventDelayMs: 0 });
    await s.scrapeFullOffer("premier-league");
    const first = s.transportStats().http!;
    expect(first.requests).toBe(impl.mock.calls.length);
    expect(first.requests).toBeGreaterThan(PL_EVENTS);
    // Endpoints, snapshot and descriptions are cached: the second scrape asks only for the events.
    await s.scrapeFullOffer("premier-league");
    const second = s.transportStats().http!;
    expect(second.requests - first.requests).toBe(PL_EVENTS);
    expect(second.byStatus["200"]).toBe(second.requests);
    second.byStatus["200"] = -1;
    expect(s.transportStats().http!.byStatus["200"]).toBe(first.requests + PL_EVENTS);
  });

  it("transportStats stays at zero when a FetchText is injected", async () => {
    const s = new BettersPlaywrightScraper({ fetchText: createEvidenceFetch("betters"), now: NOW, eventDelayMs: 0 });
    await s.scrapeFullOffer("premier-league");
    expect(s.transportStats().http).toEqual({ requests: 0, retries: 0, failures: 0, bytes: 0, byStatus: {} });
  });

  it("declares the http transport", () => expect(bettersScraper.transport).toBe("http"));
});
