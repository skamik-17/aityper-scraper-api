import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBookmakerLeagueId } from "../../../../config/leagues.js";
// Test-only cross-layer import: keeps the scraper's duplicated key list in sync with the normalizer.
import { TOTALBET_MARKET_KEY_TO_CODE } from "../../../../services/normalization/bookmakers/totalbet-normalizer.js";
import { PlaywrightScraper } from "../../../base/playwright-base.js";
import type { FetchJson } from "../api-client.js";
import { DETAIL_DELAY_MS, PHASE1_MARKET_KEYS } from "../constants.js";
import { TotalbetPlaywrightScraper } from "../index.js";

const load = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const PL = "8793bb6a-4684-44ba-b92e-4d896e6cbfbf";
const LIST_P1 = `https://totalbet.pl/dealer/bdata/v1/bet/events?page=1&per_page=100&category_uuid=${PL}&category_type=sport&type=standard`;
const DETAIL_PREFIX = "https://totalbet.pl/dealer/bdata/v1/bet/events/";
const EVERTON = "495716e5-fd45-43e5-8947-a0bf3ff676ab";
const LEEDS = "0e45932b-1433-4cf5-b658-5c308b7c2b60";
const CP = "f91beb39-9b93-4b91-a3b1-a1063efec44d";
const LIST_UUIDS: string[] = load("pl-events-list.json").data.events.map((e: { uuid: string }) => e.uuid);

type FakeResponse = Awaited<ReturnType<FetchJson>>;
const json = (status: number, body: unknown): FakeResponse => ({ status, contentType: "application/json", body });

// List page 1 -> pl-events-list.json (or `list`); detail of Leeds -> Leeds trimmed; detail of Crystal Palace ->
// Crystal Palace core; overrides replace a detail body by event uuid; anything else -> the 404 envelope.
function fakeWith(overrides: Record<string, unknown>, list: unknown = load("pl-events-list.json")): FetchJson & { calls: string[] } {
  const details: Record<string, unknown> = {
    [LEEDS]: load("event-detail-leeds-tottenham.trimmed.json"),
    [CP]: load("event-detail-crystal-palace-liverpool.core.json"),
    ...overrides,
  };
  const calls: string[] = [];
  const fetchJson: FetchJson = async (url) => {
    calls.push(url);
    if (url === LIST_P1) return json(200, list);
    const body = url.startsWith(DETAIL_PREFIX) ? details[url.slice(DETAIL_PREFIX.length)] : undefined;
    return body === undefined ? json(404, load("event-not-found.json")) : json(200, body);
  };
  return Object.assign(fetchJson, { calls });
}

// A copy of a detail fixture with its event patched; the loaded fixture is never shared.
function detailWith(name: string, patch: (event: any) => void) {
  const body = load(name);
  patch(body.data.event);
  return body;
}

const f = fakeWith({});
const scraper = new TotalbetPlaywrightScraper(undefined, { fetchJson: f, detailDelayMs: 0 });

