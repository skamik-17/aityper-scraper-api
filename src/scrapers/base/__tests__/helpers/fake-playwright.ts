/**
 * Test-only fakes of the Playwright surface BrowserRuntime uses: a launcher, browsers,
 * contexts, pages and CDP sessions, with the knobs the runtime tests need (deferred
 * launch, launch failure, crash, popups, CDP failures, process CPU info).
 */
import { EventEmitter } from "node:events";
import type { Browser, LaunchOptions } from "playwright";
import type { BrowserLauncher } from "../../browser-runtime.js";

export interface SentCdp {
  method: string;
  params: unknown;
}

export class FakeCdp {
  readonly sent: SentCdp[] = [];
  readonly failOn = new Set<string>();
  private readonly events = new EventEmitter();
  detached = false;

  constructor(private readonly onSend?: (method: string, params: unknown) => unknown) {}

  async send(method: string, params?: unknown): Promise<unknown> {
    this.sent.push({ method, params });
    if (this.failOn.has(method)) throw new Error(`${method} failed`);
    return this.onSend?.(method, params) ?? {};
  }

  on(event: string, handler: (payload: any) => void): this {
    this.events.on(event, handler);
    return this;
  }

  off(event: string, handler: (payload: any) => void): this {
    this.events.off(event, handler);
    return this;
  }

  emit(event: string, payload: unknown): void {
    this.events.emit(event, payload);
  }

  async detach(): Promise<void> {
    this.detached = true;
  }
}

export class FakePage {
  closed = false;
  constructor(readonly fakeContext: FakeContext) {}
  context(): FakeContext {
    return this.fakeContext;
  }
  isClosed(): boolean {
    return this.closed;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

export class FakeContext {
  readonly pages: FakePage[] = [];
  readonly initScripts: string[] = [];
  routeCalls = 0;
  closed = false;
  closeReason: string | undefined;
  private readonly cdps = new Map<FakePage, FakeCdp>();
  private readonly events = new EventEmitter();
  /** Methods every new page's CDP session fails on. */
  readonly cdpFailOn = new Set<string>();

  constructor(
    readonly browser: FakeBrowser,
    readonly options: Record<string, unknown>,
  ) {}

  async newPage(): Promise<FakePage> {
    if (this.closed) throw new Error("Target page, context or browser has been closed");
    const page = new FakePage(this);
    this.pages.push(page);
    return page;
  }

  /** A page the site opens itself (window.open): announced through the "page" event. */
  async openPopup(): Promise<FakePage> {
    const page = await this.newPage();
    this.events.emit("page", page);
    return page;
  }

  async newCDPSession(page: FakePage): Promise<FakeCdp> {
    const cdp = new FakeCdp();
    for (const m of this.cdpFailOn) cdp.failOn.add(m);
    this.cdps.set(page, cdp);
    return cdp;
  }

  cdpOf(page: unknown): FakeCdp {
    const cdp = this.cdps.get(page as FakePage);
    if (!cdp) throw new Error("no CDP session for this page");
    return cdp;
  }

  async addInitScript(script: string | { content?: string }): Promise<void> {
    this.initScripts.push(typeof script === "string" ? script : (script.content ?? ""));
  }

  async route(): Promise<void> {
    this.routeCalls++;
  }

  on(event: string, handler: (payload: any) => void): this {
    this.events.on(event, handler);
    return this;
  }

  off(event: string, handler: (payload: any) => void): this {
    this.events.off(event, handler);
    return this;
  }

  async close(options?: { reason?: string }): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = options?.reason;
  }
}

export class FakeBrowser {
  readonly contexts: FakeContext[] = [];
  closed = false;
  connected = true;
  /** What SystemInfo.getProcessInfo returns; tests change it between samples. */
  processInfo: Array<{ id: number; type?: string; cpuTime: number }> = [];
  readonly browserCdps: FakeCdp[] = [];
  /** Methods every page CDP session of contexts created from now on fails on. */
  readonly cdpFailOn = new Set<string>();
  private readonly events = new EventEmitter();

  version(): string {
    return "143.0.7499.4";
  }

  isConnected(): boolean {
    return this.connected;
  }

  async newContext(options: Record<string, unknown> = {}): Promise<FakeContext> {
    if (!this.connected) throw new Error("Target page, context or browser has been closed");
    const ctx = new FakeContext(this, options);
    for (const m of this.cdpFailOn) ctx.cdpFailOn.add(m);
    this.contexts.push(ctx);
    return ctx;
  }

  async newBrowserCDPSession(): Promise<FakeCdp> {
    const cdp = new FakeCdp((method) =>
      method === "SystemInfo.getProcessInfo" ? { processInfo: this.processInfo.map((p) => ({ type: "renderer", ...p })) } : {},
    );
    this.browserCdps.push(cdp);
    return cdp;
  }

  /** The browser process dies: every context is gone and "disconnected" fires. */
  crash(): void {
    if (!this.connected) return;
    this.connected = false;
    this.events.emit("disconnected", this);
  }

  on(event: string, handler: (payload: any) => void): this {
    this.events.on(event, handler);
    return this;
  }

  off(event: string, handler: (payload: any) => void): this {
    this.events.off(event, handler);
    return this;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const c of this.contexts) c.closed = true;
    if (this.connected) {
      this.connected = false;
      this.events.emit("disconnected", this);
    }
  }
}

export interface FakeLauncher {
  launcher: BrowserLauncher;
  browsers: FakeBrowser[];
  launchCalls: LaunchOptions[];
  /** Resolves the pending deferred launch. */
  finishLaunch(): void;
  /** The next launch rejects with `error`. */
  failNext(error: Error): void;
}

export function createFakeLauncher(opts: { failWith?: Error; deferred?: boolean } = {}): FakeLauncher {
  const browsers: FakeBrowser[] = [];
  const launchCalls: LaunchOptions[] = [];
  let failure = opts.failWith ?? null;
  const pending: Array<() => void> = [];
  const launcher: BrowserLauncher = {
    launch: (options: LaunchOptions) => {
      launchCalls.push(options);
      if (failure) {
        const e = failure;
        failure = null;
        return Promise.reject(e);
      }
      const make = () => {
        const b = new FakeBrowser();
        browsers.push(b);
        return b as unknown as Browser;
      };
      if (!opts.deferred) return Promise.resolve(make());
      return new Promise<Browser>((resolve) => pending.push(() => resolve(make())));
    },
  };
  return {
    launcher,
    browsers,
    launchCalls,
    finishLaunch: () => pending.shift()?.(),
    failNext: (error) => {
      failure = error;
    },
  };
}
