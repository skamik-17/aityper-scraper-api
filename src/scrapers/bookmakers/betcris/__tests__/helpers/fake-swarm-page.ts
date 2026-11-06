/**
 * Test-only Playwright `Page` fake that replays recorded Swarm WebSocket traffic
 * on (vitest fake) timers.
 *
 * Each `goto` asks the script for the attempt to replay, cancels whatever the
 * previous attempt still had scheduled, and schedules every recorded event at
 * `Math.round(t * timeScale)` ms after the call. The fake is deliberately generic
 * (`on`/`off` for any event name, `url()`, `mainFrame()`, `title()`) so that page
 * wrappers such as a navigation recorder can subscribe to it as well.
 *
 * This module imports nothing from the scraper itself.
 */

import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { vi } from "vitest";

export interface RecordedSwarmEvent {
  /** ms since page.goto start */
  t: number;
  kind: "goto" | "domcontentloaded" | "redirect" | "open" | "sent" | "recv" | "close";
  /** Socket URL for `open` */
  wsUrl?: string;
  /** New page URL for `redirect` */
  url?: string;
  /** Frame payload for `sent` / `recv` */
  payload?: string;
}

export interface FakeAttemptScript {
  events: RecordedSwarmEvent[];
  /** Multiplies every recorded `t` (simulates a slower renderer) */
  timeScale?: number;
  /** Rejects `goto` this many ms after the call (not scaled) */
  gotoRejectAtMs?: number;
  gotoRejectMessage?: string;
  /** Value returned by `page.title()` for this attempt */
  title?: string;
}

export interface FakeSwarmPage {
  page: Page;
  /** `on:<event>`, `off:<event>` and `goto:<url>` in call order */
  calls: string[];
  /** `Date.now()` at every `goto` call */
  gotoAt: number[];
}

const DEFAULT_WS_URL = "wss://eu-swarm-springre.trexname.com/";
const DEFAULT_GOTO_REJECT_MESSAGE = "page.goto: Timeout 30000ms exceeded.";
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

class FakeWebSocket extends EventEmitter {
  constructor(private readonly socketUrl: string) {
    super();
  }

  url(): string {
    return this.socketUrl;
  }
}

type Listener = (...args: any[]) => void;

export function createFakeSwarmPage(
  script: (url: string, gotoIndex: number) => FakeAttemptScript
): FakeSwarmPage {
  const calls: string[] = [];
  const gotoAt: number[] = [];
  const emitter = new EventEmitter();
  let currentUrl = "about:blank";
  let currentTitle = "";
  let socket: FakeWebSocket | null = null;
  let pending: Array<ReturnType<typeof setTimeout>> = [];
  const mainFrame = { url: () => currentUrl };

  const page = {
    on(event: string, listener: Listener) {
      calls.push(`on:${event}`);
      emitter.on(event, listener);
      return page;
    },
    off(event: string, listener: Listener) {
      calls.push(`off:${event}`);
      emitter.off(event, listener);
      return page;
    },
    url: () => currentUrl,
    mainFrame: () => mainFrame,
    title: async () => currentTitle,
    goto(url: string, _options?: unknown): Promise<null> {
      calls.push(`goto:${url}`);
      gotoAt.push(Date.now());
      for (const timer of pending) clearTimeout(timer);
      pending = [];

      const attempt = script(url, gotoAt.length - 1);
      const scale = attempt.timeScale ?? 1;
      currentUrl = url;
      currentTitle = attempt.title ?? "";
      socket = null;

      return new Promise<null>((resolve, reject) => {
        let settled = false;
        const settleOnce = (fn: () => void) => {
          if (settled) return;
          settled = true;
          fn();
        };
        const schedule = (ms: number, fn: () => void) => {
          pending.push(setTimeout(fn, ms));
        };

        for (const event of attempt.events) {
          schedule(Math.round(event.t * scale), () => {
            switch (event.kind) {
              case "goto":
                break;
              case "domcontentloaded":
                settleOnce(() => resolve(null));
                break;
              case "redirect":
                currentUrl = event.url ?? currentUrl;
                emitter.emit("framenavigated", mainFrame);
                break;
              case "open":
                socket = new FakeWebSocket(event.wsUrl ?? DEFAULT_WS_URL);
                emitter.emit("websocket", socket);
                break;
              case "sent":
                socket?.emit("framesent", { payload: event.payload ?? "" });
                break;
              case "recv":
                socket?.emit("framereceived", { payload: event.payload ?? "" });
                break;
              case "close":
                socket?.emit("close", socket);
                break;
            }
          });
        }

        if (attempt.gotoRejectAtMs !== undefined) {
          schedule(attempt.gotoRejectAtMs, () =>
            settleOnce(() =>
              reject(new Error(attempt.gotoRejectMessage ?? DEFAULT_GOTO_REJECT_MESSAGE))
            )
          );
        }
      });
    },
  };

  return { page: page as unknown as Page, calls, gotoAt };
}

/** JSON.parse of `__tests__/fixtures/<fileName>` */
export function loadFixture<T = any>(fileName: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, fileName), "utf8")) as T;
}

/** The `events` array of a recorded Swarm session fixture */
export function loadRecording(fileName: string): RecordedSwarmEvent[] {
  return loadFixture<{ events: RecordedSwarmEvent[] }>(fileName).events;
}

/**
 * Advance fake timers in `stepMs` steps until `p` settles, then return it
 * (rejections propagate). Throws if it is still pending after `maxMs`.
 */
export async function settle<T>(p: Promise<T>, stepMs = 100, maxMs = 600_000): Promise<T> {
  let done = false;
  p.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    }
  );
  for (let elapsed = 0; !done; elapsed += stepMs) {
    if (elapsed >= maxMs) {
      throw new Error(`settle: promise still pending after ${maxMs} ms of fake time`);
    }
    await vi.advanceTimersByTimeAsync(stepMs);
  }
  return p;
}
