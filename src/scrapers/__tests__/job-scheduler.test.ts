import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../../__tests__/helpers/run-fixtures.js";
import { runJobsWithCaps, type CappedJob } from "../job-scheduler.js";
import { DEFAULT_JOB_CAPS, orderBrowserJobs } from "../job-policy.js";

let T0 = 0;
let started: Array<[string, number, number]> = [];
let gates: Record<string, ReturnType<typeof deferred<void>>> = {};
const job = (key: string, browser: boolean): CappedJob<string> => {
  gates[key] = deferred<void>();
  return {
    key,
    browser,
    run: async (queueMs) => {
      started.push([key, Date.now() - T0, queueMs]);
      await gates[key].promise;
      return key;
    },
  };
};

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-07T10:00:00.000Z") });
  T0 = Date.now();
  started = [];
  gates = {};
});
afterEach(() => vi.useRealTimers());

describe("runJobsWithCaps", () => {
  it("browser jobs: <= 3 at once, starts >= 1.5 s apart, a freed slot refills", async () => {
    void runJobsWithCaps(["b1", "b2", "b3", "b4", "b5"].map((k) => job(k, true)), DEFAULT_JOB_CAPS);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(started).toEqual([["b1", 0, 0], ["b2", 1_500, 1_500], ["b3", 3_000, 3_000]]);
    gates.b1.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(started[3]).toEqual(["b4", 10_000, 10_000]);
  });

  it("non-browser: 12 at once, unstaggered, independent of the browser pool", async () => {
    const jobs = [...["b1", "b2", "b3"].map((k) => job(k, true)), ...Array.from({ length: 14 }, (_, i) => job(`h${i + 1}`, false))];
    void runJobsWithCaps(jobs, DEFAULT_JOB_CAPS);
    await vi.advanceTimersByTimeAsync(5_000);
    const at = Object.fromEntries(started.map(([k, t]) => [k, t]));
    for (let i = 1; i <= 12; i++) expect(at[`h${i}`]).toBe(0);
    expect(at.h13).toBeUndefined();
    expect(at.h14).toBeUndefined();
    expect([at.b1, at.b2, at.b3]).toEqual([0, 1_500, 3_000]);
  });

  it("results keep input order; a queued job never starts after the signal aborts", async () => {
    const ac = new AbortController();
    const reason = new Error("shutdown");
    const p = runJobsWithCaps(["b1", "b2", "b3", "b4"].map((k) => job(k, true)), DEFAULT_JOB_CAPS, ac.signal);
    await vi.advanceTimersByTimeAsync(500);
    ac.abort(reason);
    gates.b1.resolve();
    await vi.advanceTimersByTimeAsync(5_000);
    const results = await p;
    expect(started.map(([k]) => k)).toEqual(["b1"]);
    expect(results[0]).toEqual({ status: "fulfilled", value: "b1" });
    expect(results.slice(1)).toEqual([1, 2, 3].map(() => ({ status: "rejected", reason })));
  });

  it("orderBrowserJobs puts the longest budgets first", () =>
    expect(orderBrowserJobs(["fortuna", "sts", "betcris", "superbet", "pzbuk"])).toEqual(["betcris", "pzbuk", "sts", "fortuna", "superbet"]));
});
