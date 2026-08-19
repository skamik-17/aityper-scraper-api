/**
 * PZBuk Parser Module
 *
 * Pure parsing logic for transforming PZBuk WebSocket/RSocket data
 * into the unified ScrapedMarket format.
 *
 * This module has NO Playwright dependencies - it only works with
 * raw JSON data captured from the WebSocket stream.
 */

import type { MarketSelection, ScrapedMarket } from "../../../types/full-offer.js";
import type { MarketOverUnderOdds } from "../../../types/full-offer.js";
import type {
  PZBukInitialState,
  PZBukEvent,
  PZBukSelection,
  ParsedTeams,
  GroupedSelections,
} from "./types.js";
import {
  MARKET_TYPES,
  MARKET_GROUPS,
  NORMALIZED_MARKET_TYPES,
  OUTCOME_TYPES,
} from "./constants.js";

/**
 * Extract team names from PZBuk event data
 * First tries primaryParticipants, falls back to parsing eventName
 */
export function parseTeamNames(event: PZBukEvent): ParsedTeams {
  let homeTeam = "";
  let awayTeam = "";

  // Try to get from primaryParticipants
  for (const participant of Object.values(event.primaryParticipants || {})) {
    if (participant.venueRole === "Home") {
      homeTeam = participant.name.trim();
    } else if (participant.venueRole === "Away") {
      awayTeam = participant.name.trim();
    }
  }

  // Fallback: parse eventName "Home - Away"
  if (!homeTeam || !awayTeam) {
    const parts = event.eventName.split(/\s*[-\u2013vs.]+\s*/);
    if (parts.length >= 2) {
      homeTeam = parts[0].trim();
      awayTeam = parts[1].trim();
    }
  }

  return { homeTeam, awayTeam };
}

/**
 * Get human-readable market name based on market type ID.
 *
 * Prefers the real API-provided name when available (from PZBukMarket.name
 * or PZBukMarket.marketType.name) and only falls back to the hard-coded
 * switch / "Rynek <id>" placeholder when the API name is blank.
 */
