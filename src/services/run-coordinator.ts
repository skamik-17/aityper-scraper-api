/**
 * One scrape run at a time, whatever starts it (startup, interval, admin). A run gets
 * one id per league and an AbortSignal; a second start while one runs is refused with
 * the running run, so a caller can answer 409 instead of racing it.
 */
import { randomUUID } from "node:crypto";
import type { PolishBookmaker } from "../config/index.js";

export type RunTrigger = "startup" | "interval" | "admin";

export interface RunRequest {
  trigger: RunTrigger;
  leagues: readonly string[];
  bookmakers: readonly PolishBookmaker[];
}

export interface RunExecutionContext {
  runIds: Readonly<Record<string, string>>;
  signal: AbortSignal;
}

export interface RunHandle {
  runId: string;
  runIds: Readonly<Record<string, string>>;
  trigger: RunTrigger;
  leagues: readonly string[];
  bookmakers: readonly PolishBookmaker[];
  startedAt: Date;
  /** Settles when the run ends; never rejects. */
  done: Promise<void>;
}

export type StartResult = { accepted: true; run: RunHandle } | { accepted: false; running: RunHandle };

export class RunCoordinator {
  private active: { handle: RunHandle; controller: AbortController } | null = null;
  private readonly uuid: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly execute: (req: RunRequest, ctx: RunExecutionContext) => Promise<void>,
    deps: { uuid?: () => string; now?: () => Date } = {},
  ) {
    this.uuid = deps.uuid ?? (() => randomUUID());
    this.now = deps.now ?? (() => new Date());
  }

  /** Starts a run unless one is running; one uuid per league, runId = the first league's. */
  start(req: RunRequest): StartResult {
    if (req.leagues.length === 0) throw new Error("RunRequest.leagues is empty");
    if (this.active) return { accepted: false, running: this.active.handle };

    const runIds: Record<string, string> = {};
    for (const league of req.leagues) runIds[league] = this.uuid();
    const runId = runIds[req.leagues[0]];
    const controller = new AbortController();
    const startedAt = this.now();
    const handle: RunHandle = {
      runId,
      runIds,
      trigger: req.trigger,
      leagues: req.leagues,
      bookmakers: req.bookmakers,
      startedAt,
      done: Promise.resolve(),
    };
    this.active = { handle, controller };
    console.log(
      `[Coordinator] run ${runId} started (${req.trigger}) at ${startedAt.toISOString()}: leagues=${req.leagues.join(",")} bookmakers=${req.bookmakers.length}`,
    );

    const t0 = Date.now();
    handle.done = (async () => {
      try {
        await this.execute(req, { runIds, signal: controller.signal });
        console.log(`[Coordinator] run ${runId} finished in ${Date.now() - t0}ms`);
      } catch (error) {
        console.error(`[Coordinator] run ${runId} failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (this.active?.handle === handle) this.active = null;
      }
    })();
    return { accepted: true, run: handle };
  }

  current(): RunHandle | null {
    return this.active?.handle ?? null;
  }

  /** Aborts the running run's signal with new Error(reason); false when idle. */
  abort(reason: string): boolean {
    if (!this.active) return false;
    this.active.controller.abort(new Error(reason));
    return true;
  }

  whenIdle(): Promise<void> {
    return this.active ? this.active.handle.done : Promise.resolve();
  }

  /** True when the coordinator is idle within timeoutMs. */
  async drain(timeoutMs: number): Promise<boolean> {
    if (!this.active) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      return await Promise.race([this.active.handle.done.then(() => true), timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }
}
