import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { constants as zlibConstants, gzipSync } from "node:zlib";
import {
  createBetclicTransportStats,
  fetchGrpcStream,
  fetchGrpcWithNodeHttp,
} from "../navigation.js";
import { parseAllMarketsFromProto } from "../parser.js";
import { HANDICAP_B64, TOP_B64 } from "./betclic-fixtures.js";

type Handler = (req: IncomingMessage, res: ServerResponse, fake: FakeGrpc) => void;

interface FakeGrpc {
  url: string;
  requests: IncomingHttpHeaders[];
  /** Compressed byte counts written by gzip handlers, one per response. */
  written: number[];
  waitClosed(n: number, ms: number): Promise<number>;
  close(): Promise<void>;
}

const servers: FakeGrpc[] = [];

/** A node:http server on 127.0.0.1:0 that records request headers and counts closed sockets. */
async function startFakeGrpc(handler: Handler): Promise<FakeGrpc> {
  let closed = 0;
  const server = createServer((req, res) => {
    fake.requests.push(req.headers);
    req.resume();
    handler(req, res, fake);
  });
  server.on("connection", (socket) => socket.on("close", () => closed++));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const fake: FakeGrpc = {
    url: `http://127.0.0.1:${port}`,
    requests: [],
    written: [],
    waitClosed: (n, ms) =>
      new Promise((resolve, reject) => {
        const started = Date.now();
        const poll = setInterval(() => {
          if (closed >= n) {
            clearInterval(poll);
            resolve(closed);
          } else if (Date.now() - started > ms) {
            clearInterval(poll);
            reject(new Error(`only ${closed} of ${n} sockets closed after ${ms} ms`));
          }
        }, 5);
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  servers.push(fake);
  return fake;
}

/** gzip with a sync flush and no trailer: what an open gzip stream has sent so far. */
const openGzip = (text: string) => gzipSync(text, { finishFlush: zlibConstants.Z_SYNC_FLUSH });

/** Writes `bytes` in 3 chunks 10 ms apart, then ends the response only when `end` is set. */
function writeInChunks(res: ServerResponse, bytes: Buffer, end = false): void {
  const size = Math.ceil(bytes.length / 3);
  [0, 1, 2].forEach((i) =>
    setTimeout(() => {
      if (res.destroyed) return;
      res.write(bytes.subarray(i * size, (i + 1) * size));
      if (i === 2 && end) res.end();
    }, i * 10),
  );
}

/** 200 with content-encoding gzip when asked for it, plain text otherwise; never ends. */
const gzipOpen = (text: string): Handler => (req, res, fake) => {
  if (String(req.headers["accept-encoding"] ?? "").includes("gzip")) {
    const gz = openGzip(text);
    fake.written.push(gz.length);
    res.writeHead(200, { "content-type": "application/grpc-web-text", "content-encoding": "gzip" });
    writeInChunks(res, gz);
  } else {
    res.writeHead(200, { "content-type": "application/grpc-web-text" });
    writeInChunks(res, Buffer.from(text));
  }
};

/** Ignores accept-encoding: plain text, never ends. */
const identityOpen = (text: string): Handler => (_req, res) => {
  res.writeHead(200, { "content-type": "application/grpc-web-text" });
  writeInChunks(res, Buffer.from(text));
};

// Any 5-byte-header request frame.
const FRAME = Buffer.from([0, 0, 0, 0, 2, 0x08, 0x03]);

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe("betclic gRPC-web transport", () => {
  it("requests gzip and resolves a gzip stream that never ends (HANDICAP)", async () => {
    const s = await startFakeGrpc(gzipOpen(HANDICAP_B64));
    const msg = await fetchGrpcWithNodeHttp(`${s.url}/x`, FRAME, 5000);
    expect(s.requests[0]["accept-encoding"]).toBe("gzip");
    expect(msg.length).toBe(11926);
    expect(parseAllMarketsFromProto(msg)).toHaveLength(4);
  });

  it("gzip TOP decodes to the same bytes as the identity response", async () => {
    const gzServer = await startFakeGrpc(gzipOpen(TOP_B64));
    const plainServer = await startFakeGrpc(identityOpen(TOP_B64));
    const gz = await fetchGrpcWithNodeHttp(`${gzServer.url}/x`, FRAME, 5000);
    const identity = await fetchGrpcWithNodeHttp(`${plainServer.url}/x`, FRAME, 5000);
    expect(gz.equals(identity)).toBe(true);
    expect(gz.length).toBe(197814);
    expect(parseAllMarketsFromProto(gz)).toHaveLength(29);
  });

  it("closes the source socket after resolving (gzip)", async () => {
    const s = await startFakeGrpc(gzipOpen(HANDICAP_B64));
    await fetchGrpcWithNodeHttp(`${s.url}/x`, FRAME, 5000);
    await expect(s.waitClosed(1, 1000)).resolves.toBe(1);
  });

  it("closes the source socket on the frame deadline", async () => {
    const s = await startFakeGrpc((_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.write(openGzip(TOP_B64).subarray(0, 30000)); // then stalls
    });
    await expect(fetchGrpcWithNodeHttp(`${s.url}/x`, FRAME, 5000, { deadlineMs: 200 }))
      .rejects.toThrow(/^gRPC-web frame deadline \(\d+ ms\): \d+\/197814 bytes$/);
    await expect(s.waitClosed(1, 1000)).resolves.toBe(1);
  });

  it("a gzip stream that ends mid-member rejects as an incomplete frame", async () => {
    const s = await startFakeGrpc((_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(openGzip(TOP_B64).subarray(0, 20000));
    });
    await expect(fetchGrpcWithNodeHttp(`${s.url}/x`, FRAME, 5000))
      .rejects.toThrow(/^Incomplete gRPC-web frame: gzip Z_BUF_ERROR unexpected end of file$/);
  });

  it("identity response still resolves and closes the socket", async () => {
    const s = await startFakeGrpc(identityOpen(HANDICAP_B64));
    const msg = await fetchGrpcWithNodeHttp(`${s.url}/x`, FRAME, 5000);
    expect(msg.length).toBe(11926);
    await expect(s.waitClosed(1, 1000)).resolves.toBe(1);
  });

  it("rejects an unsupported content-encoding and closes the socket", async () => {
    const s = await startFakeGrpc((_req, res) => {
      res.writeHead(200, { "content-encoding": "br" });
      res.write("x");
    });
    await expect(fetchGrpcWithNodeHttp(`${s.url}/x`, FRAME, 5000)).rejects.toThrow("gRPC-web unsupported content-encoding br");
    await expect(s.waitClosed(1, 1000)).resolves.toBe(1);
  });

  it("HTTP 503 rejects and closes the socket", async () => {
    const s = await startFakeGrpc((_req, res) => {
      res.writeHead(503);
      res.write("x");
    });
    const stats = createBetclicTransportStats();
    await expect(fetchGrpcWithNodeHttp(`${s.url}/x`, FRAME, 5000, { stats })).rejects.toThrow("gRPC request failed: HTTP 503");
    await expect(s.waitClosed(1, 1000)).resolves.toBe(1);
    expect(stats.byStatus).toEqual({ "503": 1 });
  });

  it("a trailers-only response rejects with the gRPC error and closes the socket", async () => {
    const s = await startFakeGrpc((_req, res) => {
      res.writeHead(200, { "grpc-status": "5", "grpc-message": "x" });
      res.write("");
    });
    await expect(fetchGrpcWithNodeHttp(`${s.url}/x`, FRAME, 5000)).rejects.toThrow("gRPC error 5: x");
    await expect(s.waitClosed(1, 1000)).resolves.toBe(1);
  });

  it("an abort mid-stream rejects \"gRPC aborted <url>\", makes no retry and closes the socket", async () => {
    const s = await startFakeGrpc((_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.write(openGzip(TOP_B64).subarray(0, 30000)); // then stalls
    });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    const t0 = Date.now();
    await expect(fetchGrpcStream(`${s.url}/x`, Buffer.from([0x08, 0x03]), 30_000, { signal: ac.signal })).rejects.toThrow(`gRPC aborted ${s.url}/x`);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(s.requests).toHaveLength(1);
    await expect(s.waitClosed(1, 1000)).resolves.toBe(1);
  });

  it("an abort during the retry delay rejects at once", async () => {
    const s = await startFakeGrpc((_req, res) => {
      res.writeHead(503);
      res.end();
    });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const t0 = Date.now();
    await expect(fetchGrpcStream(`${s.url}/x`, Buffer.from([0x08, 0x03]), 30_000, { signal: ac.signal })).rejects.toThrow(`gRPC aborted ${s.url}/x`);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(s.requests).toHaveLength(1);
  });

  it("an already-aborted signal sends no request", async () => {
    const s = await startFakeGrpc(gzipOpen(HANDICAP_B64));
    const stats = createBetclicTransportStats();
    await expect(fetchGrpcStream(`${s.url}/x`, Buffer.from([0x08, 0x03]), 5000, { signal: AbortSignal.abort(), stats }))
      .rejects.toThrow(`gRPC aborted ${s.url}/x`);
    expect(s.requests).toHaveLength(0);
    expect(stats).toMatchObject({ requests: 0, failures: 1 });
  });

  it("an abort before the response headers counts as aborted, not network", async () => {
    const s = await startFakeGrpc(() => {}); // never answers
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    const stats = createBetclicTransportStats();
    await expect(fetchGrpcWithNodeHttp(`${s.url}/x`, FRAME, 30_000, { signal: ac.signal, stats })).rejects.toThrow(`gRPC aborted ${s.url}/x`);
    expect(stats.byStatus).toEqual({ aborted: 1 });
    await expect(s.waitClosed(1, 1000)).resolves.toBe(1);
  });

  it("counts compressed wire bytes with HttpStats semantics", async () => {
    const s = await startFakeGrpc(gzipOpen(HANDICAP_B64));
    const stats = createBetclicTransportStats();
    await fetchGrpcStream(`${s.url}/x`, Buffer.from([0x08, 0x03]), 5000, { stats });
    expect(stats).toEqual({ requests: 1, retries: 0, failures: 0, bytes: s.written[0], byStatus: { "200": 1 }, gzipResponses: 1 });
  });
});