export function getMarketName(
  marketTypeId: string,
  line?: number | string,
  apiName?: string
): string {
  // Use the real API-provided market name when present. API names that are
  // themselves untranslated "Rynek <id>" placeholders are ignored so the
  // switch/label fallbacks below get a chance to resolve a readable label.
  const trimmedApiName = apiName?.trim();
  if (trimmedApiName && !/^rynek\s*\d+$/i.test(trimmedApiName)) {
    return trimmedApiName;
  }

  // Audit r5 (France vs Morocco): the WebSocket payload can deliver
  // marketTypeId as a JSON number even though the type declares string —
  // switch(...) uses strict equality, so an un-coerced numeric id silently
  // skipped every case below (including ones with a real label, e.g. id 18)
  // and fell through to the "Rynek <id>" placeholder. Coerce once so the
  // switch always compares string-to-string.
  const id = String(marketTypeId);

  switch (id) {
    // Core markets
    case MARKET_TYPES.MATCH_RESULT:
      return "Wynik meczu";
    case MARKET_TYPES.DOUBLE_CHANCE:
      return "Podwojna szansa";
    case MARKET_TYPES.DRAW_NO_BET:
      return "Remis = zwrot";
    case MARKET_TYPES.HANDICAP:
      if (line !== undefined) {
        return `Handicap europejski ${line}`;
      }
      return "Handicap europejski";
    case MARKET_TYPES.ASIAN_HANDICAP:
      if (line !== undefined) {
        return `Handicap azjatycki ${line}`;
      }
      return "Handicap azjatycki";

    // Goal markets
    case MARKET_TYPES.OVER_UNDER:
      if (line !== undefined) {
        return `Liczba goli ${line}`;
      }
      return "Liczba goli";
    case MARKET_TYPES.BTTS:
      return "Obie druzyny strzelą";
    case MARKET_TYPES.ODD_EVEN:
      return "Parzyste/Nieparzyste";
    case MARKET_TYPES.WIN_TO_NIL:
      return "Wygrana do zera";
    case MARKET_TYPES.HOME_TEAM_GOALS:
      if (line !== undefined) {
        return `Gole gospodarzy ${line}`;
      }
      return "Gole gospodarzy";
    case MARKET_TYPES.AWAY_TEAM_GOALS:
      if (line !== undefined) {
        return `Gole gosci ${line}`;
      }
      return "Gole gosci";
    case MARKET_TYPES.HOME_TEAM_EXACT_GOALS:
      return "Dokladna liczba goli gospodarzy";
    case MARKET_TYPES.AWAY_TEAM_EXACT_GOALS:
      return "Dokladna liczba goli gosci";
    case MARKET_TYPES.TOTAL_EXACT_GOALS:
      return "Dokladna liczba goli";
    case MARKET_TYPES.GOAL_RANGES:
      return "Przedzialy goli";
    case MARKET_TYPES.BOTH_HALVES_GOALS:
      return "Gole w obu polowach";
    case MARKET_TYPES.HOME_CLEAN_SHEET:
      return "Czyste konto gospodarzy";
    case MARKET_TYPES.AWAY_CLEAN_SHEET:
      return "Czyste konto gosci";

    // First half markets
    case MARKET_TYPES.HALF_TIME_RESULT:
      return "Wynik 1. polowy";
    case MARKET_TYPES.HALF_TIME_OVER_UNDER:
      if (line !== undefined) {
        return `Liczba goli 1. polowa ${line}`;
      }
      return "Liczba goli 1. polowa";
    case MARKET_TYPES.HALF_TIME_BTTS:
      return "Obie strzelą 1. polowa";

    // Second half markets
    case MARKET_TYPES.SECOND_HALF_RESULT:
      return "Wynik 2. polowy";
    case MARKET_TYPES.SECOND_HALF_OVER_UNDER:
      if (line !== undefined) {
        return `Liczba goli 2. polowa ${line}`;
      }
      return "Liczba goli 2. polowa";
    case MARKET_TYPES.SECOND_HALF_BTTS:
      return "Obie strzelą 2. polowa";

    // Half/Full time and special results
    case MARKET_TYPES.HALF_TIME_FULL_TIME:
      return "HT/FT";
    case MARKET_TYPES.HOME_WIN_BOTH_HALVES:
      return "Gospodarze wygrają obie polowy";
    case MARKET_TYPES.AWAY_WIN_BOTH_HALVES:
      return "Goscie wygrają obie polowy";
    case MARKET_TYPES.HOME_WIN_EITHER_HALF:
      return "Gospodarze wygrają ktorąkolwiek polowe";
    case MARKET_TYPES.AWAY_WIN_EITHER_HALF:
      return "Goscie wygrają ktorąkolwiek polowe";

    // Scorer markets
    case MARKET_TYPES.FIRST_GOAL:
      return "Pierwszy strzelec";
    case MARKET_TYPES.LAST_GOAL:
      return "Ostatni strzelec";
    case MARKET_TYPES.ANYTIME_SCORER:
      return "Strzelec bramki";
    case MARKET_TYPES.CORRECT_SCORE:
      return "Dokladny wynik";

    // Combo markets
    case MARKET_TYPES.RESULT_BTTS:
      return "Wynik + obie strzelą";
    case MARKET_TYPES.RESULT_OVER_UNDER:
      if (line !== undefined) {
        return `Wynik + liczba goli ${line}`;
      }
      return "Wynik + liczba goli";
    case MARKET_TYPES.DOUBLE_CHANCE_BTTS:
      return "Podwojna szansa + obie strzelą";
    case MARKET_TYPES.DOUBLE_CHANCE_OVER_UNDER:
      if (line !== undefined) {
        return `Podwojna szansa + gole ${line}`;
      }
      return "Podwojna szansa + gole";

    default:
      return `Rynek ${id}`;
  }
}

