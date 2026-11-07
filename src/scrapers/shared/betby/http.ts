import type { FetchText } from "./types.js";

const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const DEFAULT_TIMEOUT_MS = 15_000;

/** `host` + `pathname` of a URL, for error messages that name the endpoint without query noise. */
export function hostAndPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A Betby endpoint answered with a non-2xx status. */
export class BetbyHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} from ${hostAndPath(url)}`);
    this.name = "BetbyHttpError";
  }
}

/**
 * Plain HTTP GET over Node's global fetch (gzip/br are decoded by undici).
 * Non-2xx responses throw BetbyHttpError; network failures and timeouts throw
 * `Betby request failed: <host><path>: <reason>`.
 */
export function createFetchText(opts: { timeoutMs?: number } = {}): FetchText {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (url: string): Promise<string> => {
    const fail = (err: unknown): never => {
      throw new Error(`Betby request failed: ${hostAndPath(url)}: ${errorMessage(err)}`, { cause: err });
    };

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      return fail(err);
    }

    if (!res.ok) {
      // Release the connection; the error body is never needed.
      await res.body?.cancel().catch(() => undefined);
      throw new BetbyHttpError(res.status, url);
    }

    try {
      return await res.text();
    } catch (err) {
      // The timeout also covers reading the body.
      return fail(err);
    }
  };
}
