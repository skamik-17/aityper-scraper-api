import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunCoordinator, type RunRequest } from "../run-coordinator.js";

const IDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const REQ: RunRequest = { trigger: "interval", leagues: ["premier-league", "laliga"], bookmakers: ["sts", "forbet"] };
const seq = (ids: string[]) => {
  let i = 0;
  return () => ids[i++ % ids.length];
};

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RunCoordinator", () => {
  it("one run id per league; runId is the first league's; a second start is refused", () => {
    const exec = vi.fn(() => new Promise<void>(() => {}));
    const c = new RunCoordinator(exec, { uuid: seq(IDS) });
    expect(c.start(REQ)).toMatchObject({ accepted: true, run: { runId: IDS[0], runIds: { "premier-league": IDS[0], laliga: IDS[1] } } });
    expect(exec).toHaveBeenCalledWith(REQ, { runIds: { "premier-league": IDS[0], laliga: IDS[1] }, signal: expect.any(AbortSignal) });
    expect(c.start({ trigger: "admin", leagues: ["premier-league"], bookmakers: ["pzbuk"] }))
      .toMatchObject({ accepted: false, running: { runId: IDS[0], trigger: "interval" } });
  });

  it("refuses an empty league list", () => {
    const c = new RunCoordinator(vi.fn(async () => {}));
    expect(() => c.start({ ...REQ, leagues: [] })).toThrow("RunRequest.leagues is empty");
  });

  it("releases the lock when the run rejects; done never rejects", async () => {
    const c = new RunCoordinator(vi.fn(async () => {
      throw new Error("boom");
    }), { uuid: seq(IDS) });
    const r = c.start(REQ);
    if (!r.accepted) throw new Error("not accepted");
    await r.run.done;
    expect(c.current()).toBeNull();
    expect(c.start(REQ).accepted).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(`[Coordinator] run ${IDS[0]} failed: boom`);
  });

  it("abort() aborts ctx.signal with new Error(reason), false when idle", () => {
    let ctxSignal: AbortSignal | undefined;
    const c = new RunCoordinator((_req, ctx) => {
      ctxSignal = ctx.signal;
      return new Promise<void>(() => {});
    });
    c.start(REQ);
    expect(c.abort("shutdown: SIGTERM")).toBe(true);
    expect(ctxSignal!.aborted).toBe(true);
    expect((ctxSignal!.reason as Error).message).toBe("shutdown: SIGTERM");
    expect(new RunCoordinator(vi.fn(async () => {})).abort("x")).toBe(false);
  });

  it("drain(3000) is true when the run ends within 1 s and false for a hung run", async () => {
    vi.useFakeTimers();
    const ending = new RunCoordinator(() => new Promise<void>((r) => setTimeout(r, 1_000)));
    ending.start(REQ);
    const drained = ending.drain(3_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await drained).toBe(true);

    const hung = new RunCoordinator(() => new Promise<void>(() => {}));
    hung.start(REQ);
    const stuck = hung.drain(3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await stuck).toBe(false);
  });

  it("whenIdle resolves at once when idle and after the run otherwise", async () => {
    await new RunCoordinator(vi.fn(async () => {})).whenIdle();
    let finish!: () => void;
    const c = new RunCoordinator(() => new Promise<void>((r) => (finish = r)));
    c.start(REQ);
    let idle = false;
    const w = c.whenIdle().then(() => (idle = true));
    await Promise.resolve();
    expect(idle).toBe(false);
    finish();
    await w;
    expect(idle).toBe(true);
  });
});
