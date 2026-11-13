import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildEventUrl,
  buildListUrl,
  extractEventUuidFromUrl,
  fetchEventDetail,
  fetchLeagueEvents,
  nodeFetchJson,
  type FetchJson,
} from "../api-client.js";
import { MAX_LIST_PAGES } from "../constants.js";

const load = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const PL = "8793bb6a-4684-44ba-b92e-4d896e6cbfbf";
const LIST_P1 = `https://totalbet.pl/dealer/bdata/v1/bet/events?page=1&per_page=100&category_uuid=${PL}&category_type=sport&type=standard`;
const DETAIL_URL = (uuid: string) => `https://totalbet.pl/dealer/bdata/v1/bet/events/${uuid}`;

type FakeResponse = Awaited<ReturnType<FetchJson>>;
const ok = (body: unknown): FakeResponse => ({ status: 200, contentType: "application/json; charset=utf-8", body });

// Records every requested URL; unknown URLs answer with the dealer API's 404 envelope.
function fake(routes: Record<string, FakeResponse>): FetchJson & { calls: string[] } {
  const calls: string[] = [];
  const fetchJson: FetchJson = async (url) => {
    calls.push(url);
    return routes[url] ?? { status: 404, contentType: "application/json; charset=utf-8", body: load("event-not-found.json") };
  };
  return Object.assign(fetchJson, { calls });
}

// The verbatim PL list with its events and pagination replaced.
function listPage(events: unknown[], pagination: { total_pages: number; current_page: number; items_count: number; per_page: number }) {
  const base = load("pl-events-list.json");
  return { ...base, data: { events }, _meta: { ...base._meta, pagination } };
}

