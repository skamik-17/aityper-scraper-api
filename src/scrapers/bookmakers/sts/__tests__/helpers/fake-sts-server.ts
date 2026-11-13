/**
 * An in-memory STS WebSocket server behind the WsSession interface, with the
 * semantics of src/scrapers/shared/ws/ws-session.ts:
 * - send() answers each `u` entry with `n:0` by queueing that topic's frames;
 * - the queue is delivered on the next macrotask (setImmediate) to the active
 *   collect; frames that arrive with no active collect stay queued and are
 *   replayed first by the next one;
 * - collect resolves `timedOut: false` as soon as `done` holds after a frame
 *   (left-over frames stay queued) and `timedOut: true` when a delivery turn
 *   ends with nothing queued. There is no real waiting.
 */
import type { WsSession, WsSessionOptions } from "../../../../shared/ws/ws-session.js";
import type { ScrapeBudget } from "../../../../shared/budget.js";
import type { FullOfferScraperResult } from "../../../../../types/full-offer.js";
import { StsWsScraper } from "../../ws-scraper.js";
import { captureLines, type StsReplayInput } from "./sts-frames.js";

export interface FakeStsServerOptions {
  /** Frames answering an i_pl n:0 request, in order */
  ipl: readonly string[];
  /** Frames answering f_<id>_pl n:0, by fixture id */
  fixtures: Readonly<Record<string, readonly string[]>>;
  /** Ids not answered on their first n:0 request */
  silentFirst?: readonly string[];
  /** Ids never answered */
  silentAlways?: readonly string[];
  /** open() rejects with it */
  openError?: Error;
  /** The n-th open() rejects with the n-th entry (undefined = opens) */
  openErrorsInOrder?: ReadonlyArray<Error | undefined>;
  /** The collect active at the first fixture request rejects with it */
  closeOnFixtureRequest?: Error;
  /** Only this many sessions, from the first, close on their fixture request (default: every one) */
  closingSessions?: number;
}

export interface FakeStsServer {
  open(opts: WsSessionOptions): Promise<WsSession>;
  opened: WsSessionOptions[];
  sent: string[];
  collectTimeouts: number[];
  closeCalls: number;
}

interface ActiveCollect {
  deliver(frame: string): boolean; // true = done
  timeOut(): void;
  fail(error: Error): void;
}

const FIXTURE_TOPIC = /^f_(f\d+)_pl$/;

export function createFakeStsServer(opts: FakeStsServerOptions): FakeStsServer {
  const askedOnce = new Set<string>();

  const server: FakeStsServer = {
    opened: [],
    sent: [],
    collectTimeouts: [],
    closeCalls: 0,

    async open(sessionOpts: WsSessionOptions): Promise<WsSession> {
      server.opened.push(sessionOpts);
      if (opts.openError) throw opts.openError;
      const openError = opts.openErrorsInOrder?.[server.opened.length - 1];
      if (openError) throw openError;
      const closesOnFixtureRequest = server.opened.length <= (opts.closingSessions ?? Infinity);

      const queue: string[] = [];
      const stats = { framesReceived: 0, bytesReceived: 0 };
      let active: ActiveCollect | null = null;
      let closedWith: Error | null = null;

      const turn = () => {
        setImmediate(() => {
          const collect = active;
          if (!collect) return;
          if (closedWith) return collect.fail(closedWith);
          while (queue.length > 0) {
            const frame = queue.shift()!;
            stats.framesReceived++;
            stats.bytesReceived += Buffer.byteLength(frame, "utf8");
            if (collect.deliver(frame)) return;
          }
          collect.timeOut();
        });
      };

      const answer = (topic: string): readonly string[] => {
        if (topic === "i_pl") return opts.ipl;
        const id = FIXTURE_TOPIC.exec(topic)?.[1];
        if (!id) return [];
        const first = !askedOnce.has(id);
        askedOnce.add(id);
        if (opts.silentAlways?.includes(id)) return [];
        if (first && opts.silentFirst?.includes(id)) return [];
        return opts.fixtures[id] ?? [];
      };

      return {
        stats,

        send(data: string) {
          if (closedWith) throw closedWith;
          server.sent.push(data);
          const msg = JSON.parse(data) as { t: number; u?: Array<{ s: string; n?: number }> };
          for (const entry of msg.u ?? []) {
            if (entry.n !== 0) continue;
            if (opts.closeOnFixtureRequest && closesOnFixtureRequest && FIXTURE_TOPIC.test(entry.s) && !closedWith) {
              closedWith = opts.closeOnFixtureRequest;
              turn();
              return;
            }
            queue.push(...answer(entry.s));
          }
          if (active) turn();
        },

        collect<S>(
          init: S,
          reduce: (state: S, frame: Buffer, isBinary: boolean) => S,
          done: (state: S) => boolean,
          timeoutMs: number,
        ): Promise<{ state: S; timedOut: boolean }> {
          server.collectTimeouts.push(timeoutMs);
          if (active) return Promise.reject(new Error("ws collect already active"));
          if (closedWith) return Promise.reject(closedWith);
          return new Promise((resolve, reject) => {
            let state = init;
            const finish = (settle: () => void) => {
              if (active !== me) return;
              active = null;
              settle();
            };
            const me: ActiveCollect = {
              deliver: (frame) => {
                state = reduce(state, Buffer.from(frame, "utf8"), false);
                if (!done(state)) return false;
                finish(() => resolve({ state, timedOut: false }));
                return true;
              },
              timeOut: () => finish(() => resolve({ state, timedOut: true })),
              fail: (error) => finish(() => reject(error)),
            };
            active = me;
            turn();
          });
        },

        async close() {
          server.closeCalls++;
        },
      };
    },
  };
  return server;
}

export async function runWsPath(
  input: StsReplayInput,
  extra: Partial<FakeStsServerOptions> = {},
  budget?: ScrapeBudget,
  league = "premier-league",
): Promise<{ value: FullOfferScraperResult; lines: string[]; server: FakeStsServer; scraper: StsWsScraper }> {
  const server = createFakeStsServer({ ipl: [input.ipl], fixtures: input.byFixture, ...extra });
  const scraper = new StsWsScraper({ openSession: server.open, retryDelayMs: () => 0 });
  const { value, lines } = await captureLines(() => scraper.scrapeFullOffer(league, budget));
  return { value, lines, server, scraper };
}
