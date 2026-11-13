/**
 * A budget-bound WebSocket session for browserless scrapers: open with a
 * connect timeout, collect frames into a state until done/timeout, and close.
 * Frames that arrive while no collect runs are queued and replayed first.
 */
import WebSocket from "ws";
import { BudgetExceededError, type ScrapeBudget } from "../budget.js";
import { DEFAULT_USER_AGENT } from "../http/http-client.js";

export interface WsSessionOptions {
  url: string;
  headers?: Record<string, string>;
  budget: ScrapeBudget;
  /** Default 10 000. */
  connectTimeoutMs?: number;
}

export interface WsSession {
  send(data: string): void;
  collect<S>(
    init: S,
    reduce: (state: S, frame: Buffer, isBinary: boolean) => S,
    done: (state: S) => boolean,
    timeoutMs: number,
  ): Promise<{ state: S; timedOut: boolean }>;
  close(): Promise<void>;
  readonly stats: { framesReceived: number; bytesReceived: number };
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const CLOSE_GRACE_MS = 1_000;

function budgetError(budget: ScrapeBudget): Error {
  try {
    budget.checkpoint();
  } catch (e) {
    return e as Error;
  }
  return new BudgetExceededError("scrape aborted");
}

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data as ArrayBuffer);
}

const lowerKeys = (h: Record<string, string> = {}) =>
  Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));

interface ActiveCollect {
  onFrame(frame: Buffer, isBinary: boolean): void;
  onClose(code: number): void;
  onAbort(): void;
}

export async function openWsSession(opts: WsSessionOptions): Promise<WsSession> {
  const { url, budget } = opts;
  budget.checkpoint();
  const connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

  const ws = new WebSocket(url, {
    headers: { "user-agent": DEFAULT_USER_AGENT, ...lowerKeys(opts.headers) },
    perMessageDeflate: true,
  });

  const stats = { framesReceived: 0, bytesReceived: 0 };
  const queue: Array<{ frame: Buffer; isBinary: boolean }> = [];
  let active: ActiveCollect | null = null;
  let closedCode: number | null = null;

  ws.on("message", (data, isBinary) => {
    const frame = toBuffer(data);
    stats.framesReceived++;
    stats.bytesReceived += frame.length;
    if (active) active.onFrame(frame, isBinary);
    else queue.push({ frame, isBinary });
  });
  ws.on("close", (code) => {
    closedCode = code;
    active?.onClose(code);
  });

  // The session's only budget listener sits on a derived signal.
  const derived = AbortSignal.any([budget.signal]);
  const onBudgetAbort = () => {
    ws.terminate();
    active?.onAbort();
  };

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      derived.removeEventListener("abort", onOpenAbort);
      if (err) {
        try {
          ws.terminate();
        } catch {
          // already closed
        }
        reject(err);
      } else {
        resolve();
      }
    };
    const timer = setTimeout(() => finish(new Error(`ws timeout ${connectTimeoutMs}ms ${url}`)), connectTimeoutMs);
    const onOpenAbort = () => finish(budgetError(budget));
    derived.addEventListener("abort", onOpenAbort, { once: true });
    ws.once("open", () => finish());
    ws.once("unexpected-response", (_req, res) => finish(new Error(`ws handshake HTTP ${res.statusCode} ${url}`)));
    // Stays attached for the socket's life: later errors are followed by "close".
    ws.on("error", (err: Error & { code?: string }) => finish(new Error(`ws failed ${err.code ?? err.message} ${url}`)));
  });

  derived.addEventListener("abort", onBudgetAbort, { once: true });

  let closing: Promise<void> | null = null;

  return {
    stats,

    send(data: string) {
      if (closedCode !== null || ws.readyState !== WebSocket.OPEN) {
        throw new Error(`ws closed ${closedCode ?? 1006} ${url}`);
      }
      ws.send(data);
    },

    collect<S>(
      init: S,
      reduce: (state: S, frame: Buffer, isBinary: boolean) => S,
      done: (state: S) => boolean,
      timeoutMs: number,
    ): Promise<{ state: S; timedOut: boolean }> {
      if (active) return Promise.reject(new Error("ws collect already active"));
      if (budget.signal.aborted) return Promise.reject(budgetError(budget));
      if (closedCode !== null) return Promise.reject(new Error(`ws closed ${closedCode} ${url}`));

      return new Promise((resolve, reject) => {
        let state = init;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const me: ActiveCollect = {
          onFrame: (frame, isBinary) => {
            try {
              state = reduce(state, frame, isBinary);
              if (done(state)) end(() => resolve({ state, timedOut: false }));
            } catch (e) {
              end(() => reject(e));
            }
          },
          onClose: (code) => end(() => reject(new Error(`ws closed ${code} ${url}`))),
          onAbort: () => end(() => reject(budgetError(budget))),
        };
        const end = (settle: () => void) => {
          if (active !== me) return;
          active = null;
          if (timer) clearTimeout(timer);
          settle();
        };
        active = me;

        // Replay frames that arrived while nobody was collecting; whatever is
        // left after `done` stays queued for the next collect.
        while (active === me && queue.length > 0) {
          const { frame, isBinary } = queue.shift()!;
          me.onFrame(frame, isBinary);
        }
        if (active !== me) return;

        timer = setTimeout(() => end(() => resolve({ state, timedOut: true })), timeoutMs);
      });
    },

    close() {
      closing ??= new Promise<void>((resolve) => {
        derived.removeEventListener("abort", onBudgetAbort);
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        const t = setTimeout(() => {
          ws.terminate();
          resolve();
        }, CLOSE_GRACE_MS);
        ws.once("close", () => {
          clearTimeout(t);
          resolve();
        });
        ws.close(1000);
      });
      return closing;
    },
  };
}
