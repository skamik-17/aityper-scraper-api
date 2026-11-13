/**
 * Typed transport errors for browserless scrapers. Messages follow the
 * observability wording (`fetch HTTP <status> <url>`), so a scraper can put
 * them straight into its result's `error`.
 */
export type HttpErrorKind = "http" | "timeout" | "network" | "content-type" | "aborted";

export const HTTP_ERROR_BODY_SNIPPET_CHARS = 4096;

export interface HttpErrorDetails {
  contentType?: string | null;
  bodySnippet?: string;
  cfMitigated?: string;
}

export class HttpError extends Error {
  /** Response content-type; null when there was no response. */
  readonly contentType: string | null;
  /** First 4096 chars of the response body; "" when none. */
  readonly bodySnippet: string;
  /** Value of the `cf-mitigated` response header (e.g. "challenge"), when present. */
  readonly cfMitigated?: string;

  constructor(
    readonly kind: HttpErrorKind,
    readonly url: string,
    readonly status: number | null,
    message: string,
    details?: HttpErrorDetails,
  ) {
    super(message);
    this.name = "HttpError";
    this.contentType = details?.contentType ?? null;
    this.bodySnippet = details?.bodySnippet ?? "";
    if (details?.cfMitigated !== undefined) this.cfMitigated = details.cfMitigated;
  }
}

const snippet = (body: string) => body.slice(0, HTTP_ERROR_BODY_SNIPPET_CHARS);

export function httpStatusError(
  url: string,
  status: number,
  contentType: string | null,
  body: string,
  cfMitigated?: string,
): HttpError {
  const suffix = cfMitigated ? ` cf-mitigated=${cfMitigated}` : "";
  return new HttpError("http", url, status, `fetch HTTP ${status} ${url}${suffix}`, {
    contentType,
    bodySnippet: snippet(body),
    cfMitigated,
  });
}

export function contentTypeError(url: string, status: number, contentType: string | null, body: string): HttpError {
  return new HttpError("content-type", url, status, `fetch non-JSON ${contentType ?? "none"} ${url}`, {
    contentType,
    bodySnippet: snippet(body),
  });
}

export function timeoutError(url: string, timeoutMs: number): HttpError {
  return new HttpError("timeout", url, null, `fetch timeout ${timeoutMs}ms ${url}`);
}

export function networkError(url: string, err: unknown): HttpError {
  const cause = (err as { cause?: unknown } | null)?.cause ?? err;
  const c = cause as { code?: unknown; message?: unknown } | null;
  const text = (typeof c?.code === "string" && c.code) || (typeof c?.message === "string" && c.message) || String(cause);
  return new HttpError("network", url, null, `fetch failed ${text} ${url}`);
}

export function abortedError(url: string): HttpError {
  return new HttpError("aborted", url, null, `fetch aborted ${url}`);
}
