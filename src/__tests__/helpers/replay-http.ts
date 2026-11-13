/**
 * Offline HttpClient for transport tests: answers from a route table keyed by
 * exact URL, with the real client's error texts. No network, no timers.
 */
import type { HttpClient, HttpRequestOptions, HttpStats } from "../../scrapers/shared/http/http-client.js";
import { abortedError, contentTypeError, httpStatusError } from "../../scrapers/shared/http/http-error.js";

export type ReplayRoute = { status?: number; body: string; contentType?: string } | Error;

export function createReplayHttpClient(routes: Record<string, ReplayRoute>): HttpClient & { calls: string[] } {
  const calls: string[] = [];
  const stats: HttpStats = { requests: 0, retries: 0, failures: 0, bytes: 0, byStatus: {} };

  const request = async (url: string, opts: HttpRequestOptions, asJson: boolean): Promise<unknown> => {
    try {
      if (opts.signal?.aborted) throw abortedError(url);
      calls.push(url);
      stats.requests++;
      const route = routes[url];
      if (route === undefined) throw new Error(`replay-http: no route for ${url}`);
      if (route instanceof Error) throw route;

      const status = route.status ?? 200;
      const contentType = route.contentType ?? "application/json";
      stats.bytes += Buffer.byteLength(route.body);
      stats.byStatus[String(status)] = (stats.byStatus[String(status)] ?? 0) + 1;

      if (status < 200 || status > 299) throw httpStatusError(url, status, contentType, route.body);
      if (!asJson) return route.body;
      if (!/json/i.test(contentType)) throw contentTypeError(url, status, contentType, route.body);
      try {
        return JSON.parse(route.body);
      } catch {
        throw contentTypeError(url, status, contentType, route.body);
      }
    } catch (e) {
      stats.failures++;
      throw e;
    }
  };

  return {
    calls,
    stats,
    getJson: <T>(url: string, opts: HttpRequestOptions = {}) => request(url, opts, true) as Promise<T>,
    getText: (url: string, opts: HttpRequestOptions = {}) => request(url, opts, false) as Promise<string>,
  };
}
