/**
 * Browser Runtime: the one shared Chromium (headless shell) behind every browser path.
 *
 * - One browser, launched on demand (single-flight) and relaunched lazily after a crash.
 * - One BrowserContext per session, capped by a Semaphore whose waiters always settle.
 * - A session ends on the first of: its signal aborting, its lifetime expiring, or the
 *   browser disconnecting. Ending closes the context and frees the permit, so a scraper
 *   operation that never settles cannot hold a permit forever.
 * - The idle browser closes after BROWSER_IDLE_CLOSE_MS; closeIfIdle() closes it at once
 *   (one-shot scripts), closeAll() closes everything and leaves the runtime usable.
 */
import { chromium, type Browser, type BrowserContext, type LaunchOptions, type Page } from "playwright";
import type { PolishBookmaker } from "../../config/index.js";
import { Semaphore } from "./semaphore.js";

// Never add --disable-features: Chromium keeps the last one, which would replace Playwright's own list.
export const BROWSER_ARGS: readonly string[] = [
  "--disable-blink-features=AutomationControlled",
  "--disable-site-isolation-trials",
];

/** The context user agent of every browser session (stealth off). Distinct from the HTTP client's DEFAULT_USER_AGENT. */
export const BROWSER_CONTEXT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const SESSION_VIEWPORT: { readonly width: 1366; readonly height: 768 } = Object.freeze({ width: 1366, height: 768 });

export interface BrowserLauncher {
  launch(options: LaunchOptions): Promise<Browser>;
}

export interface BrowserRuntimeOptions {
  /** Default Number(process.env.BROWSER_MAX_SESSIONS) || 3, read on first use. */
  maxSessions?: number;
  /** Default Number(process.env.BROWSER_IDLE_CLOSE_MS) || 60_000, read on use. */
  idleCloseMs?: number;
  /** Default { headless: true, args: [...BROWSER_ARGS] }. */
  launchOptions?: LaunchOptions;
  /** Default Playwright's chromium (test seam). */
  launcher?: BrowserLauncher;
}

export interface OpenSessionOptions {
  bookmaker: PolishBookmaker;
  /** Aborts the permit wait; after the grant it closes the context. */
  signal?: AbortSignal;
  /** Lifetime counted from the permit grant. */
  maxSessionMs: number;
}

export interface SessionRuntimeInfo {
  crashed(): boolean;
  remainingMs(): number;
  readonly lifetimeMs: number;
}

export interface BrowserSession {
  page: Page;
  browser: Browser;
  context: BrowserContext;
  cleanup: () => Promise<void>;
  /** Set by the runtime; mocked sessions may omit it. */
  runtime?: SessionRuntimeInfo;
}

interface LiveSession {
  readonly bookmaker: PolishBookmaker;
  readonly grantedAt: number;
  readonly lifetimeMs: number;
  readonly release: () => void;
  generation: number;
  context: BrowserContext | null;
  ended: boolean;
  crashed: boolean;
  aborted: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  detachSignal: () => void;
  closing: Promise<void> | null;
}

const reasonText = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason));

export class BrowserRuntime {
  private semaphore: Semaphore | null = null;
  private browser: Promise<Browser> | null = null;
  /** Generation of the newest launch; a crash of an older one does not drop the current browser. */
  private generation = 0;
  /** Bumped by closeAll, so work that started before it never registers afterwards. */
  private epoch = 0;
  private closingAll = false;
  private readonly sessions = new Set<LiveSession>();
  private readonly ending = new Set<Promise<void>>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Browsers this runtime closes itself: their "disconnected" is not a crash. */
  private readonly ownCloses = new WeakSet<Browser>();

  constructor(private readonly options: BrowserRuntimeOptions = {}) {}

  get activeSessions(): number {
    return this.semaphore?.active ?? 0;
  }

  get waitingSessions(): number {
    return this.semaphore?.waiting ?? 0;
  }

  private get maxSessions(): number {
    return this.options.maxSessions ?? (Number(process.env.BROWSER_MAX_SESSIONS) || 3);
  }

  private get idleCloseMs(): number {
    return this.options.idleCloseMs ?? (Number(process.env.BROWSER_IDLE_CLOSE_MS) || 60_000);
  }

  private get permits(): Semaphore {
    this.semaphore ??= new Semaphore(this.maxSessions);
    return this.semaphore;
  }

