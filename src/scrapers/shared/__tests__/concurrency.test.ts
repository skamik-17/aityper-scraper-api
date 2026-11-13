import { describe, it, expect, vi } from "vitest";
import { mapLimit } from "../concurrency.js";

describe("mapLimit", () => {
  it("keeps input order and never exceeds the limit", async () => {
    let active = 0;
    let peak = 0;
    const r = await mapLimit([30, 10, 20, 0], 2, async (ms, i) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((res) => setTimeout(res, ms));
      active--;
      return i;
    });
    expect(peak).toBe(2);
    expect(r).toEqual([0, 1, 2, 3].map((value) => ({ status: "fulfilled", value })));
  });

  it("turns sync and async throws into rejected entries", async () => {
    const r = await mapLimit([1, 2], 2, (x) => {
      if (x === 1) throw new Error("sync");
      return Promise.reject(new Error("async"));
    });
    expect(r.map((s) => s.status === "rejected" && (s.reason as Error).message)).toEqual(["sync", "async"]);
  });

  it("does not start items after the signal aborts", async () => {
    const ctl = new AbortController();
    const fn = vi.fn(async (x: number) => {
      if (x === 1) ctl.abort(new Error("stop"));
      return x;
    });
    const r = await mapLimit([1, 2, 3], 1, fn, ctl.signal);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(r.slice(1).map((s) => s.status === "rejected" && (s.reason as Error).message)).toEqual(["stop", "stop"]);
  });

  it("returns [] for no items and rejects an invalid limit", async () => {
    expect(await mapLimit([], 3, async () => 1)).toEqual([]);
    await expect(mapLimit([1], 0, async () => 1)).rejects.toThrow("Expected `concurrency` to be a number from 1 and up");
  });
});
