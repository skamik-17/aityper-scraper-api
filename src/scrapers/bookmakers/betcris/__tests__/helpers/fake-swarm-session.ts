/**
 * Test-only fake of plan 02's openWsSession for the Swarm client, on (vitest
 * fake) timers. Semantics mirror the real WsSession: one collect at a time,
 * frames that arrive with no collect are queued and replayed into the next one,
 * a close rejects the active collect with `ws closed <code> <url>`, a budget
 * abort rejects it with the budget's error.
 */
import type { openWsSession, WsSession, WsSessionOptions } from "../../../../shared/ws/ws-session.js";
import { SWARM_RECORDED_GAME_ID, loadFixtureText, projectSwarmData, recordedGame, recordedListing } from "./swarm-fixtures.js";

export interface FakeSwarmRequest {
  command: string;
  params: any;
  rid: string;
}

export type FakeSwarmAnswer = string | { frame: string; delayMs: number } | "silent" | { closeCode: number };

export interface FakeSwarm {
  open: typeof openWsSession;
  opened: WsSessionOptions[];
  sent: FakeSwarmRequest[];
  closed: number;
  maxInFlight: number;
}

const DEFAULT_DELAY_MS = 5;

function budgetError(opts: WsSessionOptions): Error {
  try {
    opts.budget.checkpoint();
  } catch (e) {
    return e as Error;
  }
  return new Error("scrape aborted");
}

export function createFakeSwarm(
  answer: (req: FakeSwarmRequest) => FakeSwarmAnswer,
  opts: { openErrors?: Error[] } = {}
): FakeSwarm {
  const openErrors = [...(opts.openErrors ?? [])];
  const fake: FakeSwarm = {
    opened: [],
    sent: [],
    closed: 0,
    maxInFlight: 0,
    open: async (sessionOpts: WsSessionOptions): Promise<WsSession> => {
      fake.opened.push(sessionOpts);
      const openError = openErrors.shift();
      if (openError) throw openError;
      if (sessionOpts.budget.signal.aborted) throw budgetError(sessionOpts);
      return createSession(sessionOpts);
    },
  };

  const createSession = (sessionOpts: WsSessionOptions): WsSession => {
    const { url } = sessionOpts;
    const stats = { framesReceived: 0, bytesReceived: 0 };
    const queue: Buffer[] = [];
    const inFlight = new Set<string>();
    let closedCode: number | null = null;
    let active: { onFrame(frame: Buffer): void; fail(error: Error): void; finish(): void } | null = null;

    const derived = AbortSignal.any([sessionOpts.budget.signal]);
    derived.addEventListener("abort", () => active?.fail(budgetError(sessionOpts)), { once: true });

    const deliver = (rid: string, frame: string) => {
      if (closedCode !== null) return;
      inFlight.delete(rid);
      const buf = Buffer.from(frame);
      stats.framesReceived++;
      stats.bytesReceived += buf.length;
      if (active) active.onFrame(buf);
      else queue.push(buf);
    };

    return {
      stats,
      send(data: string) {
        if (closedCode !== null) throw new Error(`ws closed ${closedCode} ${url}`);
        const msg = JSON.parse(data);
        const req: FakeSwarmRequest = { command: msg.command, params: msg.params, rid: msg.rid };
        fake.sent.push(req);
        inFlight.add(req.rid);
        fake.maxInFlight = Math.max(fake.maxInFlight, inFlight.size);
        const a = answer(req);
        if (a === "silent") return;
        if (typeof a === "string") {
          setTimeout(() => deliver(req.rid, a), DEFAULT_DELAY_MS);
        } else if ("closeCode" in a) {
          setTimeout(() => {
            if (closedCode !== null) return;
            closedCode = a.closeCode;
            active?.fail(new Error(`ws closed ${a.closeCode} ${url}`));
          }, DEFAULT_DELAY_MS);
        } else {
          setTimeout(() => deliver(req.rid, a.frame), a.delayMs);
        }
      },
      collect<S>(init: S, reduce: (state: S, frame: Buffer, isBinary: boolean) => S, done: (state: S) => boolean, timeoutMs: number) {
        if (active) return Promise.reject(new Error("ws collect already active"));
        if (sessionOpts.budget.signal.aborted) return Promise.reject(budgetError(sessionOpts));
        if (closedCode !== null) return Promise.reject(new Error(`ws closed ${closedCode} ${url}`));
        return new Promise<{ state: S; timedOut: boolean }>((resolve, reject) => {
          let state = init;
          const end = (settle: () => void) => {
            if (active !== me) return;
            active = null;
            clearTimeout(timer);
            settle();
          };
          const me = {
            onFrame(frame: Buffer) {
              try {
                state = reduce(state, frame, false);
                if (done(state)) end(() => resolve({ state, timedOut: false }));
              } catch (e) {
                end(() => reject(e));
              }
            },
            fail: (error: Error) => end(() => reject(error)),
            finish: () => end(() => resolve({ state, timedOut: false })),
          };
          active = me;
          const timer = setTimeout(() => end(() => resolve({ state, timedOut: true })), timeoutMs);
          while (active === me && queue.length > 0) me.onFrame(queue.shift()!);
        });
      },
      async close() {
        fake.closed++;
        if (closedCode === null) closedCode = 1000;
        active?.finish();
      },
    };
  };

  return fake;
}

const projectedGames = new Map<string, string>();
const projectedListings = new Map<string, string>();

/** The recorded game reply data projected on `what`, as JSON, for game `id` */
function gameDataJson(id: number, what: any): string {
  const key = JSON.stringify(what);
  let template = projectedGames.get(key);
  if (template === undefined) {
    template = JSON.stringify(projectSwarmData(recordedGame(SWARM_RECORDED_GAME_ID), what));
    projectedGames.set(key, template);
  }
  return template.replaceAll(String(SWARM_RECORDED_GAME_ID), String(id));
}

function listingDataJson(what: any): string {
  const key = JSON.stringify(what);
  let json = projectedListings.get(key);
  if (json === undefined) {
    json = JSON.stringify(projectSwarmData(recordedListing(), what));
    projectedListings.set(key, json);
  }
  return json;
}

const reply = (rid: string, dataJson: string) => `{"code":0,"rid":${JSON.stringify(rid)},"data":{"data":${dataJson}}}`;

/**
 * Answers like the live Swarm backend from the recordings: request_session with
 * the recorded session reply, the competition 538 listing with the recorded
 * GameList, a per-game request with the recorded 613-market game renamed to its
 * id (both projected on the request's `what`), anything else with empty data.
 */
export function recordedAnswer(
  opts: {
    override?: (req: FakeSwarmRequest) => FakeSwarmAnswer | undefined;
    delayMs?: (req: FakeSwarmRequest) => number;
  } = {}
): (req: FakeSwarmRequest) => FakeSwarmAnswer {
  const session = JSON.parse(loadFixtureText("swarm/session-reply.json"));
  return (req) => {
    const overridden = opts.override?.(req);
    if (overridden !== undefined) return overridden;
    let frame: string;
    if (req.command === "request_session") {
      frame = JSON.stringify({ ...session, rid: req.rid });
    } else if (req.command === "get" && req.params?.where?.competition?.id === 538) {
      frame = reply(req.rid, listingDataJson(req.params.what));
    } else if (req.command === "get" && req.params?.where?.game?.id !== undefined) {
      frame = reply(req.rid, gameDataJson(req.params.where.game.id, req.params.what));
    } else {
      frame = reply(req.rid, "{}");
    }
    return { frame, delayMs: opts.delayMs?.(req) ?? DEFAULT_DELAY_MS };
  };
}
