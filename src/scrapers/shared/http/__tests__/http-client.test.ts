import { describe, it, expect, vi, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { brotliCompressSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { createHttpClient, DEFAULT_USER_AGENT } from "../http-client.js";
import { HttpError } from "../http-error.js";

const U = "https://api.test/x";
const json = (body: unknown, h: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...h } });
const hang = (_u: string, init: RequestInit) =>
  new Promise<Response>((_, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)));
const seq = (...rs: Array<Response | Error | "hang">) =>
  vi.fn(async (u: string, init: RequestInit) => {
    const r = rs.shift()!;
    if (r === "hang") return hang(u, init);
    if (r instanceof Error) throw r;
    return r;
  });
const client = (f: unknown, cfg = {}) => createHttpClient({ fetchImpl: f as typeof fetch, ...cfg });
const fake = () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-11-07T10:00:00.000Z"));
};

let server: Server | undefined;
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
});

describe("HttpClient", () => {
  it("getJson parses JSON and sends merged lower-case headers", async () => {
    const f = seq(json({ ok: 1 }));
    expect(await client(f, { defaultHeaders: { "X-Brand": "forbet" } }).getJson(U, { headers: { "User-Agent": "UA-test" } })).toEqual({ ok: 1 });
    expect(f.mock.calls[0][1].headers).toEqual({
      "user-agent": "UA-test",
      accept: "application/json, text/plain, */*",
      "accept-language": "pl-PL,pl;q=0.9",
      "accept-encoding": "gzip, deflate, br",
      "x-brand": "forbet",
    });
  });

  it("getText sends accept */* and the default Chrome 143 UA", async () => {
    const f = seq(new Response("<html/>", { headers: { "content-type": "text/html" } }));
    expect(await client(f).getText(U)).toBe("<html/>");
    expect(f.mock.calls[0][1].headers).toMatchObject({ accept: "*/*", "user-agent": DEFAULT_USER_AGENT });
    expect(DEFAULT_USER_AGENT).toMatch(/Chrome\/143\.0\.0\.0 Safari\/537\.36$/);
  });

  it("404: http kind, no retry, keeps content-type and a 4096-char body snippet", async () => {
    const f = seq(new Response("x".repeat(5000), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }));
    const http = client(f);
    const err = await http.getJson(U).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({
      name: "HttpError",
      kind: "http",
      status: 404,
      url: U,
      message: `fetch HTTP 404 ${U}`,
      contentType: "text/html; charset=utf-8",
    });
    expect(err.bodySnippet).toHaveLength(4096);
    expect(err.cfMitigated).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1);
    expect(http.stats).toEqual({ requests: 1, retries: 0, failures: 1, bytes: 5000, byStatus: { "404": 1 } });
  });

  it("a Cloudflare challenge names cf-mitigated in the message and the field", async () => {
    const f = seq(
      new Response("<html>Just a moment...</html>", { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" } }),
    );
    await expect(client(f).getJson(U)).rejects.toMatchObject({
      kind: "http",
      status: 403,
      cfMitigated: "challenge",
      message: `fetch HTTP 403 ${U} cf-mitigated=challenge`,
    });
    expect(f).toHaveBeenCalledTimes(1); // 4xx: not retried
  });

  it("retries 503 once after a full-jitter delay", async () => {
    fake();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const f = seq(json({}, {}, 503), json({ ok: 1 }));
    const http = client(f);
    const p = http.getJson(U);
    await vi.advanceTimersByTimeAsync(249);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual({ ok: 1 });
    expect(http.stats).toMatchObject({ requests: 2, retries: 1, failures: 0, byStatus: { "503": 1, "200": 1 } });
  });

  it.each([
    ["2", 2000],
    ["120", 5000],
    ["Sat, 07 Nov 2026 10:00:03 GMT", 3000],
  ])("honours Retry-After %s (capped at 5 s)", async (ra, ms) => {
    fake();
    const f = seq(json({}, { "retry-after": ra }, 429), json({ ok: 1 }));
    const p = client(f).getJson(U);
    await vi.advanceTimersByTimeAsync(ms - 1);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual({ ok: 1 });
  });

  it("gives up after `retries` and throws the last error", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    await expect(client(seq(json({}, {}, 500), json({}, {}, 502))).getJson(U)).rejects.toThrow(`fetch HTTP 502 ${U}`);
    const f = seq(json({}, {}, 500));
    await expect(client(f).getJson(U, { retries: 0 })).rejects.toThrow(`fetch HTTP 500 ${U}`);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("timeout kind is retried", async () => {
    fake();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const http = client(seq("hang", "hang"));
    const p = http.getJson(U, { timeoutMs: 1000 });
    const done = expect(p).rejects.toMatchObject({ kind: "timeout", status: null, message: `fetch timeout 1000ms ${U}` });
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    expect(http.stats.byStatus).toEqual({ timeout: 2 });
  });

  it("times out a body that never finishes", async () => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("{"));
      },
    });
    const f = seq(new Response(body, { headers: { "content-type": "application/json" } }));
    await expect(client(f).getJson(U, { timeoutMs: 50, retries: 0 })).rejects.toThrow(`fetch timeout 50ms ${U}`);
  });

  it("network kind names the cause code, else the cause message, else the error message", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const refused = new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
    const f = seq(refused, refused);
    await expect(client(f).getJson(U)).rejects.toMatchObject({ kind: "network", message: `fetch failed ECONNREFUSED ${U}` });
    expect(f).toHaveBeenCalledTimes(2);
    await expect(client(seq(new TypeError("fetch failed", { cause: new Error("bad port") }))).getJson(U, { retries: 0 })).rejects.toThrow(
      `fetch failed bad port ${U}`,
    );
    await expect(client(seq(new Error("boom"))).getJson(U, { retries: 0 })).rejects.toThrow(`fetch failed boom ${U}`);
  });

  it("content-type kind for non-JSON or unparsable bodies, never retried", async () => {
    const html = seq(new Response("<p>", { headers: { "content-type": "text/html" } }));
    await expect(client(html).getJson(U)).rejects.toMatchObject({ kind: "content-type", status: 200, message: `fetch non-JSON text/html ${U}` });
    expect(html).toHaveBeenCalledTimes(1);
    await expect(client(seq(new Response("{", { headers: { "content-type": "application/json" } }))).getJson(U)).rejects.toThrow(
      `fetch non-JSON application/json ${U}`,
    );
    const bare = new Response("{}");
    bare.headers.delete("content-type");
    await expect(client(seq(bare)).getJson(U)).rejects.toThrow(`fetch non-JSON none ${U}`);
  });

  it("aborted kind: no fetch after abort, no retry after abort", async () => {
    const f0 = seq(json({}));
    const http = client(f0);
    await expect(http.getJson(U, { signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: "aborted", message: `fetch aborted ${U}` });
    expect(f0).not.toHaveBeenCalled();
    expect(http.stats).toMatchObject({ requests: 0, failures: 1 });
    const ctl = new AbortController();
    const f1 = seq("hang", json({}));
    const p = client(f1).getJson(U, { signal: ctl.signal });
    await new Promise((r) => setImmediate(r));
    ctl.abort();
    await expect(p).rejects.toThrow(`fetch aborted ${U}`);
    expect(f1).toHaveBeenCalledTimes(1);
  });

  it("abort during backoff stops retrying", async () => {
    fake();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const ctl = new AbortController();
    const f = seq(json({}, {}, 503), json({ ok: 1 }));
    const p = client(f).getJson(U, { signal: ctl.signal });
    const done = expect(p).rejects.toThrow(`fetch aborted ${U}`);
    await vi.advanceTimersByTimeAsync(100);
    ctl.abort();
    await done;
    await vi.advanceTimersByTimeAsync(1000);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("limits concurrency per host, not across hosts", async () => {
    const open: Record<string, number> = {};
    let peakA = 0;
    const release: Array<() => void> = [];
    const f = vi.fn((u: string) => {
      const h = new URL(u).host;
      open[h] = (open[h] ?? 0) + 1;
      peakA = Math.max(peakA, open["a.test"] ?? 0);
      return new Promise<Response>((res) =>
        release.push(() => {
          open[h]--;
          res(json({}));
        }),
      );
    });
    const http = client(f, { perHostConcurrency: 2 });
    const all = [1, 2, 3, 4, 5].map((i) => http.getJson(`https://a.test/${i}`)).concat(http.getJson("https://b.test/1"));
    await new Promise((r) => setImmediate(r));
    expect(f).toHaveBeenCalledTimes(3); // a.test x2 + b.test x1
    while (release.length) {
      release.shift()!();
      await new Promise((r) => setImmediate(r));
    }
    await Promise.all(all);
    expect(peakA).toBe(2);
  });

  it("a queued request whose signal aborts rejects at once without fetching", async () => {
    let first!: () => void;
    const f = vi.fn(
      () =>
        new Promise<Response>((res) => {
          first = () => res(json({}));
        }),
    );
    const http = client(f, { perHostConcurrency: 1 });
    const ctl = new AbortController();
    const p1 = http.getJson("https://a.test/1");
    const p2 = http.getJson("https://a.test/2", { signal: ctl.signal });
    await new Promise((r) => setImmediate(r));
    ctl.abort();
    await expect(p2).rejects.toThrow("fetch aborted https://a.test/2");
    first();
    await p1;
    await new Promise((r) => setImmediate(r));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("counts bytes from content-length, else from the UTF-8 body", async () => {
    const http = client(
      seq(json({}, { "content-length": "173" }), new Response("zażółć", { headers: { "content-type": "text/plain" } })),
    );
    await http.getJson(U);
    await http.getText(U);
    expect(http.stats.bytes).toBe(183);
  });

  it("shares one signal across 30 requests without a warning", async () => {
    const warn = vi.fn();
    process.on("warning", warn);
    const ctl = new AbortController();
    const http = client(vi.fn(async () => json({})));
    await Promise.all(Array.from({ length: 30 }, (_, i) => http.getJson(`https://a.test/${i}`, { signal: ctl.signal })));
    await new Promise((r) => setImmediate(r));
    process.off("warning", warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it("without fetchImpl it reads globalThis.fetch at call time", async () => {
    const http = createHttpClient(); // created before the stub, like a module singleton
    const stub = vi.fn(async () => json({ late: true }));
    vi.stubGlobal("fetch", stub);
    try {
      expect(await http.getJson(U)).toEqual({ late: true });
      expect(stub).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("real fetch: requests br from a local server and counts compressed bytes", async () => {
    const compressed = brotliCompressSync(Buffer.from(JSON.stringify({ ok: 1, pad: "x".repeat(3000) })));
    let seen: Record<string, string | string[] | undefined> = {};
    server = createServer((req, res) => {
      seen = req.headers;
      res.writeHead(200, {
        "content-type": "application/json",
        "content-encoding": "br",
        "content-length": String(compressed.length),
      });
      res.end(compressed);
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;
    const http = createHttpClient();
    expect(await http.getJson(`http://127.0.0.1:${port}/`)).toMatchObject({ ok: 1 });
    expect(seen["accept-encoding"]).toBe("gzip, deflate, br");
    expect(seen["user-agent"]).toBe(DEFAULT_USER_AGENT);
    expect(http.stats.bytes).toBe(compressed.length);
  });
});
