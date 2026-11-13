/**
 * Browserless HTTP client shared by the scrapers: per-attempt timeouts that
 * cover the body read, one retry with full-jitter backoff on network/timeout/
 * 429/5xx, a per-host concurrency limit, typed errors and live counters.
 */
import pLimit, { type LimitFunction } from "p-limit";
import {
  HttpError,
  abortedError,
  contentTypeError,
  httpStatusError,
  networkError,
  timeoutError,
} from "./http-error.js";

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  /** Per attempt, including the body read. Default 10 000. */
  timeoutMs?: number;
  /** Extra attempts after the first. Default 1. */
  retries?: number;
  signal?: AbortSignal;
}

export interface HttpStats {
  requests: number;
  retries: number;
  failures: number;
  bytes: number;
  byStatus: Record<string, number>;
}

export interface HttpClient {
  getJson<T>(url: string, opts?: HttpRequestOptions): Promise<T>;
  getText(url: string, opts?: HttpRequestOptions): Promise<string>;
  readonly stats: HttpStats;
}

export interface HttpClientConfig {
  userAgent?: string;
  defaultHeaders?: Record<string, string>;
  perHostConcurrency?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 1;
const BACKOFF_BASE_MS = 500;
const RETRY_AFTER_CAP_MS = 5_000;

const lowerKeys = (h: Record<string, string> = {}): Record<string, string> =>
  Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - Date.now());
}

/** Rejects with onAbort() as soon as `signal` aborts; listens on a derived signal only. */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined, onAbort: () => Error): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(onAbort());
  }
  const derived = AbortSignal.any([signal]);
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      promise.catch(() => {});
      reject(onAbort());
    };
    derived.addEventListener("abort", abort, { once: true });
    promise.then(
      (v) => {
        derived.removeEventListener("abort", abort);
        resolve(v);
      },
      (e) => {
        derived.removeEventListener("abort", abort);
        reject(e);
      },
    );
  });
}

function abortableSleep(ms: number, signal: AbortSignal | undefined, onAbort: () => Error): Promise<void> {
  // A zero delay retries at once (a 0 ms timer would still cost a timer tick).
  if (ms <= 0) return signal?.aborted ? Promise.reject(onAbort()) : Promise.resolve();
  return raceAbort(
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
    signal,
    onAbort,
  );
}

export function createHttpClient(cfg: HttpClientConfig = {}): HttpClient {
  const perHost = cfg.perHostConcurrency ?? 4;
  pLimit(perHost); // validates the value now: a bad config throws at creation
  const limiters = new Map<string, LimitFunction>();
  const limiterFor = (host: string) => {
    let l = limiters.get(host);
    if (!l) {
      l = pLimit(perHost);
      limiters.set(host, l);
    }
    return l;
  };

  const stats: HttpStats = { requests: 0, retries: 0, failures: 0, bytes: 0, byStatus: {} };
  const count = (key: string) => {
    stats.byStatus[key] = (stats.byStatus[key] ?? 0) + 1;
  };
  const baseHeaders = {
    "user-agent": cfg.userAgent ?? DEFAULT_USER_AGENT,
    "accept-language": "pl-PL,pl;q=0.9",
    "accept-encoding": "gzip, deflate, br",
    ...lowerKeys(cfg.defaultHeaders),
  };

  async function request(url: string, opts: HttpRequestOptions, asJson: boolean): Promise<unknown> {
    const { signal } = opts;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const retries = opts.retries ?? DEFAULT_RETRIES;
    const headers = {
      ...baseHeaders,
      accept: asJson ? "application/json, text/plain, */*" : "*/*",
      ...lowerKeys(opts.headers),
    };

    if (signal?.aborted) {
      stats.failures++;
      throw abortedError(url);
    }

    let retryAfterMs: number | null = null;

    const attemptOnce = async (): Promise<unknown> => {
      if (signal?.aborted) throw abortedError(url); // slot granted after abort: no fetch
      const ctl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctl.abort();
      }, timeoutMs);
      const s = signal ? AbortSignal.any([signal, ctl.signal]) : ctl.signal;
      stats.requests++;
      try {
        const fetchImpl = cfg.fetchImpl ?? globalThis.fetch; // read per attempt: tests stub fetch late
        const res = await fetchImpl(url, { headers, signal: s });
        const text = await raceAbort(res.text(), s, () => new Error("aborted"));
        const contentLength = Number(res.headers.get("content-length"));
        stats.bytes += res.headers.get("content-length") !== null && Number.isFinite(contentLength) ? contentLength : Buffer.byteLength(text);
        count(String(res.status));
        const contentType = res.headers.get("content-type");

        if (!res.ok) {
          const ra = parseRetryAfter(res.headers.get("retry-after"));
          retryAfterMs = ra === null ? null : Math.min(RETRY_AFTER_CAP_MS, ra);
          throw httpStatusError(url, res.status, contentType, text, res.headers.get("cf-mitigated") ?? undefined);
        }
        if (!asJson) return text;
        if (!contentType || !/json/i.test(contentType)) throw contentTypeError(url, res.status, contentType, text);
        try {
          return JSON.parse(text);
        } catch {
          throw contentTypeError(url, res.status, contentType, text);
        }
      } catch (e) {
        if (e instanceof HttpError) throw e;
        if (signal?.aborted) {
          count("aborted");
          throw abortedError(url);
        }
        if (timedOut) {
          count("timeout");
          throw timeoutError(url, timeoutMs);
        }
        count("network");
        throw networkError(url, e);
      } finally {
        clearTimeout(timer);
      }
    };

    const host = new URL(url).host;
    for (let attempt = 0; ; attempt++) {
      retryAfterMs = null;
      try {
        const task = limiterFor(host)(attemptOnce);
        return await raceAbort(task, signal, () => abortedError(url)); // queue wait is abortable
      } catch (e) {
        const retryable =
          e instanceof HttpError &&
          e.kind !== "aborted" &&
          e.kind !== "content-type" &&
          !(e.kind === "http" && e.status !== 429 && (e.status ?? 0) < 500);
        if (!retryable || attempt >= retries) {
          stats.failures++;
          throw e;
        }
        stats.retries++;
        const delay = retryAfterMs ?? Math.floor(Math.random() * BACKOFF_BASE_MS * 2 ** attempt);
        try {
          await abortableSleep(delay, signal, () => abortedError(url));
        } catch (abortErr) {
          stats.failures++;
          throw abortErr;
        }
      }
    }
  }

  return {
    getJson: <T>(url: string, opts: HttpRequestOptions = {}) => request(url, opts, true) as Promise<T>,
    getText: (url: string, opts: HttpRequestOptions = {}) => request(url, opts, false) as Promise<string>,
    stats,
  };
}
