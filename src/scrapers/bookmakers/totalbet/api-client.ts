/**
 * Totalbet dealer API client
 *
 * Plain HTTP client for Totalbet's UUID platform. No browser is needed: the
 * shared HttpClient reads the league list and one detail per event, with
 * per-attempt timeouts and one retry. Every failure is returned as an explicit
 * error string naming the URL (README §3 wording), so the scraper can forward it
 * into result.error unchanged.
 */

import { createHttpClient, type HttpClient } from "../../shared/http/http-client.js";
import { HttpError } from "../../shared/http/http-error.js";
import {
  BASE_URL,
  DEALER_API_BASE_URL,
  LIST_PAGE_SIZE,
  MAX_LIST_PAGES,
  TOTALBET_DETAIL_CONCURRENCY,
  TOTALBET_REQUEST_TIMEOUT_MS,
} from "./constants.js";
import type { TotalbetDetailEvent, TotalbetListEvent } from "./api-types.js";

/**
 * HTTP seam used by every request. Injectable so tests (or a browser-backed
 * fallback, should bot protection appear) can replace the transport. `init` is
 * optional: a fake that ignores it still fits.
 */
export type FetchJson = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<{ status: number; contentType: string; body: unknown }>;

/**
 * FetchJson on the shared HttpClient (timeouts, one retry on network/timeout/
 * 429/5xx, never on 404). A 2xx JSON answer resolves with its parsed body. A
 * non-2xx answer resolves as a value too, so the caller still reads the dealer
 * envelope's `_meta.reason`; the exception is a Cloudflare-mitigated answer,
 * thrown so its `cf-mitigated=` marker reaches the error. Every other transport
 * failure (timeout, network, abort, a 2xx that is not JSON) is thrown as the
 * client's HttpError.
 */
export function createHttpFetchJson(http: HttpClient, opts: { timeoutMs: number; retries?: number }): FetchJson {
  return async (url, init) => {
    try {
      const body = await http.getJson<unknown>(url, {
        headers: { accept: "application/json" },
        timeoutMs: opts.timeoutMs,
        retries: opts.retries ?? 1,
        signal: init?.signal,
      });
      return { status: 200, contentType: "application/json", body };
    } catch (err) {
      if (err instanceof HttpError && err.kind === "http" && err.status !== null && !err.cfMitigated) {
        return { status: err.status, contentType: err.contentType ?? "", body: tryJson(err.bodySnippet) ?? err.bodySnippet };
      }
      throw err;
    }
  };
}

let defaultFetchJson: FetchJson | undefined;

/** Module-level FetchJson for callers that inject none; built on first use. */
function sharedFetchJson(): FetchJson {
  defaultFetchJson ??= createHttpFetchJson(createHttpClient({ perHostConcurrency: TOTALBET_DETAIL_CONCURRENCY }), {
    timeoutMs: TOTALBET_REQUEST_TIMEOUT_MS,
  });
  return defaultFetchJson;
}

/** League list URL for one page of a category (tournament) UUID. */
export function buildListUrl(categoryUuid: string, page: number): string {
  const query = new URLSearchParams({
    page: String(page),
    per_page: String(LIST_PAGE_SIZE),
    category_uuid: categoryUuid,
    category_type: "sport",
    type: "standard",
  });
  return `${DEALER_API_BASE_URL}/events?${query.toString()}`;
}

/** Public event page, used as the match's eventUrl. */
export function buildEventUrl(eventUuid: string): string {
  return `${BASE_URL}/event-details/${eventUuid}`;
}

const EVENT_URL_UUID_PATTERN = /\/event-details\/([0-9a-f-]{36})/i;

/** Event UUID from a public event page URL; null for anything else (including legacy numeric URLs). */
export function extractEventUuidFromUrl(url: string): string | null {
  return EVENT_URL_UUID_PATTERN.exec(url)?.[1] ?? null;
}

export interface ListEventsResult {
  events: TotalbetListEvent[];
  error?: string;
}

/**
 * Prematch events of one tournament.
 *
 * Follows pagination up to MAX_LIST_PAGES and keeps only active prematch events of
 * the requested tournament with exactly two participants, deduped by uuid in
 * first-seen order. An error on any page fails the whole list. An empty result is
 * reported as an error, because an unknown UUID answers 200 with an empty list.
 */
export async function fetchLeagueEvents(
  categoryUuid: string,
  fetchJson: FetchJson = sharedFetchJson(),
  signal?: AbortSignal
): Promise<ListEventsResult> {
  const events: TotalbetListEvent[] = [];
  const seen = new Set<string>();
  let firstPageMeta: Record<string, unknown> | null = null;
  let rawEventCount = 0;
  let lastPage = 1;

  for (let page = 1; page <= lastPage; page++) {
    const url = buildListUrl(categoryUuid, page);
    const response = await requestJson(url, fetchJson, signal);
    if (!response.ok) return { events: [], error: response.error };

    const payload = readListPayload(response.body);
    if (!payload) return { events: [], error: `Malformed list payload from ${url}` };

    if (page === 1) firstPageMeta = payload.meta;
    lastPage = Math.min(payload.totalPages ?? page, MAX_LIST_PAGES);
    rawEventCount += payload.events.length;

    for (const candidate of payload.events) {
      if (!isKeptListEvent(candidate, categoryUuid) || seen.has(candidate.uuid)) continue;
      seen.add(candidate.uuid);
      events.push(candidate);
    }
  }

  if (events.length === 0) {
    const pagination = firstPageMeta?.pagination;
    const itemsCount = isRecord(pagination) && typeof pagination.items_count === "number" ? pagination.items_count : rawEventCount;
    const eventTypes = firstPageMeta?.event_types;
    return {
      events: [],
      error: `No prematch events for category ${categoryUuid} (items_count=${itemsCount}, event_types=${JSON.stringify(eventTypes ?? [])})`,
    };
  }

  return { events };
}