beforeEach(() => {
  // The scraper logs one line per match; keep the test output clean.
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
  // Never open a browser or reach a bookmaker from a unit test, whatever the code under test does.
  vi.spyOn(PlaywrightScraper.prototype as any, "initBrowser").mockRejectedValue(new Error("browser disabled in unit tests"));
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("network disabled in unit tests");
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("totalbet scraper (plan contract)", () => {
  it("totalbet full offer returns 20 matches without a browser", async () => {
    const spy = vi.spyOn(PlaywrightScraper.prototype as any, "initBrowser");
    const r = await scraper.scrapeFullOffer("premier-league");
    expect(r.success).toBe(true); expect(r.matches).toHaveLength(20); expect(spy).not.toHaveBeenCalled();
    const leeds = r.matches.find((m) => m.matchId === "0e45932b-1433-4cf5-b658-5c308b7c2b60")!;
    expect(leeds).toMatchObject({ homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", startTime: "2026-11-07T12:30:00Z",
      eventUrl: "https://totalbet.pl/event-details/0e45932b-1433-4cf5-b658-5c308b7c2b60" });
    expect(leeds.markets).toHaveLength(102);
    expect(r.matches.find((m) => m.matchId === "f91beb39-9b93-4b91-a3b1-a1063efec44d")!).toMatchObject({ homeTeam: "Crystal Palace" });
    // 18 of 20 details answer 404 in this fake; the first listed event is Everton-Coventry
    expect(r.error).toContain("Detail fetch failed for 18/20 events (first: HTTP 404 (not_found) from https://totalbet.pl/dealer/bdata/v1/bet/events/495716e5-fd45-43e5-8947-a0bf3ff676ab)");
    // the Crystal Palace core fixture keeps market_count 385 but only 6 components
    expect(r.error).toMatch(/phase-1 keys missing for Crystal Palace vs Liverpool: mid:29,.*slug:2_poaowa_dokaadny_wynik/);
    expect(r.error).not.toContain("for Leeds United vs Tottenham Hotspur");
  });

  it("totalbet fails the run when every detail fails", async () => {
    const listOnly: FetchJson = async (url) => url.includes("/events?") ? { status: 200, contentType: "application/json", body: load("pl-events-list.json") }
      : { status: 404, contentType: "application/json", body: load("event-not-found.json") };
    const r = await new TotalbetPlaywrightScraper(undefined, { fetchJson: listOnly, detailDelayMs: 0 }).scrapeFullOffer("premier-league");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/^Detail fetch failed for 20\/20 events \(first: HTTP 404 \(not_found\) from /);
  });

  it("totalbet flags missing phase-1 keys on large events", async () => {
    const leeds = load("event-detail-leeds-tottenham.trimmed.json");
    const noSuma = { ...leeds, data: { event: { ...leeds.data.event, component_lists: leeds.data.event.component_lists.filter((c: any) => c.slug !== "suma") } } };
    const warn = vi.spyOn(console, "warn");
    // same fake as above, but the Leeds detail without the "suma" component (market_count stays 439)
    const r = await new TotalbetPlaywrightScraper(undefined, { fetchJson: fakeWith({ "0e45932b-1433-4cf5-b658-5c308b7c2b60": noSuma }), detailDelayMs: 0 }).scrapeFullOffer("premier-league");
    expect(r.error).toContain("phase-1 keys missing for Leeds United vs Tottenham Hotspur: slug:suma");
    expect(warn).toHaveBeenCalledWith("[Totalbet/FullOffer] phase-1 keys missing for Leeds United vs Tottenham Hotspur: slug:suma");
    warn.mockRestore();
  });

  it("totalbet PHASE1_MARKET_KEYS matches the normalizer key table", () =>
    expect([...PHASE1_MARKET_KEYS]).toEqual(Object.keys(TOTALBET_MARKET_KEY_TO_CODE)));

  it("totalbet falls back to the list 1X2 when a detail fails", async () => {
    const ev = (await scraper.scrapeFullOffer("premier-league")).matches.find((m) => m.matchId === "495716e5-fd45-43e5-8947-a0bf3ff676ab")!;
    expect(ev.markets.map((m) => [m.name, m.selections.map((s) => s.odds)])).toEqual([["Wynik meczu", [1.65, 3.95, 4.9]]]);
  });

  it("totalbet surfaces the real list error", async () => {
    const s = new TotalbetPlaywrightScraper(undefined, { fetchJson: async () => ({ status: 404, contentType: "text/html", body: "x" }), detailDelayMs: 0 });
    expect(await s.scrapeFullOffer("premier-league")).toMatchObject({ success: false,
      error: "HTTP 404 from https://totalbet.pl/dealer/bdata/v1/bet/events?page=1&per_page=100&category_uuid=8793bb6a-4684-44ba-b92e-4d896e6cbfbf&category_type=sport&type=standard" });
  });

  it("totalbet rejects leagues without a UUID", async () =>
    expect(await scraper.scrapeFullOffer("bundesliga")).toMatchObject({ success: false, error: "Unknown league: bundesliga" }));

  it("totalbet scrapeLeague returns list 1X2 rows", async () => {
    const r = await scraper.scrapeLeague("premier-league");
    expect(r.status).toBe("success"); expect(r.data).toHaveLength(20);
    expect(r.data![0]).toMatchObject({ homeTeam: "Everton", awayTeam: "Coventry City", homeOdds: 1.65, drawOdds: 3.95, awayOdds: 4.9,
      eventUrl: "https://totalbet.pl/event-details/495716e5-fd45-43e5-8947-a0bf3ff676ab" });
  });

  it("totalbet scrapeMatchDetails reads 1X2 from the detail", async () => {
    const r = await scraper.scrapeMatchDetails("https://totalbet.pl/event-details/0e45932b-1433-4cf5-b658-5c308b7c2b60");
    expect(r.data!.market1X2).toEqual({ home: 2.8, draw: 3.35, away: 2.47 });
    // A URL without an event UUID is refused before any request, not fetched and failed.
    expect(await scraper.scrapeMatchDetails("https://totalbet.pl/sports/event/1")).toMatchObject({ status: "not_found", error: "Invalid Totalbet event URL" });
  });

  it("totalbet league config carries the category UUIDs", () => {
    expect(Object.fromEntries(["ekstraklasa", "premier-league", "laliga", "serie-a", "ligue-1", "world-cup-2026"].map((s) => [s, getBookmakerLeagueId(s, "totalbet")]))).toEqual({
      ekstraklasa: "ae7d4621-313d-4df6-b3be-046b76a32938", "premier-league": "8793bb6a-4684-44ba-b92e-4d896e6cbfbf",
      laliga: "cfb6428c-c437-4923-a370-562871d06316", "serie-a": "0253b9f3-ab3b-4d19-ab4e-87aa8c3adb8e",
      "ligue-1": "f64248fd-8f4a-499f-8092-3408cecf2565", "world-cup-2026": "298d1945-aed7-4b43-ba39-3dbc23a59cd0" });
  });
});

describe("totalbet scraper (wiring and integrity guards)", () => {
  it("totalbet requests the list once, then each detail in list order", async () => {
    const fake = fakeWith({});
    await new TotalbetPlaywrightScraper(undefined, { fetchJson: fake, detailDelayMs: 0 }).scrapeFullOffer("premier-league");
    expect(fake.calls).toEqual([LIST_P1, ...LIST_UUIDS.map((uuid) => `${DETAIL_PREFIX}${uuid}`)]);
  });

  it("totalbet pauses DETAIL_DELAY_MS after every detail request by default", async () => {
    const delay = vi.spyOn(PlaywrightScraper.prototype as any, "delay").mockResolvedValue(undefined);
    await new TotalbetPlaywrightScraper(undefined, { fetchJson: fakeWith({}) }).scrapeFullOffer("premier-league");
    expect(delay).toHaveBeenCalledTimes(20);
    expect(new Set(delay.mock.calls.map(([ms]) => ms))).toEqual(new Set([DETAIL_DELAY_MS]));
  });

  it("totalbet defaults to Node fetch when no FetchJson is injected", async () => {
    const fetchSpy = vi.fn(async () => new Response("x", { status: 404, headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await new TotalbetPlaywrightScraper().scrapeFullOffer("premier-league")).toMatchObject({ success: false, error: `HTTP 404 from ${LIST_P1}` });
    expect(console.warn).toHaveBeenCalledWith(`[Totalbet/FullOffer] premier-league failed: HTTP 404 from ${LIST_P1}`);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(LIST_P1, expect.anything());
  });

  it("totalbet logs the listed count and one line per match", async () => {
    await scraper.scrapeFullOffer("premier-league");
    expect(console.log).toHaveBeenCalledWith("[Totalbet/FullOffer] Found 20 prematch events for premier-league");
    expect(console.log).toHaveBeenCalledWith("[Totalbet/FullOffer] Leeds United vs Tottenham Hotspur: 102 markets (market_count 439)");
    expect(console.log).toHaveBeenCalledWith("[Totalbet/FullOffer] Everton vs Coventry City: 1 markets (market_count 488)");
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/^\[Totalbet\/FullOffer\] Detail fetch failed for 18\/20 events \(first: HTTP 404/));
  });

  it("totalbet logs the detail's market_count when the detail answered, the list's otherwise", async () => {
    // The list says 439 for Leeds; the detail, fetched later, is the payload the markets were parsed from.
    const grown = detailWith("event-detail-leeds-tottenham.trimmed.json", (e) => { e.market_count = 441; });
    await new TotalbetPlaywrightScraper(undefined, { fetchJson: fakeWith({ [LEEDS]: grown }), detailDelayMs: 0 }).scrapeFullOffer("premier-league");
    expect(console.log).toHaveBeenCalledWith("[Totalbet/FullOffer] Leeds United vs Tottenham Hotspur: 102 markets (market_count 441)");
    expect(console.log).not.toHaveBeenCalledWith("[Totalbet/FullOffer] Leeds United vs Tottenham Hotspur: 102 markets (market_count 439)");
    // Everton's detail 404s, so only the list event's count is known
    expect(console.log).toHaveBeenCalledWith("[Totalbet/FullOffer] Everton vs Coventry City: 1 markets (market_count 488)");
  });

  it("totalbet keeps a run with every detail OK free of errors", async () => {
    const leeds = load("event-detail-leeds-tottenham.trimmed.json");
    const list = load("pl-events-list.json");
    list.data.events = list.data.events.filter((e: { uuid: string }) => e.uuid === LEEDS);
    const r = await new TotalbetPlaywrightScraper(undefined, { fetchJson: fakeWith({ [LEEDS]: leeds }, list), detailDelayMs: 0 }).scrapeFullOffer("premier-league");
    expect(r.success).toBe(true);
    expect(r.matches).toHaveLength(1);
    expect(r.error).toBeUndefined();
  });

  it.each([
    ["live", "active"],
    ["prematch", "suspended"],
  ])("totalbet skips an event whose detail turned %s/%s, without fallback or failure count", async (type, status) => {
    const turned = detailWith("event-detail-leeds-tottenham.trimmed.json", (e) => Object.assign(e, { type, status }));
    const r = await new TotalbetPlaywrightScraper(undefined, { fetchJson: fakeWith({ [LEEDS]: turned }), detailDelayMs: 0 }).scrapeFullOffer("premier-league");
    expect(r.matches.map((m) => m.matchId)).not.toContain(LEEDS);
    expect(r.matches).toHaveLength(19);
    expect(r.success).toBe(true);
    expect(r.error).toContain("Detail fetch failed for 18/19 events");
    expect(r.error).not.toContain(LEEDS);
    expect(r.error).not.toContain("Leeds United");
    expect(console.log).toHaveBeenCalledWith(`[Totalbet/FullOffer] skipped Leeds United vs Tottenham Hotspur: detail is ${type}/${status}`);
  });

  it("totalbet fails the run when the only reachable detail went live", async () => {
    const live = detailWith("event-detail-leeds-tottenham.trimmed.json", (e) => Object.assign(e, { type: "live" }));
    // Crystal Palace answers 404 like the other 18
    const fake = fakeWith({ [LEEDS]: live, [CP]: undefined });
    const r = await new TotalbetPlaywrightScraper(undefined, { fetchJson: fake, detailDelayMs: 0 }).scrapeFullOffer("premier-league");
    // 19 list-1X2 fallbacks remain, but no detail answered: an outage, not a healthy run
    expect(r.matches).toHaveLength(19);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/^Detail fetch failed for 19\/19 events /);
    // a failed run also says which events were skipped as no longer prematch
    expect(r.error).toContain(
      `Skipped 1 not-prematch events (first: Event ${LEEDS} is not an active prematch event (type=live, status=active) from ${DETAIL_PREFIX}${LEEDS})`,
    );
  });

  it("totalbet names the not-prematch skips when no event is left", async () => {
    // Every reachable detail turned live (a run that starts at a shared kick-off, or detail state drift):
    // the error must say why instead of a bare "No parsable Totalbet events".
    const list = load("pl-events-list.json");
    list.data.events = list.data.events.filter((e: { uuid: string }) => e.uuid === LEEDS || e.uuid === CP);
    const live = (name: string) => detailWith(name, (e) => Object.assign(e, { type: "live" }));
    const fake = fakeWith({ [LEEDS]: live("event-detail-leeds-tottenham.trimmed.json"), [CP]: live("event-detail-crystal-palace-liverpool.core.json") }, list);
    const r = await new TotalbetPlaywrightScraper(undefined, { fetchJson: fake, detailDelayMs: 0 }).scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: false, matches: [] });
    expect(r.error).toBe(
      "No parsable Totalbet events for premier-league | " +
        `Skipped 2 not-prematch events (first: Event ${LEEDS} is not an active prematch event (type=live, status=active) from ${DETAIL_PREFIX}${LEEDS})`,
    );
    expect(console.warn).toHaveBeenCalledWith(`[Totalbet/FullOffer] premier-league failed: ${r.error}`);
  });

  it("totalbet skips an event whose detail has no active market, without the list fallback", async () => {
    const closed = detailWith("event-detail-leeds-tottenham.trimmed.json", (e) => {
      for (const c of e.component_lists) for (const row of c.grid) for (const cell of row) if (cell.type === "outcome") cell.outcome_status = "suspended";
    });
    const r = await new TotalbetPlaywrightScraper(undefined, { fetchJson: fakeWith({ [LEEDS]: closed }), detailDelayMs: 0 }).scrapeFullOffer("premier-league");
    // the detail answered, so the list 1X2 (possibly stale) is not used and the detail is not a failure
    expect(r.matches.map((m) => m.matchId)).not.toContain(LEEDS);
    expect(r.matches).toHaveLength(19);
    expect(r.error).toContain("Detail fetch failed for 18/20 events");
    expect(console.warn).toHaveBeenCalledWith("[Totalbet/FullOffer] skipped Leeds United vs Tottenham Hotspur: no active market");
  });

  it("totalbet reports zero parsable events with the detail diagnostics", async () => {
    const list = load("pl-events-list.json");
    for (const e of list.data.events) e.markets[0].status = "suspended";
    const r = await new TotalbetPlaywrightScraper(undefined, { fetchJson: fakeWith({ [LEEDS]: undefined, [CP]: undefined }, list), detailDelayMs: 0 })
      .scrapeFullOffer("premier-league");
    expect(r).toMatchObject({ success: false, matches: [] });
    expect(r.error).toMatch(/^No parsable Totalbet events for premier-league \| Detail fetch failed for 20\/20 events \(first: HTTP 404/);
    expect(console.warn).toHaveBeenCalledWith(`[Totalbet/FullOffer] premier-league failed: ${r.error}`);
  });

  it("totalbet skips the drift check below PHASE1_CHECK_MIN_MARKETS", async () => {
    const small = detailWith("event-detail-crystal-palace-liverpool.core.json", (e) => { e.market_count = 149; });
    const r = await new TotalbetPlaywrightScraper(undefined, { fetchJson: fakeWith({ [CP]: small }), detailDelayMs: 0 }).scrapeFullOffer("premier-league");
    expect(r.error).not.toContain("phase-1 keys missing");
    const atThreshold = detailWith("event-detail-crystal-palace-liverpool.core.json", (e) => { e.market_count = 150; });
    const r2 = await new TotalbetPlaywrightScraper(undefined, { fetchJson: fakeWith({ [CP]: atThreshold }), detailDelayMs: 0 }).scrapeFullOffer("premier-league");
    expect(r2.error).toContain("phase-1 keys missing for Crystal Palace vs Liverpool");
  });

  it("totalbet reads the drift keys before status filtering and from column headers", async () => {
    const suspendedSuma = detailWith("event-detail-leeds-tottenham.trimmed.json", (e) => {
      for (const row of e.component_lists.find((c: any) => c.slug === "suma").grid) {
        for (const cell of row) if (cell.type === "outcome") cell.market_status = "suspended";
      }
    });
    const r = await new TotalbetPlaywrightScraper(undefined, { fetchJson: fakeWith({ [LEEDS]: suspendedSuma }), detailDelayMs: 0 }).scrapeFullOffer("premier-league");
    expect(r.matches.find((m) => m.matchId === LEEDS)!.markets.some((m) => m.bookmakerMarketId === "slug:suma")).toBe(false);
    expect(r.error).not.toContain("for Leeds United vs Tottenham Hotspur");

    const noDcId = detailWith("event-detail-leeds-tottenham.trimmed.json", (e) => {
      const dc = e.component_lists.find((c: any) => c.type === "markets_in_columns" && c.grid[0].some((h: any) => h.market_id === "10"));
      for (const head of dc.grid[0]) if (head.market_id === "10") delete head.market_id;
    });
    const r2 = await new TotalbetPlaywrightScraper(undefined, { fetchJson: fakeWith({ [LEEDS]: noDcId }), detailDelayMs: 0 }).scrapeFullOffer("premier-league");
    expect(r2.error).toContain("phase-1 keys missing for Leeds United vs Tottenham Hotspur: mid:10");
  });

  it("totalbet scrapeLeague drops an event whose 1X2 outcome names do not match its participants", async () => {
    const list = load("pl-events-list.json");
    const [home, , away] = list.data.events[0].markets[0].outcomes;
    [home.name, away.name] = [away.name, home.name];
    const r = await new TotalbetPlaywrightScraper(undefined, { fetchJson: fakeWith({}, list), detailDelayMs: 0 }).scrapeLeague("premier-league");
    expect(r.status).toBe("success");
    expect(r.data).toHaveLength(19);
    expect(r.data!.map((m) => m.eventUrl)).not.toContain(`https://totalbet.pl/event-details/${EVERTON}`);
  });

  it("totalbet scrapeLeague reports unknown leagues and list errors", async () => {
    expect(await scraper.scrapeLeague("bundesliga")).toMatchObject({ status: "not_found", error: "Unknown league: bundesliga" });
    const down = new TotalbetPlaywrightScraper(undefined, { fetchJson: async () => ({ status: 404, contentType: "text/html", body: "x" }), detailDelayMs: 0 });
    expect(await down.scrapeLeague("premier-league")).toMatchObject({ status: "error", error: `HTTP 404 from ${LIST_P1}` });
  });

  it("totalbet scrapeMatch finds one event from the list", async () => {
    const r = await scraper.scrapeMatch({ homeTeam: "Leeds United", awayTeam: "Tottenham Hotspur", leagueId: "premier-league" });
    expect(r.status).toBe("success");
    expect(r.data).toHaveLength(1);
    expect(r.data![0]).toMatchObject({ homeOdds: 2.8, drawOdds: 3.35, awayOdds: 2.47, eventUrl: `https://totalbet.pl/event-details/${LEEDS}` });
  });

  it("totalbet scrapeMatchDetails reports detail errors and refuses a misoriented 1X2", async () => {
    expect(await scraper.scrapeMatchDetails(`https://totalbet.pl/event-details/${EVERTON}`)).toMatchObject({
      status: "error", error: `HTTP 404 (not_found) from ${DETAIL_PREFIX}${EVERTON}` });

    const live = detailWith("event-detail-leeds-tottenham.trimmed.json", (e) => { e.type = "live"; });
    const liveScraper = new TotalbetPlaywrightScraper(undefined, { fetchJson: fakeWith({ [LEEDS]: live }), detailDelayMs: 0 });
    expect(await liveScraper.scrapeMatchDetails(`https://totalbet.pl/event-details/${LEEDS}`)).toMatchObject({ status: "not_found" });

    const swapped = detailWith("event-detail-leeds-tottenham.trimmed.json", (e) => {
      const grid = e.component_lists.find((c: any) => c.name === "Wynik meczu").grid;
      [grid[0], grid[2]] = [grid[2], grid[0]];
    });
    const swappedScraper = new TotalbetPlaywrightScraper(undefined, { fetchJson: fakeWith({ [LEEDS]: swapped }), detailDelayMs: 0 });
    const r = await swappedScraper.scrapeMatchDetails(`https://totalbet.pl/event-details/${LEEDS}`);
    expect(r.status).not.toBe("success");
    expect(r.data).toBeUndefined();

    // two id-less "Wynik meczu" markets with different prices: ambiguous, so no 1X2 at all
    const twice = detailWith("event-detail-leeds-tottenham.trimmed.json", (e) => {
      const copy = structuredClone(e.component_lists.find((c: any) => c.name === "Wynik meczu"));
      for (const row of copy.grid) for (const cell of row) if (cell.type === "outcome") Object.assign(cell, { market_uuid: "copy", odds: "9.00" });
      e.component_lists.push(copy);
    });
    const twiceScraper = new TotalbetPlaywrightScraper(undefined, { fetchJson: fakeWith({ [LEEDS]: twice }), detailDelayMs: 0 });
    expect((await twiceScraper.scrapeMatchDetails(`https://totalbet.pl/event-details/${LEEDS}`)).status).not.toBe("success");
  });
});
