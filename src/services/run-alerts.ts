/**
 * One summary line per scrape run, plus alert lines for failures that need a
 * human. Local-first: every line goes to stderr; a Slack-compatible webhook
 * (`{"text": ...}`) is used only when ALERT_WEBHOOK_URL is set.
 */
import type { PolishBookmaker } from "../config/index.js";
import { isOkRunStatus, type BookmakerRunOutcome } from "./run-outcome.js";
import type { BookmakerRunSummary } from "./bookmaker-status.js";

const WEBHOOK_TIMEOUT_MS = 5000;

export function formatRunSummaryLine(a: {
  league: string;
  runId: string;
  finishedAt: Date;
  outcomes: BookmakerRunOutcome[];
}): string {
  const ok = a.outcomes.filter((o) => isOkRunStatus(o.status));
  const matches = a.outcomes.reduce((sum, o) => sum + o.matchesFound, 0);
  const saved = ok.reduce((sum, o) => sum + o.marketsSaved, 0);
  const failed =
    a.outcomes
      .filter((o) => !isOkRunStatus(o.status))
      .map((o) => `${o.bookmaker}:${o.status}`)
      .join(",") || "none";

  return (
    `[ScrapeRun] ${a.league} run=${a.runId.slice(0, 8)} finished=${a.finishedAt.toISOString()} ` +
    `ok=${ok.length}/${a.outcomes.length} matches=${matches} saved=${saved} failed=${failed}`
  );
}

export function formatAbortAlert(league: string, reason: string): string {
  return `[ALERT] scrape run ABORTED for ${league}: database unreachable - ${reason}`;
}

/**
 * Alert lines for one run, in this order:
 * - persist: bookmakers that scraped matches but saved nothing, every run;
 * - empty collapse: when at least half the bookmakers returned 0 matches, one
 *   league line replaces the streak lines of those empty bookmakers;
 * - per bookmaker of this run: a streak line when its failure streak reaches
 *   the threshold (once per streak), a resolved line when it is OK again after
 *   at least `threshold` failed runs.
 * Only bookmakers with an outcome in this run get per-bookmaker lines, so a
 * single-bookmaker run does not repeat another bookmaker's alert.
 */
export function buildRunAlerts(a: {
  league: string;
  outcomes: BookmakerRunOutcome[];
  summaries: Map<PolishBookmaker, BookmakerRunSummary>;
  threshold: number;
}): string[] {
  const { league, outcomes, summaries, threshold } = a;
  const lines: string[] = [];

  const notSaved = outcomes.filter((o) => o.status === "persist_failed");
  if (notSaved.length > 0) {
    lines.push(
      `[ALERT] ${league}: ${notSaved.length} bookmaker(s) scraped but NOT saved ` +
        `(${notSaved.map((o) => o.bookmaker).join(",")}) - ${notSaved[0].error}`,
    );
  }

  const empty = outcomes.filter((o) => o.status === "empty");
  const collapse = empty.length > 0 && empty.length * 2 >= outcomes.length;
  if (collapse) {
    lines.push(
      `[ALERT] ${league}: ${empty.length}/${outcomes.length} bookmakers returned 0 matches - per-bookmaker alerts suppressed for this run`,
    );
  }

  for (const o of outcomes) {
    const s = summaries.get(o.bookmaker);
    if (!s) continue;

    if (s.consecutiveFailures > 0 && s.consecutiveFailures === threshold) {
      if (collapse && o.status === "empty") continue;
      lines.push(
        `[ALERT] ${o.bookmaker} (${league}) failed ${s.consecutiveFailures} consecutive runs since ${s.failingSince}: ${s.lastError}`,
      );
    } else if (s.recoveredAfterFailures > 0 && s.recoveredAfterFailures >= threshold) {
      lines.push(`[ALERT-RESOLVED] ${o.bookmaker} (${league}) ok again after ${s.recoveredAfterFailures} failed runs`);
    }
  }

  return lines;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Print every line to stderr; POST them to the webhook when one is configured. Never throws. */
export async function emitAlerts(lines: string[], webhookUrl: string | null): Promise<void> {
  for (const line of lines) console.error(line);
  if (!webhookUrl || lines.length === 0) return;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: lines.join("\n") }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) console.warn(`[RunAlerts] webhook failed: HTTP ${res.status}`);
  } catch (error) {
    console.warn(`[RunAlerts] webhook failed: ${reason(error)}`);
  }
}
