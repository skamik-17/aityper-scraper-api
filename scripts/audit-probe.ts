#!/usr/bin/env npx tsx
/**
 * Reachability + match-url probe for a scraper-based bookmaker.
 *
 * Runs scrapeFullOffer(league) and reports whether the bookmaker is live-reachable
 * and a usable event URL (for feeding the audit loop). Used to decide which
 * bookmakers can have their --loop tested live.
 *
 * Usage:
 *   npx tsx scripts/audit-probe.ts --bookmaker superbet --league world-cup-2026
 */
import { getBookmakerAuditTargets } from "../src/services/audit/bookmaker-registry.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i < process.argv.length - 1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const bookmaker = arg("--bookmaker");
  const league = arg("--league") ?? "world-cup-2026";
  if (!bookmaker) {
    console.error("Usage: --bookmaker <bm> [--league <slug>]");
    process.exit(1);
  }
  const target = getBookmakerAuditTargets(bookmaker);
  if (!target) {
    console.log(JSON.stringify({ bookmaker, reachable: false, error: "unknown bookmaker" }));
    process.exit(0);
  }
  try {
    const result = await target.scraper.scrapeFullOffer(league);
    const matches = result.matches ?? [];
    // Report the RICHEST match (most markets) — the real, full-offer match —
    // rather than matches[0], which can be a settled/combo/pseudo-event entry.
    const richest = matches.reduce(
      (best, m) => (best && best.markets.length >= m.markets.length ? best : m),
      matches[0],
    );
    console.log(
      JSON.stringify({
        bookmaker,
        league,
        reachable: !!result.success && matches.length > 0,
        matchCount: matches.length,
        richestEventUrl: richest?.eventUrl ?? null,
        richestHome: richest?.homeTeam ?? null,
        richestAway: richest?.awayTeam ?? null,
        richestMarketCount: richest?.markets?.length ?? 0,
        firstMarketCount: matches[0]?.markets?.length ?? 0,
        error: result.error ?? null,
      }),
    );
  } catch (e) {
    console.log(
      JSON.stringify({ bookmaker, league, reachable: false, error: e instanceof Error ? e.message : String(e) }),
    );
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ reachable: false, error: e instanceof Error ? e.message : String(e) }));
  process.exit(0);
});
