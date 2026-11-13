import { afterEach, describe, expect, it, vi } from "vitest";
import { BETBY_BRANDS } from "../brands.js";
import {
  extractApiOriginFromRenderer,
  parseBettersBootstrap,
  parseLebullBootstrap,
  parseLebullSbConfig,
  resolveEndpoints,
} from "../discovery.js";
import { BetbyHttpError, createFetchText } from "../http.js";
import type { BetbyEventRef } from "../types.js";
import { createEvidenceFetch } from "./fake-fetch.js";
import { loadJson, loadText } from "./fixtures.js";

describe("Betby endpoint discovery", () => {
  it("parseBettersBootstrap reads brand id and renderer url", () => {
    expect(parseBettersBootstrap(loadJson("betters", "bootstrap.json")))
      .toEqual({ brandId: "2658970707769307140", rendererUrl: "https://betters.sptpub.com/bt-renderer.min.js" });
  });

  it("parseBettersBootstrap rejects a bootstrap without bettech_brand_id (lebull)", () => {
    expect(() => parseBettersBootstrap(loadJson("lebull", "bootstrap.json"))).toThrow(/bettech_brand_id/);
  });

  it("extractApiOriginFromRenderer finds the api-h host", () => {
    expect(extractApiOriginFromRenderer(loadText("betters", "bt-renderer.head.js"))).toBe("https://api-h-c7818b61-608.sptpub.com");
    expect(() => extractApiOriginFromRenderer("console.log(1)")).toThrow(/api-h/);
  });

  it("parseLebullBootstrap and parseLebullSbConfig build the v5/v4 proxy bases", () => {
    expect(parseLebullBootstrap(loadJson("lebull", "bootstrap.json")).sbHost).toBe("https://lebull-pl-bb.boxwebcdn.work/");
    expect(parseLebullSbConfig(loadJson("lebull", "sb-config.json"))).toEqual({
      prematchBase: "https://betting-betby-secundus.prod.sbteam.xyz/v5",
      descriptionsBase: "https://betting-betby-secundus.prod.sbteam.xyz/v4",
      brandId: "2694137186776920067" });
  });

  it("resolveEndpoints returns discovered endpoints equal to the pinned ones on 2026-11-06", async () => {
    for (const bm of ["betters", "lebull"] as const) {
      const r = await resolveEndpoints(BETBY_BRANDS[bm], createEvidenceFetch(bm));
      expect(r).toEqual({ endpoints: BETBY_BRANDS[bm].pinned, source: "discovered" });
    }
  });

  it("resolveEndpoints stays silent when discovery matches the pinned endpoints", async () => {
    for (const bm of ["betters", "lebull"] as const) {
      const warn = vi.fn();
      const f = createEvidenceFetch(bm);
      await resolveEndpoints(BETBY_BRANDS[bm], f, warn);
      expect(warn).not.toHaveBeenCalled();
      expect(f.calls).toHaveLength(2);
    }
  });

  it("resolveEndpoints falls back to pinned endpoints and warns when discovery fails", async () => {
    const warn = vi.fn();
    const r = await resolveEndpoints(BETBY_BRANDS.betters, createEvidenceFetch("betters", { failures: { "share/bootstrap": 503 } }), warn);
    expect(r.source).toBe("pinned");
    expect(warn.mock.calls[0][0]).toMatch(/endpoint discovery failed: HTTP 503 from www\.betters\.pl\/share\/bootstrap; using pinned https:\/\/api-h-c7818b61-608\.sptpub\.com\/api\/v4/);
  });

  it("resolveEndpoints uses the discovered host and logs drift once when the renderer names another api-h host", async () => {
    const warn = vi.fn();
    const renderer = loadText("betters", "bt-renderer.head.js").replaceAll("api-h-c7818b61-608", "api-h-0badc0de-701");
    const f = createEvidenceFetch("betters", { overrides: { "bt-renderer.min.js": renderer } });
    const r = await resolveEndpoints(BETBY_BRANDS.betters, f, warn);
    expect(r).toEqual({
      endpoints: {
        prematchBase: "https://api-h-0badc0de-701.sptpub.com/api/v4",
        descriptionsBase: "https://api-h-0badc0de-701.sptpub.com/api/v3",
        brandId: "2658970707769307140",
      },
      source: "discovered",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      "[Betby/Betters] endpoint drift: discovered https://api-h-0badc0de-701.sptpub.com/api/v4 != pinned https://api-h-c7818b61-608.sptpub.com/api/v4",
    );
  });

  it("resolveEndpoints logs drift naming the brand id when only the brand id changes", async () => {
    const warn = vi.fn();
    const config = loadText("lebull", "sb-config.json").replace("2694137186776920067", "2694137186776920099");
    const f = createEvidenceFetch("lebull", { overrides: { "assets/public/config.json": config } });
    const r = await resolveEndpoints(BETBY_BRANDS.lebull, f, warn);
    expect(r.source).toBe("discovered");
    expect(r.endpoints.brandId).toBe("2694137186776920099");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      "[Betby/LeBull] endpoint drift: discovered https://betting-betby-secundus.prod.sbteam.xyz/v5 (brand 2694137186776920099)"
        + " != pinned https://betting-betby-secundus.prod.sbteam.xyz/v5 (brand 2694137186776920067)",
    );
  });

  it("resolveEndpoints logs drift once when the lebull sb_host moves away from the deep-link host", async () => {
    const warn = vi.fn();
    const bootstrap = loadText("lebull", "bootstrap.json")
      .replace("https://lebull-pl-bb.boxwebcdn.work/", "https://lebull-pl-v2.boxwebcdn.work/");
    const f = createEvidenceFetch("lebull", { overrides: { "share/bootstrap": bootstrap } });
    const r = await resolveEndpoints(BETBY_BRANDS.lebull, f, warn);
    // Odds keep flowing from the unchanged proxy; only the deep links would point at a dead host.
    expect(r).toEqual({ endpoints: BETBY_BRANDS.lebull.pinned, source: "discovered" });
    expect(f.calls).toContain("https://lebull-pl-v2.boxwebcdn.work/assets/public/config.json");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      "[Betby/LeBull] endpoint drift: sb_host https://lebull-pl-v2.boxwebcdn.work/ != deep-link host https://lebull-pl-bb.boxwebcdn.work/",
    );
  });

  it("resolveEndpoints reports endpoint and sb_host drift together on one line", async () => {
    const warn = vi.fn();
    const bootstrap = loadText("lebull", "bootstrap.json")
      .replace("https://lebull-pl-bb.boxwebcdn.work/", "https://lebull-pl-v2.boxwebcdn.work/");
    const config = loadText("lebull", "sb-config.json").replace("2694137186776920067", "2694137186776920099");
    const f = createEvidenceFetch("lebull", { overrides: { "share/bootstrap": bootstrap, "assets/public/config.json": config } });
    const r = await resolveEndpoints(BETBY_BRANDS.lebull, f, warn);
    expect(r).toEqual({ endpoints: { ...BETBY_BRANDS.lebull.pinned, brandId: "2694137186776920099" }, source: "discovered" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      "[Betby/LeBull] endpoint drift: discovered https://betting-betby-secundus.prod.sbteam.xyz/v5 (brand 2694137186776920099)"
        + " != pinned https://betting-betby-secundus.prod.sbteam.xyz/v5 (brand 2694137186776920067)"
        + "; sb_host https://lebull-pl-v2.boxwebcdn.work/ != deep-link host https://lebull-pl-bb.boxwebcdn.work/",
    );
  });

  it("resolveEndpoints falls back to pinned endpoints when the lebull config lacks betbyApiUrl", async () => {
    const warn = vi.fn();
    const f = createEvidenceFetch("lebull", { overrides: { "assets/public/config.json": JSON.stringify({ betbyBrandId: "2694137186776920067" }) } });
    const r = await resolveEndpoints(BETBY_BRANDS.lebull, f, warn);
    expect(r).toEqual({ endpoints: BETBY_BRANDS.lebull.pinned, source: "pinned" });
    expect(warn.mock.calls[0][0]).toBe(
      "[Betby/LeBull] endpoint discovery failed: lebull sb-config: missing betbyApiUrl; using pinned https://betting-betby-secundus.prod.sbteam.xyz/v5",
    );
  });

  it("BETBY_BRANDS build the verified event URLs", () => {
    const ref = { eventId: "2725816334213586962", categoryId: "1669818860410376192", categorySlug: "england",
      tournamentId: "1669818860469096448", tournamentSlug: "premier-league", eventSlug: "leeds-united-tottenham-hotspur" } as BetbyEventRef;
    expect(BETBY_BRANDS.betters.buildEventUrl(ref)).toBe("https://www.betters.pl/zaklady-sportowe/soccer/england/premier-league/leeds-united-tottenham-hotspur-2725816334213586962");
    expect(BETBY_BRANDS.lebull.buildEventUrl(ref)).toBe("https://lebull-pl-bb.boxwebcdn.work/event/1/1669818860410376192/1669818860469096448/2725816334213586962");
  });

  it("the lebull deep-link host is the host its event URLs are built on; betters has none to check", () => {
    const ref = { eventId: "2725816334213586962", categoryId: "1669818860410376192",
      tournamentId: "1669818860469096448" } as BetbyEventRef;
    expect(BETBY_BRANDS.lebull.deepLinkHost).toBe("https://lebull-pl-bb.boxwebcdn.work/");
    expect(BETBY_BRANDS.lebull.buildEventUrl(ref).startsWith(BETBY_BRANDS.lebull.deepLinkHost!)).toBe(true);
    // betters' bootstrap sb_host is stale and ignored; its deep links go to www.betters.pl.
    expect(BETBY_BRANDS.betters.deepLinkHost).toBeUndefined();
  });
});

