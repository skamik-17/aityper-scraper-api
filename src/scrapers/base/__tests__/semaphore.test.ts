import { describe, expect, it } from "vitest";
import { Semaphore } from "../semaphore.js";

describe("Semaphore", () => {
  it("grants up to max at once and queues the rest", async () => {
    const s = new Semaphore(2);
    await s.acquire();
    await s.acquire();
    void s.acquire();
    expect([s.active, s.waiting]).toEqual([2, 1]);
  });

  it("release hands the permit to the oldest waiter (FIFO)", async () => {
    const s = new Semaphore(1);
    const release = await s.acquire();
    const order: string[] = [];
    const a = s.acquire().then((r) => (order.push("A"), r));
    const b = s.acquire().then((r) => (order.push("B"), r));
    release();
    (await a)();
    (await b)();
    expect(order).toEqual(["A", "B"]);
    expect([s.active, s.waiting]).toEqual([0, 0]);
  });

  it("release keeps the permit count while a waiter takes it over", async () => {
    const s = new Semaphore(1);
    const release = await s.acquire();
    const next = s.acquire();
    release();
    expect([s.active, s.waiting]).toEqual([1, 0]);
    (await next)();
    expect(s.active).toBe(0);
  });

  it("release is idempotent", async () => {
    const s = new Semaphore(1);
    const r = await s.acquire();
    r();
    r();
    expect(s.active).toBe(0);
  });

  it("an aborted waiter rejects with signal.reason and leaves the queue", async () => {
    const s = new Semaphore(1);
    await s.acquire();
    const ac = new AbortController();
    const p = s.acquire(ac.signal);
    ac.abort(new Error("deadline"));
    await expect(p).rejects.toThrow("deadline");
    expect([s.active, s.waiting]).toEqual([1, 0]);
  });

  it("an already-aborted signal rejects without queueing", async () => {
    const s = new Semaphore(1);
    const ac = new AbortController();
    ac.abort(new Error("gone"));
    await expect(s.acquire(ac.signal)).rejects.toThrow("gone");
    expect([s.active, s.waiting]).toEqual([0, 0]);
  });

  it("an already-aborted signal rejects even when a permit is free", async () => {
    const s = new Semaphore(2);
    const ac = new AbortController();
    ac.abort(new Error("gone"));
    await expect(s.acquire(ac.signal)).rejects.toThrow("gone");
    expect(s.active).toBe(0);
  });

  it("rejectAll rejects every waiter; active permits stay held", async () => {
    const s = new Semaphore(1);
    await s.acquire();
    const w1 = s.acquire();
    const w2 = s.acquire();
    s.rejectAll(new Error("shutdown"));
    await expect(w1).rejects.toThrow("shutdown");
    await expect(w2).rejects.toThrow("shutdown");
    expect([s.active, s.waiting]).toEqual([1, 0]);
  });

  it("a granted waiter's abort listener is removed (a later abort changes nothing)", async () => {
    const s = new Semaphore(1);
    const first = await s.acquire();
    const ac = new AbortController();
    const p = s.acquire(ac.signal);
    first();
    const release = await p;
    ac.abort(new Error("late"));
    expect(s.active).toBe(1);
    release();
    expect(s.active).toBe(0);
  });
});