  async openSession(o: OpenSessionOptions): Promise<BrowserSession> {
    if (this.closingAll) throw new Error("BrowserRuntime is closing");
    const epoch = this.epoch;
    this.cancelIdle();

    const permits = this.permits;
    if (permits.active >= this.maxSessions && !o.signal?.aborted) {
      console.log(`[BrowserRuntime] ${o.bookmaker} waiting for a browser session (${permits.active}/${this.maxSessions} in use)`);
    }
    const release = await permits.acquire(o.signal);

    const s: LiveSession = {
      bookmaker: o.bookmaker,
      grantedAt: Date.now(),
      lifetimeMs: o.maxSessionMs,
      release,
      generation: 0,
      context: null,
      ended: false,
      crashed: false,
      aborted: false,
      timer: null,
      detachSignal: () => {},
      closing: null,
    };
    this.sessions.add(s);

    try {
      if (epoch !== this.epoch) throw new Error("BrowserRuntime is closing");
      const { browser, generation } = await this.getBrowser();
      if (epoch !== this.epoch) throw new Error("BrowserRuntime is closing");
      s.generation = generation;
      if (s.ended) throw new Error("Target page, context or browser has been closed");

      const context = await browser.newContext({
        userAgent: BROWSER_CONTEXT_USER_AGENT,
        locale: "pl-PL",
        viewport: { ...SESSION_VIEWPORT },
        serviceWorkers: "block",
        javaScriptEnabled: true,
        ignoreHTTPSErrors: true,
        bypassCSP: true,
      });
      s.context = context;
      if (s.ended || epoch !== this.epoch) throw new Error("BrowserRuntime is closing");
      const page = await context.newPage();
      if (s.ended) throw new Error("Target page, context or browser has been closed");
      if (o.signal?.aborted) throw o.signal.reason;

      this.armSession(s, o.signal);

      return {
        page,
        browser,
        context,
        cleanup: () => this.endSession(s),
        runtime: {
          crashed: () => s.crashed,
          remainingMs: () => (s.aborted ? 0 : Math.max(0, s.grantedAt + s.lifetimeMs - Date.now())),
          lifetimeMs: s.lifetimeMs,
        },
      };
    } catch (error) {
      await this.endSession(s);
      throw error;
    }
  }

  /** Closes the browser now if no session is open; otherwise a no-op. */
  async closeIfIdle(): Promise<void> {
    if (this.activeSessions > 0 || this.waitingSessions > 0) return;
    await this.closeBrowser("closeIfIdle");
  }

  /** Rejects waiters, closes every context, then the browser. The runtime stays usable. */
  async closeAll(): Promise<void> {
    this.closingAll = true;
    this.epoch++;
    this.cancelIdle();
    try {
      this.semaphore?.rejectAll(new Error("BrowserRuntime closeAll"));
      await Promise.all([...this.sessions].map((s) => this.endSession(s)));
      await Promise.all([...this.ending]);
      await this.closeBrowser("closeAll");
    } finally {
      this.closingAll = false;
    }
  }

  private getBrowser(): Promise<{ browser: Browser; generation: number }> {
    if (!this.browser) {
      const generation = ++this.generation;
      const launcher = this.options.launcher ?? chromium;
      const launching = launcher
        .launch(this.options.launchOptions ?? { headless: true, args: [...BROWSER_ARGS] })
        .then((browser) => {
          browser.on("disconnected", () => this.onDisconnected(browser, generation));
          console.log(`[BrowserRuntime] launched Chromium ${browser.version()} (generation ${generation})`);
          return browser;
        });
      this.browser = launching;
      // A failed launch is forgotten, so the next caller launches again
      launching.catch(() => {
        if (this.browser === launching) this.browser = null;
      });
    }
    const generation = this.generation;
    return this.browser.then((browser) => ({ browser, generation }));
  }

  private armSession(s: LiveSession, signal: AbortSignal | undefined): void {
    const left = Math.max(0, s.grantedAt + s.lifetimeMs - Date.now());
    s.timer = setTimeout(() => void this.endSession(s, `browser session exceeded ${s.lifetimeMs}ms`), left);
    (s.timer as { unref?: () => void }).unref?.();
    if (signal) {
      const onAbort = () => {
        s.aborted = true;
        void this.endSession(s, reasonText(signal.reason));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      s.detachSignal = () => signal.removeEventListener("abort", onAbort);
    }
  }

  /** Ends a session once: deregisters it, frees its permit, closes its context. Idempotent. */
  private endSession(s: LiveSession, reason?: string): Promise<void> {
    if (s.ended) return s.closing ?? Promise.resolve();
    s.ended = true;
    if (s.timer) clearTimeout(s.timer);
    s.detachSignal();
    this.sessions.delete(s);
    s.release();
    const context = s.context;
    const done = (async () => {
      if (context) await context.close(reason === undefined ? undefined : { reason }).catch(() => {});
    })();
    s.closing = done;
    this.ending.add(done);
    void done.finally(() => this.ending.delete(done));
    this.scheduleIdle();
    return done;
  }

  private onDisconnected(browser: Browser, generation: number): void {
    if (this.ownCloses.has(browser)) return;
    if (generation === this.generation) this.browser = null;
    const victims = [...this.sessions].filter((s) => s.generation === generation && !s.ended);
    console.log(`[BrowserRuntime] browser disconnected (generation ${generation}, ${victims.length} open sessions failed)`);
    for (const s of victims) {
      s.crashed = true;
      void this.endSession(s);
    }
  }

  private scheduleIdle(): void {
    if (this.closingAll || !this.browser || this.activeSessions > 0 || this.waitingSessions > 0) return;
    this.cancelIdle();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.activeSessions === 0 && this.waitingSessions === 0) void this.closeBrowser("idle");
    }, this.idleCloseMs);
    (this.idleTimer as { unref?: () => void }).unref?.();
  }

  private cancelIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private async closeBrowser(_reason: "idle" | "closeIfIdle" | "closeAll"): Promise<void> {
    this.cancelIdle();
    const pending = this.browser;
    if (!pending) return;
    this.browser = null;
    let browser: Browser;
    try {
      browser = await pending;
    } catch {
      return; // the launch failed: nothing to close
    }
    await Promise.all([...this.ending]);
    this.ownCloses.add(browser);
    await browser.close().catch((error: unknown) => console.error("[BrowserRuntime] error closing the browser:", error));
  }
}

/** The process-wide runtime every PlaywrightScraper session goes through. */
export const browserRuntime = new BrowserRuntime();