// Event metadata of Leeds - Tottenham without the list-only markets and the (empty) list component_lists.
function detailBase() {
  const { markets: _markets, component_lists: _componentLists, ...base } = load("pl-events-list.json").data.events[1];
  return base;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("totalbet api-client fetchLeagueEvents", () => {
  it("fetchLeagueEvents returns the 20 prematch PL events from one page", async () => {
    const f = fake({ [LIST_P1]: ok(load("pl-events-list.json")) });
    const r = await fetchLeagueEvents(PL, f);
    expect(r.error).toBeUndefined();
    expect(r.events).toHaveLength(20);
    expect(r.events[1].uuid).toBe("0e45932b-1433-4cf5-b658-5c308b7c2b60");
    expect(f.calls).toEqual([LIST_P1]);
  });

  it("follows pagination until total_pages", async () => {
    const all = load("pl-events-list.json").data.events;
    const f = fake({
      [LIST_P1]: ok(listPage(all.slice(0, 10), { total_pages: 2, current_page: 1, items_count: 20, per_page: 100 })),
      [buildListUrl(PL, 2)]: ok(listPage(all.slice(10, 20), { total_pages: 2, current_page: 2, items_count: 20, per_page: 100 })),
    });
    const r = await fetchLeagueEvents(PL, f);
    expect(r.events).toHaveLength(20);
    expect(r.events.map((e) => e.uuid)).toEqual(all.map((e: { uuid: string }) => e.uuid));
    expect(f.calls).toEqual([LIST_P1, buildListUrl(PL, 2)]);
  });

  it("stops after MAX_LIST_PAGES and dedupes by uuid", async () => {
    const first10 = load("pl-events-list.json").data.events.slice(0, 10);
    const routes: Record<string, FakeResponse> = {};
    for (let p = 1; p <= 50; p++) {
      routes[buildListUrl(PL, p)] = ok(listPage(first10, { total_pages: 50, current_page: p, items_count: 500, per_page: 100 }));
    }
    const f = fake(routes);
    const r = await fetchLeagueEvents(PL, f);
    expect(MAX_LIST_PAGES).toBe(10);
    expect(f.calls).toHaveLength(10);
    expect(f.calls).toEqual(Array.from({ length: 10 }, (_, i) => buildListUrl(PL, i + 1)));
    expect(r.error).toBeUndefined();
    expect(r.events).toHaveLength(10);
    expect(r.events.map((e) => e.uuid)).toEqual(first10.map((e: { uuid: string }) => e.uuid));
  });

  it("drops outrights, inactive events and other tournaments", async () => {
    const body = load("pl-events-list.json");
    body.data.events[0].type = "outright";
    body.data.events[1].status = "suspended";
    body.data.events[2].tournament_uuid = "033125c9-6c26-42b0-b7cf-43940dbeed5c";
    const f = fake({ [LIST_P1]: ok(body) });
    const r = await fetchLeagueEvents(PL, f);
    expect(r.error).toBeUndefined();
    expect(r.events).toHaveLength(17);
    expect(r.events.map((e) => e.uuid)).not.toContain("4a3c6a34-6adc-42b7-a9d1-0eaac374cf1b");
    expect(r.events.map((e) => e.uuid)).not.toContain("495716e5-fd45-43e5-8947-a0bf3ff676ab");
    expect(r.events.map((e) => e.uuid)).not.toContain("0e45932b-1433-4cf5-b658-5c308b7c2b60");
  });

  it("drops events without exactly two participants or with a malformed shape", async () => {
    const body = load("pl-events-list.json");
    body.data.events[0].participants = body.data.events[0].participants.slice(0, 1);
    delete body.data.events[1].participants;
    delete body.data.events[2].markets;
    body.data.events[3].uuid = null;
    body.data.events.push(null, "not an event");
    const r = await fetchLeagueEvents(PL, fake({ [LIST_P1]: ok(body) }));
    expect(r.error).toBeUndefined();
    expect(r.events).toHaveLength(16);
    expect(r.events[0].uuid).toBe("746f622d-b72c-4506-ba05-8f5cb30a1cb0");
  });

  it("reports HTTP errors with status and URL", async () => {
    const f = fake({ [LIST_P1]: { status: 404, contentType: "text/html; charset=utf-8", body: "<html>404</html>" } });
    expect(await fetchLeagueEvents(PL, f)).toEqual({ events: [], error: `HTTP 404 from ${LIST_P1}` });
  });

  it("checks the status before the content type and fails the whole list on a later page error", async () => {
    const all = load("pl-events-list.json").data.events;
    const page2 = buildListUrl(PL, 2);
    // page 2 is not routed, so it answers with the 404 JSON envelope
    const f = fake({ [LIST_P1]: ok(listPage(all.slice(0, 10), { total_pages: 2, current_page: 1, items_count: 20, per_page: 100 })) });
    expect(await fetchLeagueEvents(PL, f)).toEqual({ events: [], error: `HTTP 404 (not_found) from ${page2}` });
    expect(f.calls).toEqual([LIST_P1, page2]);
  });

  it("reports non-JSON bodies", async () => {
    const f = fake({ [LIST_P1]: { status: 200, contentType: "text/html; charset=utf-8", body: "<html>challenge</html>" } });
    expect((await fetchLeagueEvents(PL, f)).error).toBe(`Non-JSON response (HTTP 200, text/html; charset=utf-8) from ${LIST_P1}`);
  });

  it("reports network failures", async () => {
    const f: FetchJson = async () => {
      throw new Error("fetch failed");
    };
    expect((await fetchLeagueEvents(PL, f)).error).toBe(`Request failed: fetch failed (${LIST_P1})`);
  });

  it("reports malformed list payloads", async () => {
    const bodies = [
      { data: null, state: "error", _meta: null },
      { data: load("pl-events-list.json").data, state: "error", _meta: null }, // valid events under an error state
      { data: { events: "x" }, state: "success", _meta: null },
      "[]",
      null,
    ];
    for (const body of bodies) {
      expect(await fetchLeagueEvents(PL, fake({ [LIST_P1]: ok(body) }))).toEqual({ events: [], error: `Malformed list payload from ${LIST_P1}` });
    }
  });

  it("reports an empty category explicitly", async () => {
    const U = "00000000-0000-0000-0000-000000000000";
    const body = { data: { events: [] }, state: "success", _meta: { pagination: { total_pages: 1, current_page: 1, items_count: 0, per_page: 100 }, event_types: [] } };
    const r = await fetchLeagueEvents(U, fake({ [buildListUrl(U, 1)]: ok(body) }));
    expect(r.events).toEqual([]);
    expect(r.error).toBe("No prematch events for category 00000000-0000-0000-0000-000000000000 (items_count=0, event_types=[])");
  });

  it("reports a category whose events all belong elsewhere as empty", async () => {
    // A country-level UUID lists other tournaments: none of them may be kept.
    const ANGLIA = "033125c9-6c26-42b0-b7cf-43940dbeed5c";
    const r = await fetchLeagueEvents(ANGLIA, fake({ [buildListUrl(ANGLIA, 1)]: ok(load("pl-events-list.json")) }));
    expect(r.events).toEqual([]);
    expect(r.error).toBe(
      `No prematch events for category ${ANGLIA} (items_count=20, event_types=[{"count":20,"type":"prematch"},{"count":28,"type":"outright"}])`,
    );
  });
});

describe("totalbet api-client fetchEventDetail", () => {
  it("fetchEventDetail maps the 404 envelope to an error", async () => {
    const r = await fetchEventDetail("00000000-0000-0000-0000-000000000000", fake({}));
    expect(r).toEqual({ event: null, error: "HTTP 404 (not_found) from https://totalbet.pl/dealer/bdata/v1/bet/events/00000000-0000-0000-0000-000000000000" });
  });

  it("fetchEventDetail returns data.event on success", async () => {
    const base = detailBase();
    const event = { ...base, component_lists: [] };
    const f = fake({ [DETAIL_URL(base.uuid)]: ok({ data: { event }, state: "success", _meta: null }) });
    expect(await fetchEventDetail(base.uuid, f)).toEqual({ event });
    expect(f.calls).toEqual([DETAIL_URL(base.uuid)]);
  });

  it("fetchEventDetail rejects malformed payloads and a detail for another event", async () => {
    const base = detailBase();
    const requested = "495716e5-fd45-43e5-8947-a0bf3ff676ab";
    const url = DETAIL_URL(requested);
    const { type: _type, ...noType } = base;
    const { status: _status, ...noStatus } = base;
    const bodies = [
      { data: { event: { ...base, component_lists: [] } }, state: "success", _meta: null }, // uuid of another event
      { data: { event: { ...base, uuid: requested } }, state: "success", _meta: null }, // no component_lists
      { data: { event: null }, state: "success", _meta: null },
      { data: { event: { ...base, uuid: requested, component_lists: [] } }, state: "error", _meta: null },
      // a missing state is a schema problem, not a state change: it must stay loud
      { data: { event: { ...noType, uuid: requested, component_lists: [] } }, state: "success", _meta: null },
      { data: { event: { ...noStatus, uuid: requested, component_lists: [] } }, state: "success", _meta: null },
      { data: { event: { ...base, uuid: requested, type: null, component_lists: [] } }, state: "success", _meta: null },
      "{}",
    ];
    for (const body of bodies) {
      const r = await fetchEventDetail(requested, fake({ [url]: ok(body) }));
      expect(r).toEqual({ event: null, error: `Malformed detail payload from ${url}` });
      expect(r).not.toHaveProperty("notPrematch");
    }
  });

  it("fetchEventDetail accepts the prematch, active Leeds - Tottenham detail", async () => {
    const body = load("event-detail-leeds-tottenham.trimmed.json");
    const uuid = "0e45932b-1433-4cf5-b658-5c308b7c2b60";
    const r = await fetchEventDetail(uuid, fake({ [DETAIL_URL(uuid)]: ok(body) }));
    expect(r).toEqual({ event: body.data.event });
    expect(r.event!.component_lists).toHaveLength(35);
  });

  it("fetchEventDetail tags a detail that is no longer an active prematch event", async () => {
    // Kick-off can fall between the list call and the detail call: in-play prices must never pass as prematch odds.
    const uuid = "0e45932b-1433-4cf5-b658-5c308b7c2b60";
    const url = DETAIL_URL(uuid);
    const cases = [
      { type: "live", status: "active" },
      { type: "prematch", status: "suspended" },
      { type: "live", status: "suspended" },
      { type: "outright", status: "active" },
      { type: "Prematch", status: "active" }, // exact match, like the list filter
    ];
    for (const state of cases) {
      const body = load("event-detail-leeds-tottenham.trimmed.json");
      Object.assign(body.data.event, state);
      const r = await fetchEventDetail(uuid, fake({ [url]: ok(body) }));
      expect(r).toEqual({
        event: null,
        notPrematch: state,
        error: `Event ${uuid} is not an active prematch event (type=${state.type}, status=${state.status}) from ${url}`,
      });
    }
  });

  it("fetchEventDetail checks the event identity before its state", async () => {
    // A detail for another event is malformed even when that event is in play.
    const requested = "495716e5-fd45-43e5-8947-a0bf3ff676ab";
    const body = load("event-detail-leeds-tottenham.trimmed.json");
    body.data.event.type = "live";
    const url = DETAIL_URL(requested);
    expect(await fetchEventDetail(requested, fake({ [url]: ok(body) }))).toEqual({ event: null, error: `Malformed detail payload from ${url}` });
  });
});

describe("totalbet api-client URL helpers", () => {
  it("buildListUrl spells out every query parameter", () => {
    expect(buildListUrl(PL, 1)).toBe(LIST_P1);
    expect(buildListUrl(PL, 3)).toBe(LIST_P1.replace("page=1&", "page=3&"));
  });

  it("buildEventUrl and extractEventUuidFromUrl round-trip and reject legacy URLs", () => {
    const u = "0e45932b-1433-4cf5-b658-5c308b7c2b60";
    expect(buildEventUrl(u)).toBe(`https://totalbet.pl/event-details/${u}`);
    expect(extractEventUuidFromUrl(buildEventUrl(u))).toBe(u);
    expect(extractEventUuidFromUrl(`https://totalbet.pl/event-details/${u}?groupUUID=betbuilder`)).toBe(u);
    expect(extractEventUuidFromUrl("https://totalbet.pl/sports/event/123456")).toBeNull();
  });
});

describe("totalbet api-client nodeFetchJson", () => {
  it("nodeFetchJson parses JSON by content-type and passes a timeout signal", async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"ok":1}', { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", spy);
    expect(await nodeFetchJson("https://x.test/")).toEqual({ status: 200, contentType: "application/json", body: { ok: 1 } });
    const init = spy.mock.calls[0][1]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ Accept: "application/json" });
  });

  it("nodeFetchJson returns non-JSON bodies as text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>challenge</html>", { status: 403, headers: { "content-type": "text/html; charset=utf-8" } })));
    expect(await nodeFetchJson("https://x.test/")).toEqual({ status: 403, contentType: "text/html; charset=utf-8", body: "<html>challenge</html>" });
  });

  it("fetchLeagueEvents defaults to nodeFetchJson and reports an unparsable JSON body as a request failure", async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", spy);
    const r = await fetchLeagueEvents(PL);
    expect(spy.mock.calls.map((c) => c[0])).toEqual([LIST_P1]);
    expect(r.events).toEqual([]);
    expect(r.error).toMatch(/^Request failed: .+ \(https:\/\/totalbet\.pl\/dealer\/bdata\/v1\/bet\/events\?page=1&/);
    expect(r.error!.endsWith(`(${LIST_P1})`)).toBe(true);
  });
});