/**
 * Human-readable Polish labels for numeric market-type ids whose identity
 * was confirmed by the cross-bookmaker audit. Applied only when the resolved
 * market name would otherwise be the "Rynek <id>" placeholder, so a real
 * API-provided name always wins.
 */
const PZBUK_ID_LABELS: Record<string, string> = {
  // Side proven by ground truth in two fixtures — see the note on ids 19/20 in
  // pzbuk-normalizer.ts. The labels used to be the other way round.
  "19": "Gole gości",
  "20": "Gole gospodarzy",
  "33": "Wynik meczu i obie drużyny strzelą",
  "34": "Liczba goli i obie drużyny strzelą",
  "35": "Wynik meczu i liczba goli",
  "47": "Połowa z większą liczbą goli",
  "48": "Gospodarz - połowa z większą liczbą goli",
  "49": "Gość - połowa z większą liczbą goli",
  "50": "BTTS w połowach",
  "57": "Pierwszy gol 1. połowy",
  "69": "Obie drużyny strzelą - 1. połowa",
  "77": "Pierwszy gol 2. połowy",
  "78": "Podwójna szansa",
  "79": "Zakład bez remisu",
  // Audit r4 (France vs Morocco): ids 126/498/501 were still surfacing the
  // generic "Rynek <id>" placeholder even though their catalog identity is
  // already confirmed (126 -> MATCH_WINNER, 498 -> DOUBLE_CHANCE_BTTS,
  // 501 -> RESULT_AND_BTTS, see pzbuk-normalizer.ts) — give them real labels
  // so future audits can sanity-check the label against the odds shape.
  "126": "Wynik meczu",
  "498": "Podwójna szansa i obie drużyny strzelą",
  "501": "Wynik meczu i obie drużyny strzelą",
  "85": "Dokładna liczba goli - 2. połowa",
  "86": "Parzysta/nieparzysta liczba goli",
  "90": "Dokładny wynik 2. połowy",
  "91": "Czas pierwszego gola (15 min)",
  "92": "Czas pierwszego gola (10 min)",
  "128": "Suma strzałów",
  "147": "Dokładna liczba kartek - gospodarze - 1. połowa",
  "156": "Rzuty rożne",
  "159": "Przedział rzutów rożnych",
  "502": "Wynik meczu i liczba goli",
  "509": "Multiwynik",
  "510": "Przedział goli - 1. połowa",
  // Audit r5 (France vs Morocco): id 511's odds match confirmed peer
  // SECOND_HALF_GOAL_RANGE prices, not full-match GOAL_RANGE (see
  // pzbuk-normalizer.ts PZBUK_MARKET_ID_TO_CODE) — label it accordingly.
  "511": "Przedział goli - 2. połowa",
};

/**
 * Get selection display name based on outcome type and market
 */
