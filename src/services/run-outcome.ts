/**
 * Run-outcome classification.
 *
 * Turns one bookmaker's (scrape, save) pair into one of five statuses and
 * keeps the concrete failure cause, so a bookmaker that scraped matches but
 * saved nothing is reported as a failure instead of a success.
 *
 * Only type imports from scrape-helpers / full-offer / config: scrape-helpers
 * imports full-offer-repository, which imports formatDbError from here, and an
 * erased type import cannot form a runtime import cycle.
 */
import type { PolishBookmaker } from "../config/index.js";
import type { FullOfferScraperResult } from "../types/full-offer.js";
import type { NormalizeAndSaveResult } from "./scrape-helpers.js";

export type BookmakerRunStatus = "success" | "partial" | "empty" | "scrape_failed" | "persist_failed";

/** Statuses that count as a working bookmaker: something was saved. */
export const OK_RUN_STATUSES: readonly BookmakerRunStatus[] = ["success", "partial"];

export function isOkRunStatus(status: string | null | undefined): boolean {
  return status != null && (OK_RUN_STATUSES as readonly string[]).includes(status);
}

export interface BookmakerRunOutcome {
  runId: string;
  bookmaker: PolishBookmaker;
  league: string;
  status: BookmakerRunStatus;
  matchesFound: number;
  marketsFound: number;
  marketsSaved: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
}

/** First error verbatim; further errors are only counted, to keep the text bounded. */
function summarizeErrors(errors: readonly string[]): string | null {
  if (errors.length === 0) return null;
  return errors.length === 1 ? errors[0] : `${errors[0]} (+${errors.length - 1} more)`;
}

/** Error prefixes of the save stage in scrape-helpers.ts and the aggregator's thrown save. */
const SAVE_STAGE_PREFIXES = ["Batch insert failed", "Batch save failed", "Save failed"];

function isSaveStageError(error: string): boolean {
  return SAVE_STAGE_PREFIXES.some((prefix) => error.startsWith(prefix));
}

/**
 * Rules, in order: scraper failed -> scrape_failed; 0 matches -> empty;
 * 0 markets saved -> persist_failed; saved with a save error or a scraper
 * error -> partial; else success.
 * An empty scraper error string carries no cause, so it gets the default text.
 * A successful scrape can still carry an error (betcris aborted part-way,
 * totalbet detail failures or slug drift); that run is partial, so the text
 * reaches scraper_runs and the health endpoint.
 */
export function classifyBookmakerRun(
  scrape: Pick<FullOfferScraperResult, "success" | "matches" | "error">,
  save: Pick<NormalizeAndSaveResult, "marketsNormalized" | "marketsSaved" | "errors"> | null,
): { status: BookmakerRunStatus; error: string | null } {
  if (!scrape.success) {
    return { status: "scrape_failed", error: scrape.error || "Scraper returned success=false without an error message" };
  }

  const matches = scrape.matches.length;
  if (matches === 0) {
    return { status: "empty", error: scrape.error || "Scraper reported success with 0 matches" };
  }

  if (save === null) {
    return { status: "persist_failed", error: `${matches} matches scraped but no save was attempted` };
  }

  const saveError = summarizeErrors(save.errors);
  if (save.marketsSaved === 0) {
    // Nothing saved: the save-stage error is the cause, so it goes before the
    // normalization errors that scrape-helpers pushes first.
    const ordered = [...save.errors.filter(isSaveStageError), ...save.errors.filter((e) => !isSaveStageError(e))];
    const cause = summarizeErrors(ordered);
    if (cause) return { status: "persist_failed", error: cause };
    if (save.marketsNormalized === 0) {
      return { status: "persist_failed", error: `${matches} matches scraped but 0 markets normalized` };
    }
    return {
      status: "persist_failed",
      error: `0 of ${save.marketsNormalized} normalized markets saved (all filtered as non-canonical)`,
    };
  }

  if (scrape.error || saveError) {
    return { status: "partial", error: [scrape.error, saveError].filter(Boolean).join(" | ") };
  }
  return { status: "success", error: null };
}

// supabase-js reports a failed fetch as a plain object whose `details` holds the
// undici cause as "Caused by: <name>: <message>[ (<code>)]", e.g.
// "Caused by: Error: connect ECONNREFUSED 127.0.0.1:54321 (ECONNREFUSED)".
// The message can be empty: a closed port on `localhost` gives the happy-eyeballs
// AggregateError, "Caused by: AggregateError:  (ECONNREFUSED)". Group 1 is the
// message (possibly blank), group 2 the trailing code.
const CAUSE_PATTERN = /Caused by: (?:\w*Error:)?(.*?)(?:\(([A-Z][A-Z0-9_]*)\))?$/m;

/** The socket cause behind "fetch failed": its message, else its code, else null. */
function fetchCause(details: unknown): string | null {
  if (typeof details !== "string") return null;
  const match = CAUSE_PATTERN.exec(details);
  if (!match) return null;
  return (match[1] ?? "").trim() || match[2] || null;
}

/** At most this many characters of a DB error message. */
const MAX_DB_MESSAGE_CHARS = 300;

/**
 * The message on one line, at most MAX_DB_MESSAGE_CHARS long. postgrest-js puts
 * the raw body in `message` when an error response is not JSON (a gateway's
 * HTML 502), and its first line alone ("<html>") would drop the cause.
 */
function boundedMessage(message: unknown): string | null {
  if (typeof message !== "string") return null;
  return message.replace(/\s+/g, " ").trim().slice(0, MAX_DB_MESSAGE_CHARS) || null;
}

function firstLine(text: string): string | null {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null
  );
}

/**
 * One-line description of a DB error that keeps the real cause:
 * the socket error behind "fetch failed", or the PostgREST/Postgres code.
 */
export function formatDbError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  if (error == null) return "Unknown database error";
  if (typeof error !== "object") return String(error);

  const { message, details, code } = error as { message?: unknown; details?: unknown; code?: unknown };
  const text = boundedMessage(message) ?? "Unknown database error";

  const cause = fetchCause(details);
  if (cause) return `${text} (${cause})`;

  if (typeof code === "string" && code.length > 0) {
    const detailLine = typeof details === "string" ? firstLine(details) : null;
    return detailLine ? `${text} [${code}]: ${detailLine}` : `${text} [${code}]`;
  }

  return text;
}
