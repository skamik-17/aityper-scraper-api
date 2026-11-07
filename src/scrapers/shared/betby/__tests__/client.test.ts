import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BETBY_BRANDS } from "../brands.js";
import { BetbyClient } from "../client.js";
import { BetbyHttpError } from "../http.js";
import type { FetchText } from "../types.js";
import { createEvidenceFetch } from "./fake-fetch.js";
import { loadJson, loadText } from "./fixtures.js";

const BETTERS_SNAPSHOT_PATH = "/prematch/brand/2658970707769307140/pl/";
const isDiscoveryCall = (u: string) => u.includes("share/bootstrap") || u.includes("bt-renderer.min.js");

/** A betters chunk from the trimmed snapshot, re-served with some fields changed. */
function bettersChunkWith(requestedVersion: number, patch: Record<string, unknown>): string {
  const chunks = loadJson("betters", "snapshot-trimmed.json").chunks as { requestedVersion: number }[];
  return JSON.stringify({ ...chunks.find((c) => c.requestedVersion === requestedVersion), ...patch });
}

describe("BetbyClient", () => {
  // The client warns through console.warn by default; keep the expected retry lines out of the test output.
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchSnapshot merges all 7 betters chunks", async () => {
    const f = createEvidenceFetch("betters"); const c = new BetbyClient(BETBY_BRANDS.betters, { fetchText: f, now: () => 0 });
    const s = await c.fetchSnapshot();
    expect(s.manifestVersion).toBe(1793982002415);
    expect(Object.keys(s.events)).toHaveLength(58);
    expect(s.tournaments["1669818860469096448"].name).toBe("Premier League");
    expect(f.calls.filter((u) => u.includes("/prematch/brand/2658970707769307140/pl/"))).toHaveLength(8);
  });

  it("fetchSnapshot retries with a fresh manifest when a chunk comes back rotated", async () => {
    const f = createEvidenceFetch("betters", { overridesOnce: { "/pl/1793982002420": loadText("betters", "chunk-rotated-1793981941985.json") } });
    const s = await new BetbyClient(BETBY_BRANDS.betters, { fetchText: f, now: () => 0 }).fetchSnapshot();
    expect(s.manifestVersion).toBe(1793982002415);
    expect(f.calls.filter((u) => u.endsWith("/pl/0"))).toHaveLength(2);
  });

  it("fetchSnapshot throws after two rotated attempts", async () => {
    const f = createEvidenceFetch("betters", { overrides: { "/pl/1793982002420": loadText("betters", "chunk-rotated-1793981941985.json") } });
    await expect(new BetbyClient(BETBY_BRANDS.betters, { fetchText: f }).fetchSnapshot())
      .rejects.toThrow(/snapshot incomplete after 2 attempts \(chunk 1793982002420 rotated/);
  });

  it("fetchSnapshot is cached for 45 s", async () => {
    let t = 0;
    const f = createEvidenceFetch("betters"); const c = new BetbyClient(BETBY_BRANDS.betters, { fetchText: f, now: () => t });
    const snapshotCalls = () => f.calls.filter((u) => u.includes("/prematch/brand/2658970707769307140/pl/")).length;
    await c.fetchSnapshot(); t = 44_000; await c.fetchSnapshot();
    expect(snapshotCalls()).toBe(8); // 1 manifest + 7 chunks; f.calls also holds the 2 discovery calls
    t = 46_000; await c.fetchSnapshot();
    expect(snapshotCalls()).toBe(16);
  });

  it("fetchSnapshot error names host, path and status", async () => {
    const c = new BetbyClient(BETBY_BRANDS.betters, { fetchText: createEvidenceFetch("betters", { failures: { "/pl/0": 404 } }) });
    await expect(c.fetchSnapshot()).rejects.toThrow("HTTP 404 from api-h-c7818b61-608.sptpub.com/api/v4/prematch/brand/2658970707769307140/pl/0");
  });

  it("fetchEvent returns the raw event", async () => {
    const c = new BetbyClient(BETBY_BRANDS.betters, { fetchText: createEvidenceFetch("betters") });
    expect((await c.fetchEvent("2725816334213586962"))!.desc.competitors[1].name).toBe("Tottenham Hotspur ");
  });

  it("fetchEvent returns null when the 200 envelope has no events", async () => {
    // Everton-Coventry has no event-<id>.json, so the fake serves event-missing-envelope.json with HTTP 200 (live behaviour)
    const c = new BetbyClient(BETBY_BRANDS.betters, { fetchText: createEvidenceFetch("betters") });
    await expect(c.fetchEvent("2725815896848338956")).resolves.toBeNull();
  });

  it("fetchEvent returns null on HTTP 404", async () => {
    const f = createEvidenceFetch("betters", { failures: { "/event/pl/2725816334213586962": 404 } });
    await expect(new BetbyClient(BETBY_BRANDS.betters, { fetchText: f }).fetchEvent("2725816334213586962")).resolves.toBeNull();
  });

  it("lebull client talks to the v5 proxy", async () => {
    const f = createEvidenceFetch("lebull");
    const s = await new BetbyClient(BETBY_BRANDS.lebull, { fetchText: f, now: () => 0 }).fetchSnapshot();
    expect(f.calls).toContain("https://betting-betby-secundus.prod.sbteam.xyz/v5/prematch/brand/2694137186776920067/pl/0");
    expect(s.manifestVersion).toBe(1793981968429);
    expect(s.tournaments["1669818860469096448"].slug).toBe("premier-league");
  });

  it("fetchDescriptions is cached for 6 h", async () => {
    let t = 0;
    const f = createEvidenceFetch("betters"); const c = new BetbyClient(BETBY_BRANDS.betters, { fetchText: f, now: () => t });
    const descCalls = () => f.calls.filter((u) => u.includes("/descriptions/brand/2658970707769307140/markets/pl")).length;
    expect((await c.fetchDescriptions())["1"].name).toBe("1x2");
    t = 21_599_000; await c.fetchDescriptions();
    expect(descCalls()).toBe(1);
    t = 21_601_000; await c.fetchDescriptions();
    expect(descCalls()).toBe(2);
  });

  // Behaviour the brief specifies beyond its verbatim tests.

  it("fetchSnapshot retries when the manifest lists no chunk versions, and names it after two attempts", async () => {
    // A manifest caught mid-rotation would look like a rotated chunk: `{version: 0}` and no version lists.
    const rotatedManifest = JSON.stringify({ epoch: 1792668537738, version: 0, generated: 1793982004356 });
    const once = createEvidenceFetch("betters", { overridesOnce: { "/pl/0": rotatedManifest } });
    const s = await new BetbyClient(BETBY_BRANDS.betters, { fetchText: once, now: () => 0 }).fetchSnapshot();
    expect(s.manifestVersion).toBe(1793982002415);
    expect(Object.keys(s.events)).toHaveLength(58);
    expect(once.calls.filter((u) => u.endsWith("/pl/0"))).toHaveLength(2);

    const always = createEvidenceFetch("betters", { overrides: { "/pl/0": rotatedManifest } });
    await expect(new BetbyClient(BETBY_BRANDS.betters, { fetchText: always }).fetchSnapshot())
      .rejects.toThrow("Betby betters: snapshot incomplete after 2 attempts (manifest 0 lists no chunk versions)");
    expect(always.calls.filter((u) => u.includes(BETTERS_SNAPSHOT_PATH))).toHaveLength(2); // no chunk is requested
  });

  it("fetchSnapshot rejects a broken chunk chain and an incomplete last chunk", async () => {
    const f = createEvidenceFetch("betters", {
      overrides: {
        "/pl/1793982002417": bettersChunkWith(1793982002417, { version: 1793982002999 }),
        "/pl/1793982002421": bettersChunkWith(1793982002421, { snapshot_complete: false }),
      },
    });
    await expect(new BetbyClient(BETBY_BRANDS.betters, { fetchText: f }).fetchSnapshot()).rejects.toThrow(
      "Betby betters: snapshot incomplete after 2 attempts (chunk 1793982002417 points to 1793982002999; last chunk 1793982002421 not complete)",
    );
    expect(f.calls.filter((u) => u.includes(BETTERS_SNAPSHOT_PATH))).toHaveLength(16);
  });

  it("fetchSnapshot warns once with the brand tag before it retries, and not on a clean snapshot", async () => {
    const warn = vi.fn();
    const f = createEvidenceFetch("betters", { overridesOnce: { "/pl/1793982002420": loadText("betters", "chunk-rotated-1793981941985.json") } });
    await new BetbyClient(BETBY_BRANDS.betters, { fetchText: f, now: () => 0, warn }).fetchSnapshot();
    expect(warn.mock.calls).toEqual([
      ["[Betby/Betters] snapshot attempt 1/2 incomplete (chunk 1793982002420 rotated); retrying with a fresh manifest"],
    ]);

    const quiet = vi.fn();
    await new BetbyClient(BETBY_BRANDS.lebull, { fetchText: createEvidenceFetch("lebull"), now: () => 0, warn: quiet }).fetchSnapshot();
    expect(quiet).not.toHaveBeenCalled();
  });

  it("a failed snapshot is not cached: the next call fetches again", async () => {
    const evidence = createEvidenceFetch("betters");
    let failNextManifest = true;
    const f: FetchText = async (url) => {
      if (failNextManifest && url.endsWith("/pl/0")) {
        failNextManifest = false;
        throw new BetbyHttpError(503, url);
      }
      return evidence(url);
    };
    const c = new BetbyClient(BETBY_BRANDS.betters, { fetchText: f, now: () => 0 });
    await expect(c.fetchSnapshot()).rejects.toThrow("HTTP 503 from api-h-c7818b61-608.sptpub.com/api/v4/prematch/brand/2658970707769307140/pl/0");
    expect(Object.keys((await c.fetchSnapshot()).events)).toHaveLength(58);
  });

  it("concurrent calls share one discovery, one snapshot fetch and one descriptions fetch", async () => {
    const f = createEvidenceFetch("betters");
    const c = new BetbyClient(BETBY_BRANDS.betters, { fetchText: f, now: () => 0 });
    const [a, b] = await Promise.all([c.fetchSnapshot(), c.fetchSnapshot(), c.fetchDescriptions(), c.fetchDescriptions()]);
    expect(a).toBe(b);
    expect(f.calls.filter(isDiscoveryCall)).toHaveLength(2);
    expect(f.calls.filter((u) => u.includes(BETTERS_SNAPSHOT_PATH))).toHaveLength(8);
    expect(f.calls.filter((u) => u.includes("/descriptions/brand/"))).toHaveLength(1);
  });

  it("getEndpoints resolves once per 6 h and is shared by every request", async () => {
    let t = 0;
    const f = createEvidenceFetch("betters");
    const c = new BetbyClient(BETBY_BRANDS.betters, { fetchText: f, now: () => t });
    expect(await c.getEndpoints()).toEqual(BETBY_BRANDS.betters.pinned);
    await c.fetchSnapshot(); await c.fetchEvent("2725816334213586962"); await c.fetchDescriptions();
    t = 21_599_000; await c.getEndpoints();
    expect(f.calls.filter(isDiscoveryCall)).toHaveLength(2);
    t = 21_601_000; await c.getEndpoints();
    expect(f.calls.filter(isDiscoveryCall)).toHaveLength(4);
  });

  it("fetchEvent returns null when the envelope's events lack the requested id", async () => {
    const f = createEvidenceFetch("betters", { overrides: { "/event/pl/2725816334213586981": loadText("betters", "event-2725816334213586962.json") } });
    await expect(new BetbyClient(BETBY_BRANDS.betters, { fetchText: f }).fetchEvent("2725816334213586981")).resolves.toBeNull();
  });

  it("fetchEvent propagates HTTP errors other than 404", async () => {
    const f = createEvidenceFetch("betters", { failures: { "/event/pl/2725816334213586962": 503 } });
    await expect(new BetbyClient(BETBY_BRANDS.betters, { fetchText: f }).fetchEvent("2725816334213586962")).rejects.toThrow(
      "HTTP 503 from api-h-c7818b61-608.sptpub.com/api/v4/prematch/brand/2658970707769307140/event/pl/2725816334213586962",
    );
  });

  it("a body that is not JSON, or descriptions that are not an object, name the endpoint", async () => {
    const html = createEvidenceFetch("betters", { overrides: { "/pl/0": "<!DOCTYPE html><title>Maintenance</title>" } });
    await expect(new BetbyClient(BETBY_BRANDS.betters, { fetchText: html }).fetchSnapshot()).rejects.toThrow(
      /^Betby invalid JSON from api-h-c7818b61-608\.sptpub\.com\/api\/v4\/prematch\/brand\/2658970707769307140\/pl\/0: /,
    );
    const empty = createEvidenceFetch("betters", { overrides: { "/descriptions/brand/": "null" } });
    await expect(new BetbyClient(BETBY_BRANDS.betters, { fetchText: empty }).fetchDescriptions()).rejects.toThrow(
      "Betby betters: market descriptions from api-h-c7818b61-608.sptpub.com/api/v3/descriptions/brand/2658970707769307140/markets/pl are not a JSON object",
    );
  });
});
