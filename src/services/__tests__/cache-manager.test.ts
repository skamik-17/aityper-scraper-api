import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ScraperCache } from "../cache-manager.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

describe("ScraperCache expiry on write", () => {
  it("set() drops entries older than the TTL without any read", () => {
    const c = new ScraperCache<string>({ ttl: 1000, maxSize: 10 });
    c.set("a", "A");
    vi.setSystemTime(500);
    c.set("b", "B");
    vi.setSystemTime(1001);
    c.set("c", "C");
    expect(c.size).toBe(2);
    expect(c.getStats().size).toBe(2);
  });

  it("a full cache evicts the least recently written key; a rewrite counts as a write", () => {
    const c = new ScraperCache<string>({ ttl: 60_000, maxSize: 2 });
    c.set("a", "A1");
    vi.setSystemTime(1);
    c.set("b", "B");
    vi.setSystemTime(2);
    c.set("a", "A2");
    vi.setSystemTime(3);
    c.set("c", "C");
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe("A2");
    expect(c.get("c")).toBe("C");
    expect(c.getStats().evictions).toBe(1);
  });
});