function getSelectionName(
  selection: PZBukSelection,
  marketTypeId: string,
  teams?: ParsedTeams
): string {
  const outcomeType = selection.outcomeType;
  const name = selection.name?.trim() || "";
  const nameLower = name.toLowerCase();

  // 1X2 market
  if (marketTypeId === MARKET_TYPES.MATCH_RESULT) {
    if (outcomeType === OUTCOME_TYPES.HOME) {
      return teams?.homeTeam || "1";
    }
    if (outcomeType === OUTCOME_TYPES.TIE || outcomeType === OUTCOME_TYPES.DRAW) {
      return "Remis";
    }
    if (outcomeType === OUTCOME_TYPES.AWAY) {
      return teams?.awayTeam || "2";
    }
  }

  // Double Chance
  if (marketTypeId === MARKET_TYPES.DOUBLE_CHANCE) {
    if (outcomeType === OUTCOME_TYPES.HOME_OR_DRAW) {
      return "1X";
    }
    if (outcomeType === OUTCOME_TYPES.DRAW_OR_AWAY) {
      return "X2";
    }
    if (outcomeType === OUTCOME_TYPES.HOME_OR_AWAY) {
      return "12";
    }
    // Try parsing from name
    if (nameLower.includes("lub remis") && !nameLower.startsWith("remis")) {
      return "1X";
    }
    if (nameLower.startsWith("remis lub")) {
      return "X2";
    }
    if (nameLower.includes(" lub ") && !nameLower.includes("remis")) {
      return "12";
    }
  }

  // Over/Under (all variants)
  if (
    marketTypeId === MARKET_TYPES.OVER_UNDER ||
    marketTypeId === MARKET_TYPES.HALF_TIME_OVER_UNDER ||
    marketTypeId === MARKET_TYPES.SECOND_HALF_OVER_UNDER ||
    marketTypeId === MARKET_TYPES.HOME_TEAM_GOALS ||
    marketTypeId === MARKET_TYPES.AWAY_TEAM_GOALS
  ) {
    if (outcomeType === OUTCOME_TYPES.OVER || nameLower.includes("pow")) {
      return "Powyzej";
    }
    if (outcomeType === OUTCOME_TYPES.UNDER || nameLower.includes("pon")) {
      return "Ponizej";
    }
  }

  // BTTS (all variants)
  if (
    marketTypeId === MARKET_TYPES.BTTS ||
    marketTypeId === MARKET_TYPES.HALF_TIME_BTTS ||
    marketTypeId === MARKET_TYPES.SECOND_HALF_BTTS
  ) {
    if (
      outcomeType === OUTCOME_TYPES.YES ||
      nameLower === "tak" ||
      nameLower === "yes"
    ) {
      return "Tak";
    }
    if (
      outcomeType === OUTCOME_TYPES.NO ||
      nameLower === "nie" ||
      nameLower === "no"
    ) {
      return "Nie";
    }
  }

  // Half-time 1X2
  if (marketTypeId === MARKET_TYPES.HALF_TIME_RESULT) {
    if (outcomeType === OUTCOME_TYPES.HOME) {
      return teams?.homeTeam || "1";
    }
    if (outcomeType === OUTCOME_TYPES.TIE || outcomeType === OUTCOME_TYPES.DRAW) {
      return "Remis";
    }
    if (outcomeType === OUTCOME_TYPES.AWAY) {
      return teams?.awayTeam || "2";
    }
  }

  // Second half 1X2
  if (marketTypeId === MARKET_TYPES.SECOND_HALF_RESULT) {
    if (outcomeType === OUTCOME_TYPES.HOME) {
      return teams?.homeTeam || "1";
    }
    if (outcomeType === OUTCOME_TYPES.TIE || outcomeType === OUTCOME_TYPES.DRAW) {
      return "Remis";
    }
    if (outcomeType === OUTCOME_TYPES.AWAY) {
      return teams?.awayTeam || "2";
    }
  }

  // Draw No Bet
  if (marketTypeId === MARKET_TYPES.DRAW_NO_BET) {
    if (outcomeType === OUTCOME_TYPES.HOME) {
      return teams?.homeTeam || "1";
    }
    if (outcomeType === OUTCOME_TYPES.AWAY) {
      return teams?.awayTeam || "2";
    }
  }

  // Odd/Even
  if (marketTypeId === MARKET_TYPES.ODD_EVEN) {
    if (nameLower.includes("nieparzy") || outcomeType === "Odd") {
      return "Nieparzyste";
    }
    if (nameLower.includes("parzy") || outcomeType === "Even") {
      return "Parzyste";
    }
  }

  // Clean sheet markets
  if (
    marketTypeId === MARKET_TYPES.HOME_CLEAN_SHEET ||
    marketTypeId === MARKET_TYPES.AWAY_CLEAN_SHEET
  ) {
    if (
      outcomeType === OUTCOME_TYPES.YES ||
      nameLower === "tak" ||
      nameLower === "yes"
    ) {
      return "Tak";
    }
    if (
      outcomeType === OUTCOME_TYPES.NO ||
      nameLower === "nie" ||
      nameLower === "no"
    ) {
      return "Nie";
    }
  }

  // Goals in both halves
  if (marketTypeId === MARKET_TYPES.BOTH_HALVES_GOALS) {
    if (
      outcomeType === OUTCOME_TYPES.YES ||
      nameLower === "tak" ||
      nameLower === "yes"
    ) {
      return "Tak";
    }
    if (
      outcomeType === OUTCOME_TYPES.NO ||
      nameLower === "nie" ||
      nameLower === "no"
    ) {
      return "Nie";
    }
  }

  // Win to nil
  if (marketTypeId === MARKET_TYPES.WIN_TO_NIL) {
    if (outcomeType === OUTCOME_TYPES.HOME || nameLower.includes("gospodar")) {
      return teams?.homeTeam || "Gospodarze";
    }
    if (outcomeType === OUTCOME_TYPES.AWAY || nameLower.includes("go")) {
      return teams?.awayTeam || "Goscie";
    }
  }

  // Special half markets (win both halves, either half)
  if (
    marketTypeId === MARKET_TYPES.HOME_WIN_BOTH_HALVES ||
    marketTypeId === MARKET_TYPES.AWAY_WIN_BOTH_HALVES ||
    marketTypeId === MARKET_TYPES.HOME_WIN_EITHER_HALF ||
    marketTypeId === MARKET_TYPES.AWAY_WIN_EITHER_HALF
  ) {
    if (
      outcomeType === OUTCOME_TYPES.YES ||
      nameLower === "tak" ||
      nameLower === "yes"
    ) {
      return "Tak";
    }
    if (
      outcomeType === OUTCOME_TYPES.NO ||
      nameLower === "nie" ||
      nameLower === "no"
    ) {
      return "Nie";
    }
  }

  // Handicap markets - include line in name if present
  if (
    marketTypeId === MARKET_TYPES.HANDICAP ||
    marketTypeId === MARKET_TYPES.ASIAN_HANDICAP
  ) {
    if (outcomeType === OUTCOME_TYPES.HOME) {
      return teams?.homeTeam || "1";
    }
    if (outcomeType === OUTCOME_TYPES.TIE || outcomeType === OUTCOME_TYPES.DRAW) {
      return "Remis";
    }
    if (outcomeType === OUTCOME_TYPES.AWAY) {
      return teams?.awayTeam || "2";
    }
  }

  // Return original name if no mapping found - this allows the parser
  // to capture any market type not explicitly handled above
  return name || outcomeType || "Unknown";
}

