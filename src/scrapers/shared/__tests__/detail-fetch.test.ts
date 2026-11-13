import { describe, it, expect, vi } from "vitest";
import { fetchDetailsSkippingFailures, MAX_SKIPPED_DETAIL_RATIO } from "../detail-fetch.js";
import { createScrapeBudget } from "../budget.js";
import { httpStatusError } from "../http/http-error.js";

const ev = (id: string) => ({ id });

describe("fetchDetailsSkippingFailures", () => {
  it("keeps order and skips failures with their message", async () => {
    const out = await fetchDetailsSkippingFailures(
      [ev("a"), ev("b"), ev("c")],
      (e) => e.id,
      async (e) => {
        if (e.id === "b") throw httpStatusError("https://api.test/b", 503, "text/html", "");
        return e.id.toUpperCase();
      },
      { concurrency: 2, budget: createScrapeBudget(60_000) },
    );
    expect(out).toEqual({
      fetched: [
        { event: ev("a"), detail: "A" },
        { event: ev("c"), detail: "C" },
      ],
      skipped: [{ id: "b", error: "fetch HTTP 503 https://api.test/b" }],
    });
  });

  it("returns fetched and skipped in input order regardless of completion order", async () => {
    const delay = { a: 30, b: 25, c: 20, d: 0, e: 5 } as const; // completion order: d, e, c, b, a
    const out = await fetchDetailsSkippingFailures(
      ["a", "b", "c", "d", "e"].map(ev),
      (e) => e.id,
      async (e) => {
        await new Promise((r) => setTimeout(r, delay[e.id as keyof typeof delay]));
        if (e.id === "b" || e.id === "d") throw new Error(`fail ${e.id}`);
        return e.id;
      },
      { concurrency: 5, budget: createScrapeBudget(60_000) },
    );
    expect(out.fetched.map((f) => f.detail)).toEqual(["a", "c", "e"]);
    expect(out.skipped).toEqual([
      { id: "b", error: "fail b" },
      { id: "d", error: "fail d" },
    ]);
  });

  it("passes budget.signal and respects concurrency", async () => {
    const budget = createScrapeBudget(60_000);
    let active = 0;
    let peak = 0;
    const signals: AbortSignal[] = [];
    await fetchDetailsSkippingFailures(
      ["1", "2", "3", "4", "5"].map(ev),
      (e) => e.id,
      async (_e, s) => {
        signals.push(s);
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return 1;
      },
      { concurrency: 2, budget },
    );
    expect(peak).toBe(2);
    expect(signals.every((s) => s === budget.signal)).toBe(true);
  });

  it("an exhausted budget skips the remaining events", async () => {
    const p = new AbortController();
    p.abort(new Error("shutdown"));
    const fetchDetail = vi.fn(async () => 1);
    const out = await fetchDetailsSkippingFailures([ev("a"), ev("b")], (e) => e.id, fetchDetail, {
      concurrency: 4,
      budget: createScrapeBudget(60_000, p.signal),
    });
    expect(fetchDetail).not.toHaveBeenCalled();
    expect(out).toEqual({
      fetched: [],
      skipped: [
        { id: "a", error: "scrape aborted: shutdown" },
        { id: "b", error: "scrape aborted: shutdown" },
      ],
    });
  });

  it("stringifies non-Error rejections", async () => {
    const out = await fetchDetailsSkippingFailures([ev("a")], (e) => e.id, () => Promise.reject("boom"), {
      concurrency: 1,
      budget: createScrapeBudget(1000),
    });
    expect(out.skipped).toEqual([{ id: "a", error: "boom" }]);
    expect(MAX_SKIPPED_DETAIL_RATIO).toBe(0.5);
  });
});
