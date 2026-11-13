import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShutdown, installProcessHandlers, type ShutdownDeps } from "../shutdown.js";

let order: string[];
let deps: ShutdownDeps & { exit: ReturnType<typeof vi.fn> };
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-07T10:00:00.000Z") });
  order = [];
  deps = {
    stopScheduler: () => void order.push("stopScheduler"),
    coordinator: {
      abort: (reason: string) => (order.push(`abort:${reason}`), true),
      drain: async (ms: number) => (order.push(`drain:${ms}`), true),
    },
    closeBrowsers: async () => void order.push("closeBrowsers"),
    closeServer: () => void order.push("closeServer"),
    exit: vi.fn((code: number) => void order.push(`exit:${code}`)),
  };
  vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("shutdown", () => {
  it("SIGTERM: stop scheduler, abort the run, drain 3 s, close browsers, exit 0", async () => {
    await createShutdown(deps)("SIGTERM");
    expect(order).toEqual(["stopScheduler", "abort:shutdown: SIGTERM", "drain:3000", "closeBrowsers", "closeServer", "exit:0"]);
  });

  it("browsers that never close cost at most 1.5 s", async () => {
    deps.closeBrowsers = () => new Promise(() => {});
    const p = createShutdown(deps)("SIGTERM");
    await vi.advanceTimersByTimeAsync(1_500);
    await p;
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it("a hung drain is cut by the 10 s hard exit with code 1 (Review Focus 3)", async () => {
    deps.coordinator.drain = () => new Promise(() => {});
    void createShutdown(deps)("SIGTERM");
    await vi.advanceTimersByTimeAsync(9_999);
    expect(deps.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it("unhandledRejection is logged and nothing exits; a second signal exits 1 at once", async () => {
    const shutdown = vi.fn(async () => {});
    const proc = new EventEmitter();
    installProcessHandlers(proc as never, shutdown);
    proc.emit("unhandledRejection", new Error("late page.evaluate"), Promise.resolve());
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[Process\] Unhandled rejection \(kept running\): Error: late page\.evaluate/));
    expect(shutdown).not.toHaveBeenCalled();
    proc.emit("SIGTERM");
    expect(shutdown).toHaveBeenCalledWith("SIGTERM");

    deps.coordinator.drain = () => new Promise(() => {});
    const real = createShutdown(deps);
    void real("SIGINT");
    await real("SIGINT");
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(order.filter((x) => x.startsWith("exit"))).toEqual(["exit:1"]);
  });
});