/**
 * Group selections by market type and line
 */
function groupSelections(
  selections: PZBukSelection[]
): GroupedSelections {
  const groups: GroupedSelections = {};

  for (const sel of selections) {
    if (sel.status !== "Active") continue;

    // Create key: marketTypeId or marketTypeId:points for line markets
    let key = sel.marketTypeId;
    if (sel.points !== undefined) {
      key = `${sel.marketTypeId}:${sel.points}`;
    }

    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(sel);
  }

  return groups;
}

/**
 * Parse 1X2 market from grouped selections
 * Used for backward compatibility with scrapeLeague
 */
export function parse1X2Odds(
  selections: PZBukSelection[]
): { home: number; draw: number; away: number } {
  const result = { home: 0, draw: 0, away: 0 };

  const matchResultSelections = selections.filter(
    (s) => s.marketTypeId === MARKET_TYPES.MATCH_RESULT && s.status === "Active"
  );

  for (const sel of matchResultSelections) {
    const odds = sel.trueOdds;
    if (!odds || odds <= 1) continue;

    if (sel.outcomeType === OUTCOME_TYPES.HOME) {
      result.home = odds;
    } else if (
      sel.outcomeType === OUTCOME_TYPES.TIE ||
      sel.outcomeType === OUTCOME_TYPES.DRAW
    ) {
      result.draw = odds;
    } else if (sel.outcomeType === OUTCOME_TYPES.AWAY) {
      result.away = odds;
    }
  }

  return result;
}

