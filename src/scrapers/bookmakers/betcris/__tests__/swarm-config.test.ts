import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createReplayHttpClient } from "../../../../__tests__/helpers/replay-http.js";
import { httpStatusError } from "../../../shared/http/http-error.js";
import { createSwarmPartnerConfigCache, parsePartnerConfigs } from "../swarm-config.js";
import { loadFixtureText } from "./helpers/swarm-fixtures.js";

const PAGE = "https://www.betcris.pl/";
const HTML = loadFixtureText("swarm/partner-configs.html");
const FALLBACK = { siteId: "1874631", socketUrl: "wss://eu-swarm-springre.trexname.com/", source: "fallback" };

describe("betcris swarm-config", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T02:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("parsePartnerConfigs reads site id and socket URL from the recorded page", () => {
    expect(parsePartnerConfigs(HTML)).toEqual({ siteId: "1874631", socketUrl: "wss://eu-swarm-ws-re.trexname.com/" });
  });

  it.each([
    ["no partnerConfigs", "<html><head></head></html>"],
    ["invalid JSON", HTML.replace('{"pageParams"', "{pageParams")],
    ["non-wss socket", HTML.replace('"swarmUrl":"wss:', '"swarmUrl":"https:')],
    ["non-numeric partner id", HTML.replace('"partnerId":"1874631"', '"partnerId":"x"')],
    ["missing springConfig", HTML.replace('"springConfig"', '"springConfigX"')],
  ])("parsePartnerConfigs returns null: %s", (_label, html) => expect(parsePartnerConfigs(html)).toBeNull());

  it("cache: one shared GET, reused for 6 h, refetched after", async () => {
    const http = createReplayHttpClient({ [PAGE]: { body: HTML, contentType: "text/html; charset=utf-8" } });
    const cache = createSwarmPartnerConfigCache(http);
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect(a).toEqual({ siteId: "1874631", socketUrl: "wss://eu-swarm-ws-re.trexname.com/", source: "page" });
    expect(b).toEqual(a);
    expect(http.calls).toEqual([PAGE]);
    vi.setSystemTime(Date.now() + 6 * 3600_000 - 1); await cache.get(); expect(http.calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + 2); await cache.get(); expect(http.calls).toHaveLength(2);
  });

  it("cache: HTTP 404 → fallback constants, one warn line, retried after 10 min", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const http = createReplayHttpClient({ [PAGE]: { status: 404, body: "" } });
    const cache = createSwarmPartnerConfigCache(http);
    expect(await cache.get()).toEqual(FALLBACK);
    expect(await cache.get()).toEqual(FALLBACK);
    expect(http.calls).toHaveLength(1);
    expect(warn.mock.calls.map(([m]) => m)).toEqual([`[Betcris/Swarm] partnerConfigs unusable (fetch HTTP 404 ${PAGE}); using fallback site_id=1874631 socket=wss://eu-swarm-springre.trexname.com/`]);
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1); await cache.get(); expect(http.calls).toHaveLength(2);
  });

  it("cache: a Cloudflare challenge on the page → fallback naming cf-mitigated", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = createSwarmPartnerConfigCache(createReplayHttpClient({ [PAGE]: httpStatusError(PAGE, 403, "text/html", "", "challenge") }));
    expect(await cache.get()).toEqual(FALLBACK);
    expect(String(warn.mock.calls[0][0])).toContain(`(fetch HTTP 403 ${PAGE} cf-mitigated=challenge)`);
  });

  it("cache: a page without usable partnerConfigs → fallback with the reason", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = createSwarmPartnerConfigCache(createReplayHttpClient({ [PAGE]: { body: "<html></html>", contentType: "text/html" } }));
    expect(await cache.get()).toEqual(FALLBACK);
    expect(String(warn.mock.calls[0][0])).toContain(`(no usable partnerConfigs in ${PAGE})`);
  });

  it("cache: an aborted caller signal rethrows, warns nothing and caches nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const http = createReplayHttpClient({ [PAGE]: { body: HTML, contentType: "text/html" } });
    const cache = createSwarmPartnerConfigCache(http);
    const ac = new AbortController(); ac.abort(new Error("shutdown"));
    await expect(cache.get(ac.signal)).rejects.toThrow(`fetch aborted ${PAGE}`);
    expect(warn).not.toHaveBeenCalled();
    expect(await cache.get()).toMatchObject({ source: "page" });
  });

  it("cache: invalidate() forces the next get() to refetch", async () => {
    const http = createReplayHttpClient({ [PAGE]: { body: HTML, contentType: "text/html" } });
    const cache = createSwarmPartnerConfigCache(http);
    await cache.get(); cache.invalidate(); await cache.get();
    expect(http.calls).toEqual([PAGE, PAGE]);
  });
});
