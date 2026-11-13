/**
 * Pure Betby parsing: league events from a snapshot, and UOF market payloads turned into
 * ScrapedMarkets named from the Polish market descriptions. No I/O.
 *
 * Every selection carries its UOF outcome id as `externalId` and every market its UOF
 * market id and raw specifier string, because the Betby normalizer maps by id, never by
 * label. Names are rendered only for humans (audits, debug output).
 *
 * Event, category and tournament ids are 19-digit strings above 2^53 and stay strings here.
 */
import type { MarketSelection, ScrapedMarket } from "../../../types/full-offer.js";
import { formatSignedLine, parseSpecifiers } from "./specifiers.js";
import type {
  BetbyEventRef,
  BetbyMarketDescriptions,
  BetbyMarkets,
  BetbyOutcome,
  BetbySnapshot,
} from "./types.js";

/** Lowest price kept, inclusive: a real 1.01 stays; anything lower (the `"0.0"` of a blocked outcome) goes. */
export const MIN_VALID_ODDS = 1.01;

/** `{$competitor1}`, `{total}`, `{+hcp}`, `{-hcp}`, `{!goalnr}`. */
const TOKEN_RE = /\{([$!+-]?)([a-z_0-9]+)\}/gi;

/** Specifier keys that never go into a market name: they pick an outcome set or a scope. */
const UNNAMED_SPECIFIERS = new Set(["variant", "type"]);

/** Same ordering as `a.localeCompare(b, "en", { numeric: true })`. */
const NATURAL = new Intl.Collator("en", { numeric: true });

function isNumeric(v: string): boolean {
  return v.trim() !== "" && Number.isFinite(Number(v));
}

/**
 * Fills a description template. `{$competitor1|2}` -> team name; `{+x}` / `{-x}` -> the
 * line with its sign as is / flipped (non-numeric values pass through); `{!x}` -> ordinal
 * `x.`; `{x}` -> the value. Tokens without a value are left as they are.
 */
export function renderTemplate(t: string, specs: Record<string, string>, competitors: [string, string]): string {
  return t.replace(TOKEN_RE, (token: string, prefix: string, key: string) => {
    if (prefix === "$") {
      if (key === "competitor1") return competitors[0];
      if (key === "competitor2") return competitors[1];
      return token;
    }
    if (!Object.hasOwn(specs, key)) return token;
    const v = specs[key];
    switch (prefix) {
      case "+":
        return isNumeric(v) ? formatSignedLine(Number(v)) : v;
      case "-":
        return isNumeric(v) ? formatSignedLine(-Number(v)) : v;
      case "!":
        return `${v}.`;
      default:
        return v;
    }
  });
}

/**
 * The upcoming football matches of one tournament, by kick-off then id. Outrights
 * (`type: "tournament"`) and events that have started are left out. The snapshot is
 * shared and frozen, so team names are trimmed into new objects, never in place.
 */
export function selectLeagueEvents(s: BetbySnapshot, tournamentId: string, nowMs: number): BetbyEventRef[] {
  const picked: { scheduled: number; ref: BetbyEventRef }[] = [];
  for (const [eventId, event] of Object.entries(s.events)) {
    // The snapshot holds every sport of the brand; one malformed event must not fail every league.
    const d = event?.desc;
    if (d === null || typeof d !== "object") continue;
    if (d.sport !== "1" || d.type !== "match" || d.tournament !== tournamentId) continue;
    if (!Array.isArray(d.competitors) || d.competitors.length !== 2) continue;
    if (!(d.scheduled * 1000 > nowMs)) continue;
    const [homeTeam, awayTeam] = d.competitors.map((c) => (typeof c?.name === "string" ? c.name.trim() : ""));
    // A side without a name cannot be matched to a fixture.
    if (homeTeam === "" || awayTeam === "") continue;
    picked.push({
      scheduled: d.scheduled,
      ref: {
        eventId,
        homeTeam,
        awayTeam,
        startTime: new Date(d.scheduled * 1000).toISOString(),
        categoryId: d.category,
        // Only the betters deep link uses the slugs; a missing one degrades the link, not the odds.
        categorySlug: s.categories[d.category]?.slug ?? "",
        tournamentId: d.tournament,
        tournamentSlug: s.tournaments[d.tournament]?.slug ?? "",
        eventSlug: d.slug,
        listingMarkets: event.markets,
      },
    });
  }
  picked.sort((a, b) => a.scheduled - b.scheduled || NATURAL.compare(a.ref.eventId, b.ref.eventId));
  return picked.map((p) => p.ref);
}