describe("createFetchText", () => {
  const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the browser user agent, follows redirects and returns the body", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{\"ok\":true}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const url = "https://betters.sptpub.com/bt-renderer.min.js";
    await expect(createFetchText()(url)).resolves.toBe("{\"ok\":true}");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(url);
    expect(new Headers(init.headers).get("user-agent")).toBe(UA);
    expect(init.redirect).toBe("follow");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws BetbyHttpError naming status, host and path on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    const url = "https://www.betters.pl/share/bootstrap";
    const err = await createFetchText()(url).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BetbyHttpError);
    expect(err).toMatchObject({ status: 503, url, message: "HTTP 503 from www.betters.pl/share/bootstrap" });
  });

  it("rethrows network errors as 'Betby request failed' naming host and path", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(createFetchText()("https://www.lebull.pl/share/bootstrap"))
      .rejects.toThrow("Betby request failed: www.lebull.pl/share/bootstrap: fetch failed");
  });

  it("aborts a request that outlives timeoutMs", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
    })));
    await expect(createFetchText({ timeoutMs: 20 })("https://api-h-c7818b61-608.sptpub.com/api/v4/prematch/brand/2658970707769307140/pl/0"))
      .rejects.toThrow(/^Betby request failed: api-h-c7818b61-608\.sptpub\.com\/api\/v4\/prematch\/brand\/2658970707769307140\/pl\/0: .*timeout/);
  });
});
