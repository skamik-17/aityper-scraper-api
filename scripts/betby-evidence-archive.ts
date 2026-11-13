#!/usr/bin/env npx tsx
/**
 * Betby evidence -> prep-audit archive (input for scripts/harvest-fixtures.ts).
 *
 * Turns one captured Betby event response (`…/prematch/brand/<id>/event/pl/<eventId>`)
 * and the Polish market descriptions into the PrepAuditOutput a `<bm>-prep-audit` run
 * writes, so golden fixtures can be harvested from durable evidence instead of a live
 * scrape. No network, no DB.
 *
 * It follows the live path step by step:
 * - BetbyScraper.scrapeFullOffer builds the markets with buildScrapedMarkets, passing
 *   the trimmed Betby team names as competitors.
 * - runScraperPrepAudit puts the canonical team names into the normalization ctx and
 *   the meta.
 * - buildPrepAuditOutput writes the archive, so there is one archive implementation.
 *
 * Markets keep buildScrapedMarkets order, which is also the archive index order. Unlike
 * runScraperPrepAudit, the script does not run dedupeRawMarkets. Every Betby pair is a
 * distinct (market id, specifier), and a name-keyed dedupe could merge two of them.
 *
 * Usage:
 *   npx tsx scripts/betby-evidence-archive.ts --bookmaker <betters|lebull>
 *     --event <event json> --descriptions <descriptions json: raw response or {markets}>
 *     --league <slug> --out <archive path>
 *
 * Name the output `<matchIdSafe>__<YYYY-MM-DD>.json`: the harvester derives the fixture
 * name from it.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { getBookmakerLeagueId } from "../src/config/leagues.js";
import { buildScrapedMarkets } from "../src/scrapers/shared/betby/parser.js";
import type { BetbyBookmaker, BetbyEvent, BetbyMarketDescriptions } from "../src/scrapers/shared/betby/types.js";
import { buildPrepAuditOutput, scrapedMarketsToRaw } from "../src/services/audit/scraper-audit-core.js";
import { bettersNormalizer } from "../src/services/normalization/bookmakers/betters-normalizer.js";
import { lebullNormalizer } from "../src/services/normalization/bookmakers/lebull-normalizer.js";
import type { BookmakerMarketNormalizer, NormalizationContext } from "../src/services/normalization/types.js";
import { getCanonicalTeamName } from "../src/utils/team-matcher.js";

const NORMALIZERS: Record<BetbyBookmaker, BookmakerMarketNormalizer> = {
  betters: bettersNormalizer,
  lebull: lebullNormalizer,
};

interface Args {
  bookmaker: BetbyBookmaker;
  event: string;
  descriptions: string;
  league: string;
  out: string;
}

function usage(): never {
  console.error(
    "Usage: npx tsx scripts/betby-evidence-archive.ts --bookmaker <betters|lebull> --event <event json> " +
      "--descriptions <descriptions json; raw or {markets}> --league <slug> --out <archive path>",
  );
  process.exit(1);
}

function fail(message: string): never {
  console.error(`[betby-archive] ${message}`);
  process.exit(1);
}

function resolveFromCwd(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function isBetbyBookmaker(value: string): value is BetbyBookmaker {
  return Object.hasOwn(NORMALIZERS, value);
}

function parseArgs(argv: string[]): Args {
  const values: Partial<Record<keyof Args, string>> = {};
  const flags: Record<string, keyof Args> = {
    "--bookmaker": "bookmaker",
    "--event": "event",
    "--descriptions": "descriptions",
    "--league": "league",
    "--out": "out",
  };
  for (let i = 0; i < argv.length; i++) {
    if (!Object.hasOwn(flags, argv[i])) {
      console.error(`Unknown flag: ${argv[i]}`);
      usage();
    }
    const value = argv[i + 1];
    if (value === undefined) usage();
    values[flags[argv[i]]] = value;
    i++;
  }
  const { bookmaker, event, descriptions, league, out } = values;
  if (!bookmaker || !event || !descriptions || !league || !out) usage();
  const bm = bookmaker.toLowerCase();
  if (!isBetbyBookmaker(bm)) fail(`not a Betby bookmaker: ${bookmaker} (expected betters or lebull)`);
  return {
    bookmaker: bm,
    event: resolveFromCwd(event),
    descriptions: resolveFromCwd(descriptions),
    league,
    out: resolveFromCwd(out),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (err) {
    fail(`cannot read ${path}: ${(err as Error).message}`);
  }
}

/** The only event of an event-endpoint envelope, with its id kept as the exact 19-digit string. */
function readEvent(path: string): { eventId: string; event: BetbyEvent } {
  const json = readJson(path);
  if (!isRecord(json) || !isRecord(json.events)) fail(`${path}: not an event envelope (no "events")`);
  const ids = Object.keys(json.events);
  if (ids.length !== 1) fail(`${path}: expected exactly one event, found ${ids.length}`);
  const event = json.events[ids[0]];
  if (!isRecord(event) || !isRecord(event.desc) || !isRecord(event.markets)) {
    fail(`${path}: event ${ids[0]} has no desc or markets`);
  }
  return { eventId: ids[0], event: event as unknown as BetbyEvent };
}

/** The live response is the descriptions record itself; the trimmed evidence wraps it under `markets`. */
function readDescriptions(path: string): BetbyMarketDescriptions {
  const json = readJson(path);
  const descriptions = isRecord(json) && isRecord(json.markets) ? json.markets : json;
  if (!isRecord(descriptions)) fail(`${path}: market descriptions are not a JSON object`);
  return descriptions as BetbyMarketDescriptions;
}

/** Trimmed competitor names, as selectLeagueEvents gives them to the scraper. */
function competitorNames(eventId: string, event: BetbyEvent): [string, string] {
  const competitors = event.desc.competitors;
  if (!Array.isArray(competitors) || competitors.length !== 2) {
    fail(`event ${eventId}: expected two competitors`);
  }
  const [home, away] = competitors.map((c) => (typeof c?.name === "string" ? c.name.trim() : ""));
  if (home === "" || away === "") fail(`event ${eventId}: a competitor has no name`);
  return [home, away];
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const { eventId, event } = readEvent(args.event);
  const descriptions = readDescriptions(args.descriptions);

  // The league sets the canonical team names; an event from another tournament must not be filed under it.
  const tournamentId = getBookmakerLeagueId(args.league, args.bookmaker);
  if (tournamentId === undefined) fail(`unknown league for ${args.bookmaker}: ${args.league}`);
  if (event.desc.tournament !== String(tournamentId)) {
    fail(`event ${eventId} is in tournament ${event.desc.tournament}, not ${args.league} (${tournamentId})`);
  }

  const competitors = competitorNames(eventId, event);
  const homeTeam = getCanonicalTeamName(competitors[0], args.league);
  const awayTeam = getCanonicalTeamName(competitors[1], args.league);
  const ctx: NormalizationContext = { homeTeam, awayTeam, leagueName: args.league, league: args.league };

  const output = buildPrepAuditOutput({
    normalizer: NORMALIZERS[args.bookmaker],
    ctx,
    rawMarkets: scrapedMarketsToRaw(buildScrapedMarkets(event.markets, descriptions, competitors)),
    meta: { matchId: eventId, homeTeam, awayTeam, league: args.league },
  });

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(output, null, 2), "utf8");

  const selections = output.markets.reduce((n, m) => n + m.raw.selections.length, 0);
  console.error(`[betby-archive] Wrote ${args.out}`);
  console.log(`[betby-archive] ${args.bookmaker}: ${output.markets.length} markets, ${selections} selections`);
}

main();