/**
 * Parse Double Chance market from selections
 */
export function parseDoubleChance(
  selections: PZBukSelection[]
): { homeOrDraw: number; drawOrAway: number; homeOrAway: number } | null {
  const result = { homeOrDraw: 0, drawOrAway: 0, homeOrAway: 0 };
  let found = false;

  const dcSelections = selections.filter(
    (s) => s.marketTypeId === MARKET_TYPES.DOUBLE_CHANCE && s.status === "Active"
  );

  for (const sel of dcSelections) {
    const name = sel.name?.toLowerCase() || "";

    if (
      sel.outcomeType === OUTCOME_TYPES.HOME_OR_DRAW ||
      (name.includes("lub remis") && !name.startsWith("remis"))
    ) {
      result.homeOrDraw = sel.trueOdds;
      found = true;
    } else if (
      sel.outcomeType === OUTCOME_TYPES.DRAW_OR_AWAY ||
      name.startsWith("remis lub")
    ) {
      result.drawOrAway = sel.trueOdds;
      found = true;
    } else if (
      sel.outcomeType === OUTCOME_TYPES.HOME_OR_AWAY ||
      (name.includes(" lub ") && !name.includes("remis"))
    ) {
      result.homeOrAway = sel.trueOdds;
      found = true;
    }
  }

  return found ? result : null;
}

/**
 * Parse BTTS market from selections
 */
export function parseBTTS(
  selections: PZBukSelection[]
): { yes: number; no: number } | null {
  const result = { yes: 0, no: 0 };
  let found = false;

  const bttsSelections = selections.filter(
    (s) => s.marketTypeId === MARKET_TYPES.BTTS && s.status === "Active"
  );

  for (const sel of bttsSelections) {
    const name = sel.name?.toLowerCase() || "";

    if (
      sel.outcomeType === OUTCOME_TYPES.YES ||
      name === "tak" ||
      name === "yes"
    ) {
      result.yes = sel.trueOdds;
      found = true;
    } else if (
      sel.outcomeType === OUTCOME_TYPES.NO ||
      name === "nie" ||
      name === "no"
    ) {
      result.no = sel.trueOdds;
      found = true;
    }
  }

  return found ? result : null;
}

/**
 * Parse Over/Under markets from selections
 * Returns a record keyed by line (e.g., "2.5")
 */
