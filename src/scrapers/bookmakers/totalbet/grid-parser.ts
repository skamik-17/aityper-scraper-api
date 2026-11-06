/**
 * Totalbet component-grid parser
 *
 * The dealer API's event detail carries its whole offer in component_lists: one
 * grid of label / empty / outcome cells per offer component. This module turns
 * those grids into raw ScrapedMarkets, one per market_uuid, and reads the 1X2 of
 * a league-list event. It only maps structure; codes and sides are the
 * normalizer's job.
 *
 * Grid shapes by component type (header row first where there is one):
 * - single_market       no header; [L, O] rows
 * - markets_in_columns  [E, L(market_id)...] / [L, O...]; one market per column
 * - total               ['', Poniżej, Powyżej] / [L(line), O, O]; one market per row
 * - handicap_2col       [L(home), L(away)] / [L(homeLine), O(home), L(awayLine), O(away)]
 * - handicap_3col       [E, L(home), L(remis), L(away)] / [L("1:0"), O, O, O]
 * - exact_result        alternating label and outcome rows; one market per component
 *
 * Integrity rules: only active outcomes of active markets with finite odds > 1
 * become selections (closed outcomes keep plausible prices), and a market_uuid
 * whose cells disagree on name, id or line is dropped rather than merged.
 */

import type { MarketSelection, ScrapedMarket } from "../../../types/full-offer.js";
import type {
  TotalbetCell,
  TotalbetComponent,
  TotalbetDetailEvent,
  TotalbetEventBase,
  TotalbetListEvent,
} from "./api-types.js";

type OutcomeCell = Extract<TotalbetCell, { type: "outcome" }>;
type LabelCell = Extract<TotalbetCell, { type: "label" }>;

/** Where an outcome cell belongs: the raw market's name, id and line. */
interface Placement {
  name: string;
  bookmakerMarketId?: string;
  paramValue?: string;
}

interface MarketDraft {
  market: ScrapedMarket;
  conflict: boolean;
}

const MATCH_WINNER_NAME = "Wynik meczu";
const LIST_MATCH_WINNER_ID = "1";

/** Collapses whitespace runs to one space and trims ("Crystal Palace  lub remis" -> "Crystal Palace lub remis"). */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Cleaned home and away names, or null unless the event has exactly two named participants. */
export function parseParticipants(e: TotalbetEventBase): { homeTeam: string; awayTeam: string } | null {
  if (!Array.isArray(e.participants) || e.participants.length !== 2) return null;
  const [homeTeam, awayTeam] = e.participants.map((p: unknown) => {
    const name = isRecord(p) ? p.name : undefined;
    return typeof name === "string" ? cleanName(name) : "";
  });
  return homeTeam && awayTeam ? { homeTeam, awayTeam } : null;
}

/**
 * 1X2 prices of a league-list event: market id "1", outcomes by sort 1/2/3
 * (home, draw, away). Null unless the market and all three outcomes are active
 * and priced above 1.
 */
export function parseListEvent1X2(e: TotalbetListEvent): { home: number; draw: number; away: number } | null {
  const outcomes = listMatchWinnerOutcomes(e);
  if (!outcomes) return null;
  const [home, draw, away] = outcomes;
  return { home: home.odds, draw: draw.odds, away: away.odds };
}

/**
 * The list 1X2 as an id-less "Wynik meczu" market, the fallback offer when an
 * event detail cannot be fetched. Gated exactly like parseListEvent1X2.
 */
export function listEventToMatchWinnerMarket(e: TotalbetListEvent): ScrapedMarket | null {
  const outcomes = listMatchWinnerOutcomes(e);
  if (!outcomes) return null;
  return {
    name: MATCH_WINNER_NAME,
    groupName: MATCH_WINNER_NAME,
    selections: outcomes.map(({ name, odds }) => ({ name, odds, status: "active" })),
  };
}

/**
 * Raw markets of an event detail: one per market_uuid, in component order and
 * then first appearance. Markets left without an active selection are dropped.
 */
export function parseEventDetail(e: TotalbetDetailEvent): ScrapedMarket[] {
  const drafts = new Map<string, MarketDraft>();
  const components = Array.isArray(e.component_lists) ? e.component_lists : [];

  for (const component of components) {
    if (!isRecord(component) || !Array.isArray(component.grid)) continue;
    const groupName = typeof component.name === "string" ? cleanName(component.name) : "";

    placeComponent(component, groupName, (cell, place) => {
      let draft = drafts.get(cell.market_uuid);
      if (!draft) {
        draft = { market: newMarket(place, groupName), conflict: false };
        drafts.set(cell.market_uuid, draft);
      } else if (
        draft.market.name !== place.name ||
        draft.market.bookmakerMarketId !== place.bookmakerMarketId ||
        draft.market.paramValue !== place.paramValue
      ) {
        // The same market_uuid under two names, ids or lines: merging would put one
        // grid position's prices under another's meaning.
        draft.conflict = true;
      }
      const selection = toSelection(cell);
      if (selection) draft.market.selections.push(selection);
    });
  }

  return [...drafts.values()]
    .filter((d) => !d.conflict && d.market.selections.length > 0)
    .map((d) => d.market);
}