/** Player props: a `dst:` variant, or outcomes keyed by player (`…:player:…`, `dst:…`). */
function isPlayerPair(specifier: string, outcomeIds: string[]): boolean {
  return (
    specifier.includes("variant=dst:") ||
    outcomeIds.some((id) => id.includes(":player:") || id.startsWith("dst:"))
  );
}

/** Template name, plus every specifier value the template does not show. */
function marketName(
  marketId: string,
  desc: BetbyMarketDescriptions[string] | undefined,
  specs: Record<string, string>,
  competitors: [string, string],
): string {
  if (desc === undefined) return `Rynek ${marketId}`;
  const shown = new Set(Array.from(desc.name.matchAll(TOKEN_RE), (m) => m[2]));
  let name = renderTemplate(desc.name, specs, competitors);
  for (const [key, value] of Object.entries(specs)) {
    if (!UNNAMED_SPECIFIERS.has(key) && !shown.has(key)) name += ` ${value}`;
  }
  return name;
}

/**
 * Quotable outcomes: described ones first in description order (the specifier's variant,
 * else the default variant), then undescribed ids in natural order, named by their id.
 */
function buildSelections(
  outcomes: Record<string, BetbyOutcome>,
  desc: BetbyMarketDescriptions[string] | undefined,
  specs: Record<string, string>,
  competitors: [string, string],
): MarketSelection[] {
  const variant = specs.variant !== undefined ? desc?.variants?.[`variant=${specs.variant}`] : undefined;
  const described = (variant ?? desc?.variants?.[""] ?? []).flatMap((v) => v.outcomes);

  const named: [outcomeId: string, name: string][] = [];
  const seen = new Set<string>();
  for (const { id, name } of described) {
    if (seen.has(id) || !Object.hasOwn(outcomes, id)) continue;
    seen.add(id);
    named.push([id, renderTemplate(name, specs, competitors)]);
  }
  for (const id of Object.keys(outcomes).filter((id) => !seen.has(id)).sort(NATURAL.compare)) {
    named.push([id, id]);
  }

  const selections: MarketSelection[] = [];
  for (const [externalId, name] of named) {
    const outcome = outcomes[externalId];
    if (!outcome || outcome.b) continue;
    const odds = Number(outcome.k);
    if (!(odds >= MIN_VALID_ODDS) || !Number.isFinite(odds)) continue;
    selections.push({ name, odds, externalId });
  }
  return selections;
}

/**
 * Every non-player market pair (market id x specifier) with at least one quotable outcome,
 * ordered by market id, then specifier.
 */
export function buildScrapedMarkets(
  markets: BetbyMarkets,
  d: BetbyMarketDescriptions,
  competitors: [string, string],
): ScrapedMarket[] {
  const pairs: { marketId: string; specifier: string; outcomes: Record<string, BetbyOutcome> }[] = [];
  for (const [marketId, bySpecifier] of Object.entries(markets)) {
    for (const [specifier, outcomes] of Object.entries(bySpecifier)) {
      if (!isPlayerPair(specifier, Object.keys(outcomes))) pairs.push({ marketId, specifier, outcomes });
    }
  }
  pairs.sort(
    (a, b) =>
      Number(a.marketId) - Number(b.marketId) ||
      NATURAL.compare(a.marketId, b.marketId) ||
      NATURAL.compare(a.specifier, b.specifier),
  );

  const result: ScrapedMarket[] = [];
  for (const { marketId, specifier, outcomes } of pairs) {
    const desc = Object.hasOwn(d, marketId) ? d[marketId] : undefined;
    const specs = parseSpecifiers(specifier);
    const selections = buildSelections(outcomes, desc, specs, competitors);
    if (selections.length === 0) continue;
    result.push({
      name: marketName(marketId, desc, specs, competitors),
      bookmakerMarketId: marketId,
      paramValue: specifier || undefined,
      selections,
    });
  }
  return result;
}

/** The Betby event id in a betters or lebull event URL: its last run of 15 or more digits. */
export function extractBetbyEventId(url: string): string | null {
  const runs = url.match(/\d{15,}/g);
  return runs === null ? null : runs[runs.length - 1];
}