export function parseOverUnder(
  selections: PZBukSelection[]
): Record<string, MarketOverUnderOdds> | null {
  const result: Record<string, MarketOverUnderOdds> = {};

  const ouSelections = selections.filter(
    (s) => s.marketTypeId === MARKET_TYPES.OVER_UNDER && s.status === "Active"
  );

  for (const sel of ouSelections) {
    const points = sel.points;
    if (points === undefined) continue;

    const lineStr = Number(points).toFixed(1);
    if (!lineStr.includes(".5")) continue; // Only standard lines

    if (!result[lineStr]) {
      result[lineStr] = { over: 0, under: 0 };
    }

    if (sel.outcomeType === OUTCOME_TYPES.OVER) {
      result[lineStr].over = sel.trueOdds;
    } else if (sel.outcomeType === OUTCOME_TYPES.UNDER) {
      result[lineStr].under = sel.trueOdds;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse ALL markets from WebSocket data into unified ScrapedMarket format
 * This is the main function for full offer scraping
 */
export function parseAllMarkets(
  data: PZBukInitialState,
  eventId: string,
  teams?: ParsedTeams
): ScrapedMarket[] {
  const markets: ScrapedMarket[] = [];

  // Filter selections for this event
  const eventSelections = (data.selections || []).filter(
    (s) => s.eventId === eventId && s.status === "Active"
  );

  if (eventSelections.length === 0) {
    return markets;
  }

  // Group selections by market type and line
  const groups = groupSelections(eventSelections);

  // Build a lookup of raw markets by their id so we can recover the
  // real API-provided market name (PZBukMarket.name / marketType.name)
  // that would otherwise be discarded.
  const marketById = new Map(
    (data.markets || []).map((m) => [m.id, m])
  );

  // Convert each group to ScrapedMarket
  for (const [key, selections] of Object.entries(groups)) {
    if (selections.length === 0) continue;

    const firstSelection = selections[0];
    const marketTypeId = firstSelection.marketTypeId;
    const line = firstSelection.points;

    // Recover the real API name from the parent market when available
    const rawMarket = marketById.get(firstSelection.marketId);
    const apiName = rawMarket?.name || rawMarket?.marketType?.name;

    // Name priority: (1) real API name, (2) audit-confirmed id label —
    // these must beat the guessed switch labels, which are proven wrong for
    // some ids (e.g. 33/34 are combo markets, not clean sheets) — then
    // (3) hard-coded switch label / "Rynek <id>" placeholder.
    const trimmedApiName = apiName?.trim();
    const idLabel = PZBUK_ID_LABELS[String(marketTypeId)];
    let marketName: string;
    if (trimmedApiName && !/^rynek\s*\d+$/i.test(trimmedApiName)) {
      marketName = trimmedApiName;
    } else if (idLabel) {
      // Do not append a vendor line of 0 — it is a structural filler, not a
      // real betting line (audit r3: "Podwójna szansa 0").
      marketName =
        line !== undefined && Number(line) !== 0
          ? `${idLabel} ${line}`
          : idLabel;
    } else {
      marketName = getMarketName(marketTypeId, line);
    }

    const groupName = MARKET_GROUPS[marketTypeId] || "Inne";
    const marketType = NORMALIZED_MARKET_TYPES[marketTypeId];

    // Convert selections to MarketSelection format.
    // Odds at or below 1.0 are sentinel/placeholder prices (suspended or
    // derived rows), never a real bookable offer — drop them so they cannot
    // poison best-odds aggregation. Exactly 1.01 IS a real minimum price
    // (audit r3: pzbuk's UNDER 5.5 goals ~1.01 was being dropped while every
    // peer quotes it) and can never falsely win a best-odds comparison.
    const marketSelections: MarketSelection[] = selections
      .map((sel) => ({
        name: getSelectionName(sel, marketTypeId, teams),
        odds: sel.trueOdds || 0,
        externalId: sel.id,
        status: sel.status === "Active" ? ("active" as const) : undefined,
      }))
      .filter((sel) => sel.odds > 1.0);

    // Only add markets with valid selections
    if (marketSelections.length > 0) {
      markets.push({
        name: marketName,
        // Carry the stable market-type id so the audit can match by id
        // instead of a brittle name regex
        bookmakerMarketId: String(marketTypeId),
        groupName,
        type: marketType,
        // Forward the vendor-provided line so the normalizer does not have
        // to re-derive it from selection labels (audit: label-derived lines
        // were shifted vs the odds actually delivered for that line)
        paramValue:
          line !== undefined ? String(line).replace(",", ".") : undefined,
        selections: marketSelections,
      });
    }
  }

  return markets;
}

/**
 * Validate that an event has the minimum required data
 */
export function isValidEvent(event: PZBukEvent): boolean {
  // Skip non-fixture events and suspended events
  if (event.type !== "Fixture" || event.isSuspended) {
    return false;
  }

  const teams = parseTeamNames(event);
  if (!teams.homeTeam || !teams.awayTeam) {
    return false;
  }

  return true;
}

/**
 * Check if event has valid 1X2 odds
 */
export function hasValid1X2Odds(
  selections: PZBukSelection[]
): boolean {
  const odds = parse1X2Odds(selections);
  return odds.home > 1 && odds.draw > 1 && odds.away > 1;
}
