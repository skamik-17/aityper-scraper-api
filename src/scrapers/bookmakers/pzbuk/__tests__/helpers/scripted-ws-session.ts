/**
 * Test-only scripted `WsSession`: delivers recorded frames in reply to what
 * the client sends, without a socket or timers.
 *
 * `collect` queues the "open" step's frames, feeds queued frames through
 * `reduce` in order (isBinary = true) and checks `done` after each. A `send`
 * matching the next unconsumed step's RegExp appends that step's frames. When
 * the queue drains before `done`, `collect` rejects with `failWith` if given,
 * else resolves `{ state, timedOut: true }`.
 */
import type { WsSession } from "../../../../shared/ws/ws-session.js";

export interface ScriptStep {
  after: "open" | RegExp;
  frames: Buffer[];
}

export interface ScriptedSession extends WsSession {
  sent: string[];
  /** The timeoutMs of every collect call. */
  timeouts: number[];
  closed: boolean;
}

export function scriptedSession(steps: ScriptStep[], opts: { failWith?: Error } = {}): ScriptedSession {
  const queue: Buffer[] = [];
  let next = 0;
  const consumeIf = (matches: (after: ScriptStep["after"]) => boolean) => {
    const step = steps[next];
    if (step !== undefined && matches(step.after)) {
      queue.push(...step.frames);
      next++;
    }
  };

  const session: ScriptedSession = {
    sent: [],
    timeouts: [],
    closed: false,
    stats: { framesReceived: 0, bytesReceived: 0 },

    send(data: string) {
      session.sent.push(data);
      consumeIf((after) => after instanceof RegExp && after.test(data));
    },

    async collect<S>(
      init: S,
      reduce: (state: S, frame: Buffer, isBinary: boolean) => S,
      done: (state: S) => boolean,
      timeoutMs: number
    ): Promise<{ state: S; timedOut: boolean }> {
      session.timeouts.push(timeoutMs);
      consumeIf((after) => after === "open");
      let state = init;
      while (queue.length > 0) {
        const frame = queue.shift()!;
        session.stats.framesReceived++;
        session.stats.bytesReceived += frame.length;
        state = reduce(state, frame, true);
        if (done(state)) return { state, timedOut: false };
      }
      if (opts.failWith) throw opts.failWith;
      return { state, timedOut: true };
    },

    async close() {
      session.closed = true;
    },
  };
  return session;
}
