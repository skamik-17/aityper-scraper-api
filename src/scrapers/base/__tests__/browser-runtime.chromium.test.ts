/**
 * BrowserRuntime against the locally installed Playwright headless shell (no internet).
 * Run through `heavy --live`: these tests launch Chromium.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BROWSER_POLICY, type ResolvedBrowserPolicy } from "../browser-policy.js";
import { BROWSER_ARGS, BrowserRuntime } from "../browser-runtime.js";

const canLaunch = await chromium.launch({ headless: true }).then(
  async (b) => {
    await b.close();
    return true;
  },
  () => false,
);

describe.skipIf(!canLaunch)("BrowserRuntime on real Chromium", () => {
  let rt: BrowserRuntime;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    rt = new BrowserRuntime({ maxSessions: 3, idleCloseMs: 60_000 });
  });

  afterEach(async () => {
    await rt.closeAll();
    vi.restoreAllMocks();
  });

  it("serves concurrent sessions from one browser with separate contexts and a 1366x768 viewport", { timeout: 30_000 }, async () => {
    const [a, b] = await Promise.all([
      rt.openSession({ bookmaker: "sts", maxSessionMs: 30_000 }),
      rt.openSession({ bookmaker: "fortuna", maxSessionMs: 30_000 }),
    ]);
    expect(a.browser).toBe(b.browser);
    expect(a.context).not.toBe(b.context);
    expect(await a.page.evaluate(() => [innerWidth, innerHeight])).toEqual([1366, 768]);
  });

  it("lifetime expiry rejects pending page work with the reason", { timeout: 30_000 }, async () => {
    const s = await rt.openSession({ bookmaker: "sts", maxSessionMs: 300 });
    await expect(s.page.evaluate(() => new Promise(() => {}))).rejects.toThrow("browser session exceeded 300ms");
  });

  it("Browser.crash marks open sessions crashed and the next session runs on a new browser", { timeout: 30_000 }, async () => {
    const s1 = await rt.openSession({ bookmaker: "sts", maxSessionMs: 30_000 });
    await (await s1.browser.newBrowserCDPSession()).send("Browser.crash").catch(() => {});
    await expect.poll(() => s1.runtime!.crashed()).toBe(true);
    const s2 = await rt.openSession({ bookmaker: "sts", maxSessionMs: 30_000 });
    expect(s2.browser).not.toBe(s1.browser);
    expect(s2.browser.isConnected()).toBe(true);
    await s1.cleanup();
    await s2.cleanup();
  });
});

/**
 * A local server every hostname resolves to (--host-resolver-rules). It counts hits by
 * host + path; /match/<i> links a stylesheet, a script, an image, a font and a tracker.
 * /popup requests its image and tracker 500 ms after load: a popup is prepared when Playwright
 * announces it (after its first navigation commits), so only later requests are covered.
 */
function startSite(): Promise<{ server: Server; port: number; hits: Record<string, number> }> {
  const hits: Record<string, number> = {};
  const server = createServer((req, res) => {
    const host = (req.headers.host ?? "").split(":")[0];
    const path = (req.url ?? "/").split("?")[0];
    const key = `${host}${path}`;
    hits[key] = (hits[key] ?? 0) + 1;
    res.setHeader("access-control-allow-origin", "*");
    const page = (title: string) =>
      `<!doctype html><html><head><title>${title}</title><link rel="stylesheet" href="/style.css"><script src="/app.js"></script>` +
      `<script src="http://www.googletagmanager.com/gtm.js"></script></head>` +
      `<body><img src="/img.png"><span style="font-family:F">x</span></body></html>`;
    if (path.startsWith("/match/")) {
      res.setHeader("content-type", "text/html");
      res.end(page(path));
    } else if (path === "/popup") {
      res.setHeader("content-type", "text/html");
      res.end(
        `<!doctype html><html><head><title>popup</title><link rel="stylesheet" href="/style.css"></head><body><script>
          window.lateDone = 0;
          setTimeout(() => {
            const img = document.createElement("img");
            img.onload = img.onerror = () => window.lateDone++;
            img.src = "/img.png";
            document.body.appendChild(img);
            const s = document.createElement("script");
            s.onload = s.onerror = () => window.lateDone++;
            s.src = "http://www.googletagmanager.com/gtm.js";
            document.head.appendChild(s);
          }, 500);
        </script></body></html>`,
      );
    } else if (path === "/style.css") {
      res.setHeader("content-type", "text/css");
      res.setHeader("cache-control", "public, max-age=3600");
      res.end("@font-face{font-family:F;src:url(/f.woff2)} body{color:#123}");
    } else if (path === "/app.js") {
      res.setHeader("content-type", "application/javascript");
      res.setHeader("cache-control", "public, max-age=3600");
      res.end("window.appLoaded = true;");
    } else if (path === "/img.png" || path === "/f.woff2") {
      res.setHeader("content-type", path.endsWith(".png") ? "image/png" : "font/woff2");
      res.setHeader("cache-control", "public, max-age=3600");
      res.end(Buffer.alloc(64));
    } else if (path === "/gtm.js") {
      res.setHeader("content-type", "application/javascript");
      res.setHeader("cache-control", "no-store");
      res.end("window.gtm = true;");
    } else {
      res.setHeader("content-type", "application/json");
      res.end('{"ok":true}');
    }
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port, hits })),
  );
}

