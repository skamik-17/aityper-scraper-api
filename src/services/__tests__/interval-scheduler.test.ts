import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../../__tests__/helpers/run-fixtures.js";
import { computeNextDelayMs, IntervalScheduler } from "../interval-scheduler.js";
import { RunCoordinator, type RunRequest } from "../run-coordinator.js";

const H = 3_600_000;
let T0 = 0;
let startTimes: number[] = [];
let running = 0;
let maxConcurrent = 0;
let firstCallGate: Promise<void> | null = null;
let exec: ReturnType<typeof vi.fn>;
let coordinator: RunCoordinator;
const request = (trigger: "startup" | "interval"): RunRequest => ({ trigger, leagues: ["premier-league"], bookmakers: ["forbet"] });
const diffs = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]);

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-07T10:00:00.000Z") });
  T0 = Date.now();
  startTimes = [];
  running = 0;
  maxConcurrent = 0;
  firstCallGate = null;
  exec = vi.fn(async (req: RunRequest) => {
    running++;
    maxConcurrent = Math.max(maxConcurrent, running);
    try {
      if (firstCallGate && exec.mock.calls.length === 1) {
        await firstCallGate;
        return;
      }
      if (req.trigger !== "admin") startTimes.push(Date.now());
      await new Promise((r) => setTimeout(r, 120_000));
    } finally {
      running--;
    }
  });
  coordinator = new RunCoordinator(exec);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("interval scheduler", () => {
  it("next start = last start + interval ± 10 %; an overrun waits min(60 s, interval / 2)", () => {
    const a = { lastStartedAt: 0, now: 120_000, intervalMs: H };
    // 0.9 H - 120 s and 1.1 H - 120 s as exact integers (1.1 * H is not exact in IEEE doubles)
    expect([0.5, 0, 1].map((random) => computeNextDelayMs({ ...a, random }))).toEqual([3_480_000, 3_120_000, 3_840_000]);
    expect(computeNextDelayMs({ lastStartedAt: 0, now: 180_000, intervalMs: 60_000, random: 0.5 })).toBe(30_000);
    expect(computeNextDelayMs({ lastStartedAt: 0, now: 2 * H, intervalMs: H, random: 0.5 })).toBe(60_000);
  });

  it.each([[45, 2_700_000], [90, 5_400_000], [120, 7_200_000]])(
    "SCRAPE_INTERVAL_MINUTES=%i starts runs %i ms apart (Review Focus 5)",
    async (min, gap) => {
      const s = new IntervalScheduler({ intervalMs: min * 60_000, coordinator, request, random: () => 0.5 });
      s.start(5_000);
      await vi.advanceTimersByTimeAsync(5_000 + 3 * gap);
      s.stop();
      expect(diffs(startTimes)).toEqual([gap, gap, gap]);
    },
  );

  it("waits for a running admin run instead of overlapping, then starts", async () => {
    const admin = deferred<void>();
    firstCallGate = admin.promise;
    coordinator.start({ trigger: "admin", leagues: ["premier-league"], bookmakers: ["pzbuk"] });
    const s = new IntervalScheduler({ intervalMs: H, coordinator, request, random: () => 0.5 });
    s.start(5_000);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(exec).toHaveBeenCalledTimes(1);
    admin.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(exec.mock.calls.map(([req]) => req.trigger)).toEqual(["admin", "interval"]);
    expect(maxConcurrent).toBe(1);
    s.stop();
  });

  it("nextRunAt is the pending tick and null while running; stop() cancels; firstTrigger is used once", async () => {
    const s = new IntervalScheduler({ intervalMs: H, coordinator, request, random: () => 0.5 });
    s.start(5_000, "startup");
    expect(s.nextRunAt()!.getTime()).toBe(T0 + 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.nextRunAt()).toBeNull();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(s.nextRunAt()!.getTime()).toBe(T0 + 5_000 + H);
    await vi.advanceTimersByTimeAsync(H);
    expect(exec.mock.calls.map(([req]) => req.trigger)).toEqual(["startup", "interval"]);
    s.stop();
    expect(s.nextRunAt()).toBeNull();
    await vi.advanceTimersByTimeAsync(2 * H);
    expect(exec).toHaveBeenCalledTimes(2);
  });
});
