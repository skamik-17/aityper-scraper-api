/**
 * A small request/response client for BetConstruct's Swarm protocol on top of
 * the shared WsSession. WsSession allows one `collect` at a time and has no
 * request/response, so the client runs ONE collect for the session's lifetime
 * as a dispatcher: its reducer parses each frame and settles the pending
 * request with the same `rid`.
 *
 * The budget is never listened to directly: a budget abort reaches pending
 * requests as the dispatcher's BudgetExceededError rejection.
 */
import type { ScrapeBudget } from "../../shared/budget.js";
import { DEFAULT_USER_AGENT } from "../../shared/http/http-client.js";
import { openWsSession, type WsSession } from "../../shared/ws/ws-session.js";
import { SWARM_TRANSPORT } from "./constants.js";
import type { SwarmPartnerConfig } from "./swarm-config.js";
import type { SwarmData } from "./types.js";

export type SwarmLevel = "sport" | "region" | "competition" | "game" | "market" | "event";
export type SwarmWhat = Readonly<Record<SwarmLevel, readonly string[]>>;

/** Every field parser.ts and the SwarmGame/SwarmMarket/SwarmEvent types read */
export const SWARM_WHAT: SwarmWhat = {
  sport: ["id", "name", "alias"],
  region: ["id", "name", "alias"],
  competition: ["id", "name"],
  game: ["id", "team1_name", "team2_name", "team1_id", "team2_id", "start_ts", "markets_count", "is_blocked", "game_number"],
  market: ["id", "name", "type", "order", "base", "col_count"],
  event: ["id", "name", "price", "order", "type_1", "base"],
};

/** Prematch games of one competition with their 1X2 market (the listing) */
export function swarmListingParams(competitionId: number): Record<string, unknown> {
  return {
    source: "betting",
    what: SWARM_WHAT,
    where: {
      sport: { alias: "Soccer" },
      competition: { id: competitionId },
      game: { "@or": [{ type: { "@in": [0, 2] } }, { visible_in_prematch: 1 }] },
      market: { type: "P1XP2" },
    },
    subscribe: false,
  };
}

/** One game with every market */
export function swarmGameParams(gameId: number): Record<string, unknown> {
  return { source: "betting", what: SWARM_WHAT, where: { game: { id: gameId } }, subscribe: false };
}

export const SWARM_WS_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  origin: SWARM_TRANSPORT.ORIGIN,
  "user-agent": DEFAULT_USER_AGENT,
});

export interface SwarmReply {
  code: number;
  rid: string;
  msg?: string;
  data?: { data?: SwarmData };
}

export interface SwarmClient {
  readonly url: string;
  /** The two WsSession counters plus frames that were not JSON */
  readonly stats: { framesReceived: number; bytesReceived: number; nonJsonFrames: number };
  /** What ended the session before close() (a drop, its timeout or a budget abort); null while open or after our own close */
  readonly dropped: Error | null;
  request(command: string, params: Record<string, unknown>, timeoutMs: number): Promise<SwarmReply>;
  /** Idempotent; never rejects (a server may report 1006 for our own close) */
  close(): Promise<void>;
}

interface PendingRequest {
  command: string;
  resolve(reply: SwarmReply): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function openSwarmClient(
  config: SwarmPartnerConfig,
  budget: ScrapeBudget,
  openSession: typeof openWsSession = openWsSession
): Promise<SwarmClient> {
  const url = config.socketUrl;
  const session: WsSession = await openSession({
    url,
    headers: { ...SWARM_WS_HEADERS },
    budget,
    connectTimeoutMs: SWARM_TRANSPORT.CONNECT_TIMEOUT_MS,
  });

  const pending = new Map<string, PendingRequest>();
  let nextRid = 0;
  let nonJsonFrames = 0;
  let closed = false;
  let closing: Promise<void> | null = null;
  // Once set, every pending and later request fails with it.
  let sticky: Error | null = null;
  let dropped: Error | null = null;

  const failAll = (error: Error) => {
    sticky ??= error;
    for (const [rid, req] of pending) {
      clearTimeout(req.timer);
      pending.delete(rid);
      req.reject(error);
    }
  };

  const onFrame = (frame: Buffer) => {
    const text = frame.toString();
    if (!text.startsWith("{")) {
      nonJsonFrames++;
      return;
    }
    let msg: SwarmReply;
    try {
      msg = JSON.parse(text);
    } catch {
      nonJsonFrames++;
      return;
    }
    const req = pending.get(String(msg?.rid));
    // Unknown rid: a late reply to a timed-out request, or a delta (rid "0")
    if (!req) return;
    clearTimeout(req.timer);
    pending.delete(String(msg.rid));
    if (msg.code !== 0) req.reject(new Error(`swarm ${req.command} code ${msg.code} ${url}`));
    else req.resolve(msg);
  };

  // The dispatcher: one collect for the session's lifetime, done only after close().
  const dispatcherTimeoutMs = budget.remainingMs();
  session
    .collect<null>(
      null,
      (state, frame) => {
        onFrame(frame);
        return state;
      },
      () => closed,
      dispatcherTimeoutMs
    )
    .then(
      ({ timedOut }) => {
        if (closed || !timedOut) return;
        dropped = new Error(`ws timeout ${dispatcherTimeoutMs}ms ${url}`);
        failAll(dropped);
      },
      (error) => {
        if (closed) return;
        dropped = asError(error);
        failAll(dropped);
      }
    );

  const client: SwarmClient = {
    url,
    get stats() {
      return {
        framesReceived: session.stats.framesReceived,
        bytesReceived: session.stats.bytesReceived,
        nonJsonFrames,
      };
    },
    get dropped() {
      return dropped;
    },
    request(command, params, timeoutMs) {
      return new Promise<SwarmReply>((resolve, reject) => {
        if (sticky) return reject(sticky);
        try {
          budget.checkpoint();
        } catch (error) {
          return reject(asError(error));
        }
        // Never "0": Swarm uses it for subscription deltas
        const rid = `r${++nextRid}`;
        const timer = setTimeout(() => {
          if (pending.delete(rid)) reject(new Error(`ws timeout ${timeoutMs}ms ${url}`));
        }, timeoutMs);
        pending.set(rid, { command, resolve, reject, timer });
        try {
          session.send(JSON.stringify({ command, params, rid }));
        } catch (error) {
          clearTimeout(timer);
          pending.delete(rid);
          reject(asError(error));
        }
      });
    },
    close() {
      closing ??= (async () => {
        closed = true;
        failAll(new Error(`ws closed by client ${url}`));
        try {
          await session.close();
        } catch {
          // A close never fails the caller
        }
      })();
      return closing;
    },
  };

  try {
    await client.request(
      "request_session",
      { language: SWARM_TRANSPORT.LANGUAGE, site_id: config.siteId, source: SWARM_TRANSPORT.SOURCE },
      SWARM_TRANSPORT.SESSION_TIMEOUT_MS
    );
  } catch (error) {
    void client.close();
    throw error;
  }
  return client;
}