describe.skipIf(!canLaunch)("blocking", () => {
  let site: Awaited<ReturnType<typeof startSite>>;
  let rt: BrowserRuntime;
  const policy = (block: ResolvedBrowserPolicy["block"]): ResolvedBrowserPolicy => ({ ...DEFAULT_BROWSER_POLICY, block });
  const open = (block: ResolvedBrowserPolicy["block"]) => rt.openSession({ bookmaker: "fortuna", maxSessionMs: 30_000, policy: policy(block) });

  beforeAll(async () => {
    site = await startSite();
  });
  afterAll(() => new Promise<void>((r) => site.server.close(() => r())));

  beforeEach(() => {
    for (const k of Object.keys(site.hits)) delete site.hits[k];
    vi.spyOn(console, "log").mockImplementation(() => {});
    rt = new BrowserRuntime({
      maxSessions: 3,
      idleCloseMs: 60_000,
      launchOptions: { headless: true, args: [...BROWSER_ARGS, `--host-resolver-rules=MAP * 127.0.0.1:${site.port}`] },
    });
  });

  afterEach(async () => {
    await rt.closeAll();
    vi.restoreAllMocks();
  });

  it("media+trackers keeps the HTTP cache and never blocks stylesheets", { timeout: 30_000 }, async () => {
    const s = await open("media+trackers");
    for (let i = 0; i < 5; i++) await s.page.goto(`http://first.test/match/${i}`, { waitUntil: "load" });
    expect(site.hits["first.test/app.js"]).toBe(1);
    expect(site.hits["first.test/style.css"]).toBe(1);
    expect(site.hits["first.test/img.png"] ?? 0).toBe(0);
    expect(site.hits["first.test/f.woff2"] ?? 0).toBe(0);
    expect(site.hits["www.googletagmanager.com/gtm.js"] ?? 0).toBe(0);
  });

  it("none loads everything (img 1x cached, gtm 5x)", { timeout: 30_000 }, async () => {
    const s = await open("none");
    for (let i = 0; i < 5; i++) await s.page.goto(`http://first.test/match/${i}`, { waitUntil: "load" });
    expect(site.hits["first.test/app.js"]).toBe(1);
    expect(site.hits["first.test/style.css"]).toBe(1);
    expect(site.hits["first.test/img.png"]).toBe(1);
    expect(site.hits["first.test/f.woff2"]).toBe(1);
    expect(site.hits["www.googletagmanager.com/gtm.js"]).toBe(5);
  });

  it("never blocks the scrapers' data URLs, look-alike hosts or query mentions", { timeout: 30_000 }, async () => {
    const s = await open("media+trackers");
    await s.page.goto("http://first.test/match/0", { waitUntil: "load" });
    const urls = [
      "http://api.efortuna.pl/offer/markets/api/v1_0/fixture/1/markets",
      "http://production-superbet-offer-pl.freetls.fastly.net/v2/pl-PL/events/1",
      "http://offer.lvbet.pl/client-api/v5/markets/search?matches_ids=1",
      "http://betfan.pl/api/v1/market/events/40932985",
      "http://www.iforbet.pl/rest/market/events/1",
      "http://api.etoto.pl/rest/market/events/1",
      "http://fuksiarz.pl/rest/market/events/1",
      "http://www.sts.pl/pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/175",
      "http://www.betcris.pl/zaklady-bukmacherskie/match/Soccer/England/538/28660755",
      "http://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/134-england-premier-league",
      "http://first.test/runtime.webpack.js",
      "http://first.test/vendor.icons.js",
      "http://first.test/api?ref=http://www.googletagmanager.com/",
      "http://notgoogletagmanager.com/x",
    ];
    const outcomes = await s.page.evaluate(
      (u) => Promise.all(u.map((x) => fetch(x).then(() => "ok", (e: unknown) => `BLOCKED ${String(e)}`))),
      urls,
    );
    expect(Object.fromEntries(urls.map((u, i) => [u, outcomes[i]]))).toEqual(Object.fromEntries(urls.map((u) => [u, "ok"])));
  });

  it("blocks in popups too", { timeout: 30_000 }, async () => {
    const s = await open("media+trackers");
    await s.page.goto("http://first.test/match/0", { waitUntil: "load" });
    const popup = s.context.waitForEvent("page");
    await s.page.evaluate(() => void window.open("/popup"));
    const p = await popup;
    await p.waitForFunction(() => (window as unknown as { lateDone: number }).lateDone === 2, undefined, { timeout: 10_000 });
    expect(site.hits["first.test/popup"]).toBe(1);
    expect(site.hits["first.test/img.png"] ?? 0).toBe(0);
    expect(site.hits["www.googletagmanager.com/gtm.js"] ?? 0).toBe(0);
  });

  it("reports traffic and Chromium CPU in the closed line", { timeout: 30_000 }, async () => {
    const s = await open("media+trackers");
    for (let i = 0; i < 2; i++) await s.page.goto(`http://first.test/match/${i}`, { waitUntil: "load" });
    await s.cleanup();
    await rt.closeAll();
    const lines = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[BrowserRuntime] closed (closeAll)"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/requests=[1-9]\d* bytes=[1-9]\d* blocked=[1-9]\d* chromiumCpuMs=[1-9]\d*/);
  });
});

