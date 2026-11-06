/**
 * Shared run test data, taken from scrape run 2 on 2026-11-06
 * (`440d2fc6`, premier-league, 16:00:00.350Z-16:02:49.798Z).
 * Evidence: docs/superpowers/plans/2026-11-06-scraper-recovery/observability.md
 * ("Status today" and "What still works and must not break").
 * Later tasks append their own builders to this file.
 */
import type { PolishBookmaker } from "../../config/index.js";
import type { BookmakerRunOutcome } from "../../services/run-outcome.js";

export const RUN_ID = "440d2fc6-658b-46fe-b288-05261faa0caf";

/** markets_saved per bookmaker that saved rows in run 2 (sum: 68 201). */
export const RUN2_OK: Partial<Record<PolishBookmaker, number>> = {
  fuksiarz: 6222,
  forbet: 5869,
  etoto: 6553,
  betfan: 5600,
  lvbet: 9427,
  fortuna: 12897,
  superbet: 13353,
  betclic: 3150,
  sts: 5130,
};

export function outcome(p: Partial<BookmakerRunOutcome> = {}): BookmakerRunOutcome {
  return {
    runId: RUN_ID,
    bookmaker: "sts",
    league: "premier-league",
    status: "success",
    matchesFound: 20,
    marketsFound: 0,
    marketsSaved: 0,
    error: null,
    startedAt: new Date("2026-11-06T16:00:00.350Z"),
    finishedAt: new Date("2026-11-06T16:02:49.798Z"),
    durationMs: 169448,
    ...p,
  };
}