/** Calls visit(cell, placement) for every outcome cell of one component. */
function placeComponent(
  component: TotalbetComponent,
  groupName: string,
  visit: (cell: OutcomeCell, place: Placement) => void,
): void {
  // Malformed rows become empty rows, so the header stays at grid[0].
  const grid = component.grid.map((row) => (Array.isArray(row) ? row : []));
  const slugId = typeof component.slug === "string" && component.slug !== "" ? `slug:${component.slug}` : undefined;
  const eachOutcome = (row: TotalbetCell[], place: (col: number) => Placement) =>
    row.forEach((cell, col) => {
      if (isOutcomeCell(cell)) visit(cell, place(col));
    });

  switch (component.type) {
    case "markets_in_columns": {
      // The header row names each column and carries its UOF market_id.
      const [header = [], ...body] = grid;
      for (const row of body) {
        eachOutcome(row, (col) => {
          const head = header[col];
          if (!isLabelCell(head)) return { name: groupName };
          return {
            name: `${groupName} - ${cleanName(head.text)}`,
            bookmakerMarketId: head.market_id ? `mid:${head.market_id}` : undefined,
          };
        });
      }
      return;
    }
    case "total":
    case "handicap_3col":
      // One market per body row; the row label is the line ("2.5") or the virtual score ("1:0").
      for (const row of grid.slice(1)) {
        const paramValue = isLabelCell(row[0]) ? row[0].text : undefined;
        eachOutcome(row, () => ({ name: groupName, bookmakerMarketId: slugId, paramValue }));
      }
      return;
    case "handicap_2col":
      for (const row of grid.slice(1)) {
        const paramValue = handicapHomeLine(row);
        eachOutcome(row, () => ({ name: groupName, bookmakerMarketId: slugId, paramValue }));
      }
      return;
    case "exact_result":
      for (const row of grid) eachOutcome(row, () => ({ name: groupName, bookmakerMarketId: slugId }));
      return;
    default:
      // single_market, and any layout this parser does not know: one id-less market
      // per market_uuid, so an unknown grid never yields an id or a line.
      for (const row of grid) eachOutcome(row, () => ({ name: groupName }));
  }
}

/**
 * Home line of a 2-col handicap row: the label right before the row's first
 * outcome. That outcome must sit in the row's home half; when the home outcome is
 * missing, the label before the first (away) outcome is the away line, so the row
 * gets no line instead of a sign-flipped one.
 */
function handicapHomeLine(row: TotalbetCell[]): string | undefined {
  const first = row.findIndex(isOutcomeCell);
  if (first < 1 || first >= row.length / 2) return undefined;
  const label = row[first - 1];
  return isLabelCell(label) ? label.text : undefined;
}

function newMarket(place: Placement, groupName: string): ScrapedMarket {
  return {
    name: place.name,
    ...(place.bookmakerMarketId === undefined ? {} : { bookmakerMarketId: place.bookmakerMarketId }),
    groupName,
    ...(place.paramValue === undefined ? {} : { paramValue: place.paramValue }),
    selections: [],
  };
}

/** A selection for an active outcome of an active market priced above 1, else null. */
function toSelection(cell: OutcomeCell): MarketSelection | null {
  if (cell.outcome_status !== "active" || cell.market_status !== "active") return null;
  const odds = parseOdds(cell.odds);
  if (odds === null) return null;
  return { name: cleanName(cell.name), odds, externalId: cell.uuid, status: "active" };
}

/** The three list 1X2 outcomes in sort order 1/2/3, or null unless all are active and priced. */
function listMatchWinnerOutcomes(e: TotalbetListEvent): { name: string; odds: number }[] | null {
  const markets: unknown[] = Array.isArray(e.markets) ? e.markets : [];
  const market = markets.find((m) => isRecord(m) && String(m.id) === LIST_MATCH_WINNER_ID);
  if (!isRecord(market) || market.status !== "active" || !Array.isArray(market.outcomes)) return null;

  const picked: { name: string; odds: number }[] = [];
  for (const sort of [1, 2, 3]) {
    const candidates = market.outcomes.filter((o: unknown) => isRecord(o) && o.sort === sort);
    if (candidates.length !== 1) return null;
    const outcome = candidates[0] as Record<string, unknown>;
    const odds = parseOdds(outcome.odds);
    if (outcome.status !== "active" || odds === null || typeof outcome.name !== "string") return null;
    picked.push({ name: cleanName(outcome.name), odds });
  }
  return picked;
}

/** Decimal odds from the API's string; null for placeholders (<= 1) and anything unparsable. */
function parseOdds(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const odds = Number(raw);
  return Number.isFinite(odds) && odds > 1 ? odds : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOutcomeCell(cell: unknown): cell is OutcomeCell {
  return (
    isRecord(cell) &&
    cell.type === "outcome" &&
    typeof cell.market_uuid === "string" &&
    cell.market_uuid !== "" &&
    typeof cell.name === "string"
  );
}

function isLabelCell(cell: unknown): cell is LabelCell {
  return isRecord(cell) && cell.type === "label" && typeof cell.text === "string";
}