/** Records the client hints and UA of the document and of a fetch it makes, on 127.0.0.1 (a secure context). */
function startHintsSite(): Promise<{ server: Server; port: number; seen: Record<string, { secChUa?: string; ua?: string }> }> {
  const seen: Record<string, { secChUa?: string; ua?: string }> = {};
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    seen[path] = { secChUa: req.headers["sec-ch-ua"] as string | undefined, ua: req.headers["user-agent"] };
    if (path === "/") {
      res.setHeader("content-type", "text/html");
      res.end(`<!doctype html><html><head><title>hints</title></head><body><script>
        window.xhrDone = fetch("/xhr").then((r) => r.text());
      </script></body></html>`);
    } else {
      res.setHeader("content-type", "text/plain");
      res.end("ok");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port, seen })));
}

describe.skipIf(!canLaunch)("stealth", () => {
  let site: Awaited<ReturnType<typeof startHintsSite>>;
  let rt: BrowserRuntime;

  beforeAll(async () => {
    site = await startHintsSite();
  });
  afterAll(() => new Promise<void>((r) => site.server.close(() => r())));
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    rt = new BrowserRuntime({ maxSessions: 3, idleCloseMs: 60_000 });
  });
  afterEach(async () => {
    await rt.closeAll();
    vi.restoreAllMocks();
  });

  async function headersAndFingerprint(policy: ResolvedBrowserPolicy) {
    for (const k of Object.keys(site.seen)) delete site.seen[k];
    const s = await rt.openSession({ bookmaker: "sts", maxSessionMs: 30_000, policy });
    await s.page.goto(`http://127.0.0.1:${site.port}/`, { waitUntil: "load" });
    await s.page.evaluate(() => (window as unknown as { xhrDone: Promise<string> }).xhrDone);
    const fp = await s.page.evaluate(() => ({
      platform: navigator.platform,
      plugins: navigator.plugins.length,
      mimeTypes: navigator.mimeTypes.length,
      pdfViewerEnabled: navigator.pdfViewerEnabled,
      chrome: typeof (window as unknown as { chrome?: unknown }).chrome,
      pluginsTag: Object.prototype.toString.call(navigator.plugins),
      firstPlugin: navigator.plugins[0]?.name ?? null,
      webdriver: navigator.webdriver,
      languages: [...navigator.languages],
    }));
    await s.cleanup();
    return { secChUa: site.seen["/"]?.secChUa ?? "", xhrSecChUa: site.seen["/xhr"]?.secChUa ?? "", ua: site.seen["/"]?.ua ?? "", fp };
  }

  it("stealth: document and fetch carry the browser's own brands with HeadlessChrome replaced", { timeout: 30_000 }, async () => {
    const plain = await headersAndFingerprint({ ...DEFAULT_BROWSER_POLICY });
    const st = await headersAndFingerprint({ ...DEFAULT_BROWSER_POLICY, stealth: true });
    expect(plain.secChUa).toContain('"HeadlessChrome"');
    expect(plain.ua).toContain("Chrome/120.0.0.0");
    expect(st.secChUa).toBe(plain.secChUa.replace('"HeadlessChrome"', '"Google Chrome"'));
    expect(st.xhrSecChUa).toBe(st.secChUa);
    expect(st.fp).toMatchObject({
      platform: "Win32",
      plugins: 5,
      mimeTypes: 2,
      pdfViewerEnabled: true,
      chrome: "object",
      pluginsTag: "[object PluginArray]",
      firstPlugin: "PDF Viewer",
      webdriver: false,
      languages: ["pl-PL", "pl", "en-US", "en"],
    });
    expect(st.ua).toMatch(/Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
    expect(st.ua).not.toContain("Headless");
  });
});
