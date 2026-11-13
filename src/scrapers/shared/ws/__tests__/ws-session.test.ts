import { describe, it, expect, vi, afterEach } from "vitest";
import { createServer, type Server as NetServer } from "node:net";
import type { AddressInfo } from "node:net";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { openWsSession } from "../ws-session.js";
import { createScrapeBudget, BudgetExceededError } from "../../budget.js";
import { DEFAULT_USER_AGENT } from "../../http/http-client.js";

const budget = () => createScrapeBudget(60_000);
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  vi.restoreAllMocks();
});

interface Harness {
  url: string;
  port: number;
  connections: () => number;
  seenHeaders: () => IncomingMessage["headers"];
  serverClosed: () => boolean;
}

async function wsServer(
  onConnection: (sock: ServerSocket) => void,
  opts: { verifyClient?: ConstructorParameters<typeof WebSocketServer>[0]["verifyClient"] } = {},
): Promise<Harness> {
  let connections = 0;
  let seen: IncomingMessage["headers"] = {};
  let closed = false;
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1", perMessageDeflate: { threshold: 0 }, ...opts });
  wss.on("connection", (sock, req) => {
    connections++;
    seen = req.headers;
    sock.on("close", () => {
      closed = true;
    });
    onConnection(sock);
  });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  const port = (wss.address() as AddressInfo).port;
  cleanups.push(
    () =>
      new Promise<void>((r) => {
        for (const c of wss.clients) c.terminate();
        wss.close(() => r());
      }),
  );
  return {
    url: `ws://127.0.0.1:${port}/sbk`,
    port,
    connections: () => connections,
    seenHeaders: () => seen,
    serverClosed: () => closed,
  };
}

async function netServer(handler: (s: import("node:net").Socket) => void): Promise<{ server: NetServer; port: number }> {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, port: (server.address() as AddressInfo).port };
}

describe("openWsSession", () => {
  it("rejects with the handshake status", async () => {
    const h = await wsServer(() => {}, { verifyClient: (_i, cb) => cb(false, 403) });
    await expect(openWsSession({ url: h.url, budget: budget() })).rejects.toThrow(`ws handshake HTTP 403 ${h.url}`);
  });

  it("rejects with the connection error code", async () => {
    const { server, port: dead } = await netServer(() => {});
    await new Promise<void>((r) => server.close(() => r()));
    await expect(openWsSession({ url: `ws://127.0.0.1:${dead}/`, budget: budget() })).rejects.toThrow(
      `ws failed ECONNREFUSED ws://127.0.0.1:${dead}/`,
    );
  });

  it("times out a handshake that never answers", async () => {
    const sockets: import("node:net").Socket[] = [];
    const { server, port: silent } = await netServer((s) => sockets.push(s));
    cleanups.push(
      () =>
        new Promise<void>((r) => {
          sockets.forEach((s) => s.destroy());
          server.close(() => r());
        }),
    );
    await expect(openWsSession({ url: `ws://127.0.0.1:${silent}/`, budget: budget(), connectTimeoutMs: 100 })).rejects.toThrow(
      `ws timeout 100ms ws://127.0.0.1:${silent}/`,
    );
  });

  it("never connects with an aborted budget", async () => {
    const h = await wsServer(() => {});
    const p = new AbortController();
    p.abort(new Error("shutdown"));
    await expect(openWsSession({ url: h.url, budget: createScrapeBudget(1000, p.signal) })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(h.connections()).toBe(0);
  });

  it("sends headers, offers permessage-deflate and decodes a compressed frame", async () => {
    const h = await wsServer((sock) => sock.send(Buffer.alloc(100_000, "z")));
    const s = await openWsSession({ url: h.url, budget: budget(), headers: { Origin: "https://www.sts.pl" } });
    const { state } = await s.collect(0, (n, f) => n + f.length, (n) => n >= 100_000, 2000);
    expect(state).toBe(100_000);
    expect(h.seenHeaders()).toMatchObject({ origin: "https://www.sts.pl", "user-agent": DEFAULT_USER_AGENT });
    expect(h.seenHeaders()["sec-websocket-extensions"]).toContain("permessage-deflate");
    expect(s.stats).toEqual({ framesReceived: 1, bytesReceived: 100_000 });
    await s.close();
    await s.close();
  });

  it("collects until done, including frames sent before collect", async () => {
    const h = await wsServer((sock) => {
      sock.send("hello");
      sock.on("message", (m) => {
        if (m.toString() === "sub") ["a", "b", "c"].forEach((x) => sock.send(x));
      });
    });
    const s = await openWsSession({ url: h.url, budget: budget() });
    await new Promise((r) => setTimeout(r, 30));
    s.send("sub");
    expect(await s.collect<string[]>([], (st, f) => [...st, f.toString()], (st) => st.includes("c"), 2000)).toEqual({
      state: ["hello", "a", "b", "c"],
      timedOut: false,
    });
    await s.close();
  });

  it("timeout returns partial state and keeps the socket open", async () => {
    const h = await wsServer((sock) => {
      sock.send("a");
      sock.on("message", (m) => {
        if (m.toString() === "ping") sock.send("pong");
      });
    });
    const s = await openWsSession({ url: h.url, budget: budget() });
    expect(await s.collect<string[]>([], (st, f) => [...st, f.toString()], () => false, 100)).toEqual({ state: ["a"], timedOut: true });
    s.send("ping");
    expect((await s.collect("", (_s, f) => f.toString(), (x) => x === "pong", 1000)).state).toBe("pong");
    await s.close();
  });

  it("budget abort closes the socket and rejects the collect", async () => {
    const h = await wsServer(() => {});
    const p = new AbortController();
    const s = await openWsSession({ url: h.url, budget: createScrapeBudget(60_000, p.signal) });
    const c = s.collect(0, (n) => n + 1, () => false, 10_000);
    p.abort(new Error("shutdown"));
    await expect(c).rejects.toThrow(new BudgetExceededError("scrape aborted: shutdown"));
    await vi.waitFor(() => expect(h.serverClosed()).toBe(true), { timeout: 1000 });
  });

  it("a server close rejects the collect", async () => {
    const h = await wsServer((sock) => setTimeout(() => sock.close(4001, "bye"), 20));
    const s = await openWsSession({ url: h.url, budget: budget() });
    await expect(s.collect(0, (n) => n, () => false, 2000)).rejects.toThrow(`ws closed 4001 ${h.url}`);
  });

  it("a second concurrent collect is refused", async () => {
    const h = await wsServer(() => {});
    const s = await openWsSession({ url: h.url, budget: budget() });
    const first = s.collect(0, (n) => n, () => false, 50);
    await expect(s.collect(0, (n) => n, () => false, 50)).rejects.toThrow("ws collect already active");
    await first;
    await s.close();
  });
});
