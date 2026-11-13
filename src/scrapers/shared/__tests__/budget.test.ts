import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createScrapeBudget, BudgetExceededError } from "../budget.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-11-07T10:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("createScrapeBudget", () => {
  it("aborts at the deadline with BudgetExceededError", () => {
    const b = createScrapeBudget(1000);
    expect(b.deadline).toBe(Date.parse("2026-11-07T10:00:01.000Z"));
    vi.advanceTimersByTime(400);
    expect(b.remainingMs()).toBe(600);
    expect(b.signal.aborted).toBe(false);
    expect(() => b.checkpoint()).not.toThrow();
    vi.advanceTimersByTime(600);
    expect(b.signal.aborted).toBe(true);
    expect(b.remainingMs()).toBe(0);
    expect(b.signal.reason).toBeInstanceOf(BudgetExceededError);
    expect(() => b.checkpoint()).toThrow(new BudgetExceededError("scrape budget of 1000ms exceeded"));
  });

  it("follows a parent abort and names its reason", () => {
    const p = new AbortController();
    const b = createScrapeBudget(60_000, p.signal);
    p.abort(new Error("shutdown"));
    expect(b.signal.aborted).toBe(true);
    expect(b.remainingMs()).toBe(0);
    expect(() => b.checkpoint()).toThrow(expect.objectContaining({ name: "BudgetExceededError", message: "scrape aborted: shutdown" }));
  });

  it("is aborted at creation when the parent already is", () =>
    expect(() => createScrapeBudget(1000, AbortSignal.abort("stop")).checkpoint()).toThrow("scrape aborted: stop"));

  it("rejects a non-positive or non-finite duration", () => {
    expect(() => createScrapeBudget(0)).toThrow(RangeError);
    expect(() => createScrapeBudget(Number.NaN)).toThrow("maxDurationMs must be a positive finite number, got NaN");
  });

  it("adds no listener to a shared parent", async () => {
    vi.useRealTimers();
    const warn = vi.fn();
    process.on("warning", warn);
    const p = new AbortController();
    for (let i = 0; i < 20; i++) createScrapeBudget(60_000, p.signal);
    await new Promise((r) => setImmediate(r));
    process.off("warning", warn);
    expect(warn).not.toHaveBeenCalled();
  });
});
