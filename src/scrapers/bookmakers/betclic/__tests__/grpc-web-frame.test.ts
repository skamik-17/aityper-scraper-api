import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { gzipSync } from "node:zlib";
import { decodeGrpcWebTextFrame, readGrpcWebTextStream } from "../navigation.js";
import { parseAllMarketsFromProto } from "../parser.js";

const b64 = (f: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", f), "utf8");
const HANDICAP = b64("arsenal-hull_HANDICAP.grpc-web-text.b64"), TOP = b64("arsenal-hull_TOP.grpc-web-text.b64");

/** One gRPC-web-text frame: flag byte + 4-byte big-endian length + message, base64-encoded */
const grpcWebTextFrame = (flag: number, message: Buffer): string => {
  const f = Buffer.alloc(5 + message.length);
  f[0] = flag;
  f.writeUInt32BE(message.length, 1);
  message.copy(f, 5);
  return f.toString("base64");
};

describe("decodeGrpcWebTextFrame", () => {
  it("decodeGrpcWebTextFrame: full HANDICAP response is one complete 11926-byte frame with 4 markets", () => {
    const f = decodeGrpcWebTextFrame(HANDICAP);
    expect(f).toMatchObject({ complete: true, expectedLength: 11926, flag: 0 });
    expect(f.message.length).toBe(11926);
    expect(parseAllMarketsFromProto(f.message)).toHaveLength(4);
  });
  it("decodeGrpcWebTextFrame: a response cut at 8000 chars is incomplete (5995 of 11926 bytes)", () => {
    const f = decodeGrpcWebTextFrame(HANDICAP.slice(0, 8000));
    expect(f).toMatchObject({ complete: false, expectedLength: 11926 });
    expect(f.message.length).toBe(5995);
  });
  it("decodeGrpcWebTextFrame: TOP complete gives 29 markets, truncated TOP is incomplete", () => {
    expect(parseAllMarketsFromProto(decodeGrpcWebTextFrame(TOP).message)).toHaveLength(29);
    expect(decodeGrpcWebTextFrame(TOP.slice(0, 8000)).complete).toBe(false);
  });
  it("decodeGrpcWebTextFrame: header not yet received", () => {
    expect(decodeGrpcWebTextFrame("AAAA")).toMatchObject({ complete: false, expectedLength: null, flag: null });
  });
  it("decodeGrpcWebTextFrame ignores a trailing partial quadruplet", () => {
    expect(decodeGrpcWebTextFrame(HANDICAP.slice(0, 8002)).message.length).toBe(5995);
  });
  it("decodeGrpcWebTextFrame reports complete when extra bytes follow the first frame", () => {
    const f = decodeGrpcWebTextFrame(HANDICAP + "AAAAAAAA");
    expect(f).toMatchObject({ complete: true, expectedLength: 11926 });
    expect(f.message.length).toBe(11926);
  });
});

describe("readGrpcWebTextStream", () => {
  it("readGrpcWebTextStream resolves on a complete frame while the stream stays open", async () => {
    const s = new PassThrough();
    const p = readGrpcWebTextStream(s, { deadlineMs: 5000 });
    s.write(HANDICAP.slice(0, 8002)); // chunk boundary inside a base64 quadruplet
    s.write(HANDICAP.slice(8002)); // no end(): Betclic never ends the stream
    expect((await p).length).toBe(11926);
  });
  it("readGrpcWebTextStream rejects when the stream ends mid-frame", async () => {
    const s = new PassThrough();
    const p = readGrpcWebTextStream(s, { deadlineMs: 5000 });
    s.write(HANDICAP.slice(0, 8000));
    s.end();
    await expect(p).rejects.toThrow(/Incomplete gRPC-web frame: 5995\/11926 bytes/);
  });
  it("readGrpcWebTextStream rejects when the stream ends with no data", async () => {
    const s = new PassThrough();
    const p = readGrpcWebTextStream(s, { deadlineMs: 5000 });
    s.end();
    await expect(p).rejects.toThrow(/Incomplete gRPC-web frame: 0\/null bytes/);
  });
  it("readGrpcWebTextStream rejects at the deadline while bytes still trickle", async () => {
    const s = new PassThrough();
    const p = readGrpcWebTextStream(s, { deadlineMs: 50 });
    s.write(HANDICAP.slice(0, 8000));
    // Keep bytes flowing so an idle timer that resets on data would never fire
    let offset = 8000;
    const trickle = setInterval(() => {
      if (!s.destroyed) {
        s.write(HANDICAP.slice(offset, offset + 4));
        offset += 4;
      }
    }, 5);
    try {
      await expect(p).rejects.toThrow(/gRPC-web frame deadline \(50 ms\): \d+\/11926 bytes/);
    } finally {
      clearInterval(trickle);
    }
  });
  it("readGrpcWebTextStream rejects a trailer frame", async () => {
    const t = Buffer.from("grpc-status:5\r\ngrpc-message:not found\r\n", "latin1");
    const f = Buffer.alloc(5 + t.length);
    f[0] = 0x80;
    f.writeUInt32BE(t.length, 1);
    t.copy(f, 5);
    const s = new PassThrough();
    const p = readGrpcWebTextStream(s, { deadlineMs: 5000 });
    s.write(f.toString("base64"));
    await expect(p).rejects.toThrow(/gRPC-web trailer frame instead of data: grpc-status:5/);
  });
  it("readGrpcWebTextStream rejects an empty first data frame instead of resolving 0 bytes", async () => {
    const s = new PassThrough();
    const p = readGrpcWebTextStream(s, { deadlineMs: 5000 });
    // The real frame follows on the same open stream; it must not be skipped silently
    s.write(grpcWebTextFrame(0, Buffer.alloc(0)) + HANDICAP);
    await expect(p).rejects.toThrow(/gRPC-web empty data frame/);
  });
  it("readGrpcWebTextStream rejects a compressed frame instead of resolving compressed bytes", async () => {
    const s = new PassThrough();
    const p = readGrpcWebTextStream(s, { deadlineMs: 5000 });
    s.write(grpcWebTextFrame(0x01, gzipSync(decodeGrpcWebTextFrame(HANDICAP).message)));
    await expect(p).rejects.toThrow(/gRPC-web compressed frame not supported/);
  });
});
