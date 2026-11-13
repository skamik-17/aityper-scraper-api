/**
 * Draining shutdown for SIGTERM/SIGINT (tsx watch SIGKILLs 5 s after SIGTERM): stop the
 * scheduler, abort the run (finished units still persist), drain briefly, close the
 * browsers, close the server, exit. A second signal or the 10 s cap exits 1 at once.
 */
import type { RunCoordinator } from "./run-coordinator.js";

export const SHUTDOWN_BUDGET_MS = { drain: 3_000, browsers: 1_500, hardExit: 10_000 } as const;

export interface ShutdownDeps {
  stopScheduler(): void;
  coordinator: Pick<RunCoordinator, "abort" | "drain">;
  closeBrowsers(): Promise<void>;
  closeServer(): void;
  exit(code: number): void;
}

export function createShutdown(deps: ShutdownDeps): (signal: NodeJS.Signals) => Promise<void> {
  let inProgress = false;
  return async (signal) => {
    if (inProgress) {
      deps.exit(1);
      return;
    }
    inProgress = true;
    const startedAt = Date.now();
    console.log(`[Server] Received ${signal}, shutting down`);
    const hardExit = setTimeout(() => deps.exit(1), SHUTDOWN_BUDGET_MS.hardExit);
    (hardExit as { unref?: () => void }).unref?.();

    deps.stopScheduler();
    deps.coordinator.abort(`shutdown: ${signal}`);
    await deps.coordinator.drain(SHUTDOWN_BUDGET_MS.drain);

    let browsersTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      deps.closeBrowsers().catch(() => {}),
      new Promise<void>((resolve) => {
        browsersTimer = setTimeout(resolve, SHUTDOWN_BUDGET_MS.browsers);
      }),
    ]);
    clearTimeout(browsersTimer);

    deps.closeServer();
    console.log(`[Server] Shutdown complete in ${Date.now() - startedAt}ms`);
    clearTimeout(hardExit);
    deps.exit(0);
  };
}

export function installProcessHandlers(
  proc: Pick<NodeJS.Process, "on">,
  shutdown: (signal: NodeJS.Signals) => Promise<void>,
): void {
  proc.on("SIGTERM", () => void shutdown("SIGTERM"));
  proc.on("SIGINT", () => void shutdown("SIGINT"));
  // A late rejection (e.g. a page.evaluate of an abandoned scrape) must not kill the server
  proc.on("unhandledRejection", (reason: unknown) => {
    console.error(`[Process] Unhandled rejection (kept running): ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
  });
}