export interface EventDetailResult {
  event: TotalbetDetailEvent | null;
  error?: string;
  /**
   * Set (with `event: null` and an explanatory `error`) when the detail answered for
   * the right event but that event is no longer an active prematch event, e.g. it
   * kicked off between the list call and the detail call. This is a state change,
   * not a fetch failure: the caller skips the event entirely. It gets no list-1X2
   * fallback and is not counted as a failed detail.
   */
  notPrematch?: { type: string; status: string };
}

/**
 * Full detail (component_lists) of one active prematch event.
 *
 * The list is filtered to active prematch events, but details are fetched one by
 * one afterwards, so the event's state is checked again here: in-play or suspended
 * prices must never be returned as prematch odds.
 */
export async function fetchEventDetail(
  eventUuid: string,
  fetchJson: FetchJson = sharedFetchJson(),
  signal?: AbortSignal
): Promise<EventDetailResult> {
  const url = `${DEALER_API_BASE_URL}/events/${eventUuid}`;
  const response = await requestJson(url, fetchJson, signal);
  if (!response.ok) return { event: null, error: response.error };

  const event = isRecord(response.body) && response.body.state === "success" && isRecord(response.body.data)
    ? response.body.data.event
    : undefined;
  if (!isDetailEventFor(event, eventUuid)) return { event: null, error: `Malformed detail payload from ${url}` };

  if (!isActivePrematch(event)) {
    const { type, status } = event;
    return {
      event: null,
      notPrematch: { type, status },
      error: `Event ${eventUuid} is not an active prematch event (type=${type}, status=${status}) from ${url}`,
    };
  }

  return { event };
}

type RequestOutcome = { ok: true; body: unknown } | { ok: false; error: string };

/**
 * One request with the error precedence both endpoints share: transport failure
 * (an HttpError's own message, verbatim), then a non-2xx status (whatever the
 * content type, e.g. the site's 404 HTML page), then a 2xx body that is not JSON
 * (e.g. a bot challenge page).
 */
async function requestJson(url: string, fetchJson: FetchJson, signal?: AbortSignal): Promise<RequestOutcome> {
  let response: Awaited<ReturnType<FetchJson>>;
  try {
    response = await fetchJson(url, signal ? { signal } : undefined);
  } catch (err) {
    return { ok: false, error: err instanceof HttpError ? err.message : `fetch failed ${errorMessage(err)} ${url}` };
  }

  const { status, contentType, body } = response;
  if (status < 200 || status > 299) {
    const reason = envelopeReason(body);
    return { ok: false, error: `fetch HTTP ${status} ${url}${reason ? ` reason=${reason}` : ""}` };
  }
  if (!isJsonContentType(contentType)) {
    return { ok: false, error: `fetch non-JSON ${contentType || "none"} ${url}` };
  }
  return { ok: true, body };
}

interface ListPayload {
  events: unknown[];
  totalPages?: number;
  meta: Record<string, unknown> | null;
}

function readListPayload(body: unknown): ListPayload | null {
  if (!isRecord(body) || body.state !== "success" || !isRecord(body.data) || !Array.isArray(body.data.events)) {
    return null;
  }
  const meta = isRecord(body._meta) ? body._meta : null;
  const pagination = meta?.pagination;
  const totalPages =
    isRecord(pagination) && typeof pagination.total_pages === "number" && Number.isFinite(pagination.total_pages)
      ? pagination.total_pages
      : undefined;
  return { events: body.data.events, totalPages, meta };
}

function isKeptListEvent(candidate: unknown, categoryUuid: string): candidate is TotalbetListEvent {
  if (!isRecord(candidate)) return false;
  // Fields the scraper dereferences: a malformed event is dropped, never half-parsed.
  if (typeof candidate.uuid !== "string" || !Array.isArray(candidate.participants) || !Array.isArray(candidate.markets)) {
    return false;
  }
  return isActivePrematch(candidate) && candidate.tournament_uuid === categoryUuid && candidate.participants.length === 2;
}

function isDetailEventFor(candidate: unknown, eventUuid: string): candidate is TotalbetDetailEvent {
  if (!isRecord(candidate) || !Array.isArray(candidate.component_lists)) return false;
  // A missing state is schema drift, reported as malformed (loud), never as a quiet state change.
  if (typeof candidate.type !== "string" || typeof candidate.status !== "string") return false;
  // A detail for another event would attach its odds to the wrong match.
  return typeof candidate.uuid === "string" && candidate.uuid.toLowerCase() === eventUuid.toLowerCase();
}

/** The only event state whose prices may be stored as prematch odds (list and detail alike). */
function isActivePrematch(event: { type?: unknown; status?: unknown }): boolean {
  return event.type === "prematch" && event.status === "active";
}

function envelopeReason(body: unknown): string | undefined {
  if (!isRecord(body) || !isRecord(body._meta)) return undefined;
  const reason = body._meta.reason;
  return typeof reason === "string" && reason !== "" ? reason : undefined;
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isJsonContentType(contentType: string): boolean {
  return contentType.toLowerCase().includes("json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
