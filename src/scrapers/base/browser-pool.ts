/**
 * Browser Pool (retired): a shim over the shared browser runtime (browser-runtime.ts).
 * Sessions are opened with browserRuntime.openSession(); closeAll() still closes everything.
 */
import { browserRuntime } from "./browser-runtime.js";

export { BROWSER_ARGS } from "./browser-runtime.js";

export const browserPool: { closeAll(): Promise<void>; acquire(): Promise<never> } = {
  closeAll: () => browserRuntime.closeAll(),
  acquire: () => Promise.reject(new Error("browserPool.acquire() is retired; use browserRuntime.openSession()")),
};
