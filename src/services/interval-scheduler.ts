/**
 * The scrape loop: the next run starts `interval ± 10 %` after the last run STARTED
 * (not on wall-clock cron minutes), and never overlaps a run: a tick that finds one
 * running waits for it, then starts.
 */
import type { RunCoordinator, RunRequest } from "./run-coordinator.js";

export const INTERVAL_JITTER_RATIO = 0.1;

/** Delay until the next start; after an overrun at least min(60 s, interval / 2). */
export function computeNextDelayMs(a: {
  lastStartedAt: number;
  now: number;
  intervalMs: number;
  random: number;
  jitterRatio?: number;
}): number {
  const jitter = (a.random * 2 - 1) * (a.jitterRatio ?? INTERVAL_JITTER_RATIO) * a.intervalMs;
  const minGap = Math.min(60_000, a.intervalMs / 2);
  return Math.max(minGap, a.lastStartedAt + a.intervalMs + jitter - a.now);
}

export interface IntervalSchedulerOptions {
  intervalMs: number;
  coordinator: Pick<RunCoordinator, "start" | "whenIdle">;
  /** null: nothing is due on this tick (plan 10); the next tick is scheduled as after a run. */
  request: (trigger: "startup" | "interval") => RunRequest | null;
  random?: () => number;
}

let latest: IntervalScheduler | null = null;

/** nextRunAt() of the most recently started scheduler. */
export function getPlannedNextRun(): Date | null {
  return latest?.nextRunAt() ?? null;
}

export class IntervalScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dueAt: number | null = null;
  private stopped = false;
  private readonly random: () => number;

  constructor(private readonly o: IntervalSchedulerOptions) {
    this.random = o.random ?? Math.random;
  }

  start(firstDelayMs: number, firstTrigger: "startup" | "interval" = "interval"): void {
    this.stopped = false;
    latest = this;
    this.schedule(firstDelayMs, firstTrigger);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.dueAt = null;
  }

  /** The pending tick; null while a run is in progress or after stop(). */
  nextRunAt(): Date | null {
    return this.dueAt === null ? null : new Date(this.dueAt);
  }

  private schedule(delayMs: number, trigger: "startup" | "interval"): void {
    this.dueAt = Date.now() + delayMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.dueAt = null;
      void this.tick(trigger);
    }, delayMs);
  }

  private async tick(trigger: "startup" | "interval"): Promise<void> {
    const tickAt = Date.now();
    let req = this.o.request(trigger);
    let started = req === null ? null : this.o.coordinator.start(req);
    while (started !== null && !started.accepted) {
      const { runId, trigger: runningTrigger } = started.running;
      console.log(`[Scheduler] ${trigger} run waits for run ${runId.slice(0, 8)} (${runningTrigger})`);
      await this.o.coordinator.whenIdle();
      if (this.stopped) return;
      req = this.o.request(trigger);
      started = req === null ? null : this.o.coordinator.start(req);
    }
    let lastStartedAt = tickAt;
    if (started === null) {
      console.log("[Scheduler] nothing due");
    } else {
      await started.run.done;
      if (this.stopped) return;
      lastStartedAt = started.run.startedAt.getTime();
    }
    const delay = computeNextDelayMs({
      lastStartedAt,
      now: Date.now(),
      intervalMs: this.o.intervalMs,
      random: this.random(),
    });
    this.schedule(delay, "interval");
    console.log(`[Scheduler] next run at ${new Date(this.dueAt!).toISOString()}`);
  }
}
