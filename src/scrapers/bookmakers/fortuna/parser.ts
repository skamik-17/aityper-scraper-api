/**
 * Fortuna Parser Module
 *
 * Pure parsing logic for transforming Fortuna API responses
 * into the unified ScrapedMarket format.
 *
 * This module has NO Playwright dependencies - it only works with
 * raw JSON data from the API.
 */

import type { MarketSelection, ScrapedMarket } from "../../../types/full-offer.js";
import {
  MARKET_TYPE_IDS,
  MARKET_GROUPS,
  MARKET_TYPES,
  MARKET_TYPE_FALLBACK_LABELS,
  SELECTION_CODES,
} from "./constants.js";
import type {
  FortunaFixture,
  FortunaMarket,
  FortunaOutcome,
  ParsedTeams,
} from "./types.js";

/**
 * Parse team names from a Fortuna fixture
 * Uses participants array first, falls back to parsing name
 */
export function parseTeamNames(fixture: FortunaFixture): ParsedTeams {
  // Try participants first
  const homeParticipant = fixture.participants?.find((p) => p.type === "HOME");
  const awayParticipant = fixture.participants?.find((p) => p.type === "AWAY");

  if (homeParticipant?.name && awayParticipant?.name) {
    return {
      homeTeam: homeParticipant.name.trim(),
      awayTeam: awayParticipant.name.trim(),
    };
  }

  // Fallback to parsing name string
  if (fixture.name) {
    const match = fixture.name.match(/^(.+?)\s*[-–]\s*(.+)$/);
    if (match) {
      return {
        homeTeam: match[1].trim(),
        awayTeam: match[2].trim(),
      };
    }
  }

  return { homeTeam: "", awayTeam: "" };
}

/**
 * A blank or fallback-looking API market name we should not trust.
 * Only internal-code leaks are rejected ("Rynek ufo:mtyp:00-23", "ufo:mkt:...").
 * Legit Fortuna labels routinely contain a scope colon ("Mecz: liczba goli",
 * "1.połowa: wynik/liczba goli w 1.połowie") and MUST be kept — rejecting any
 * name with ":" previously replaced the whole offer's names with placeholders.
 */
function isUselessApiName(name: string): boolean {
  const n = name.trim();
  return n.length === 0 || /^rynek\s/i.test(n) || n.includes("ufo:");
}

/**
 * Get human-readable market name. Prefer the API-provided name; fall back to the
 * hard-coded switch for the core market types, then to "Rynek <id>".
 */
export function getMarketName(market: FortunaMarket): string {
  const apiName = (market.name || market.marketTypeName || "").trim();
  if (apiName && !isUselessApiName(apiName)) return apiName;

  // Check for line markets and include the line in the name
  const line = market.specifiers?.total || market.specifiers?.line;

  switch (market.marketTypeId) {
    case MARKET_TYPE_IDS.MATCH_RESULT:
      return "Wynik meczu";
    case MARKET_TYPE_IDS.DOUBLE_CHANCE:
      return "Podwojna szansa";
    case MARKET_TYPE_IDS.BTTS:
      return "Obie druzyny strzelą";
    case MARKET_TYPE_IDS.OVER_UNDER:
      return line ? `Liczba goli ${line}` : "Liczba goli";
    case MARKET_TYPE_IDS.HALF_TIME_RESULT:
      return "Wynik 1. polowy";
    case MARKET_TYPE_IDS.HALF_TIME_OVER_UNDER:
      return line ? `Liczba goli 1. polowa ${line}` : "Liczba goli 1. polowa";
    case MARKET_TYPE_IDS.HALF_TIME_BTTS:
      return "Obie strzelą 1. polowa";
    // NOTE: ids 00-0v ("ASIAN_HANDICAP"), 00-0w ("EUROPEAN_HANDICAP"),
    // 00-04 ("CORRECT_SCORE") and 00-1a ("ODD_EVEN_GOALS") turned out to carry
    // different markets on the live API (goal bands, HT-or-FT double chance,
    // home-team odd/even) — their labels now come from
    // MARKET_TYPE_FALLBACK_LABELS / the placeholder instead of wrong names here.
    case MARKET_TYPE_IDS.DRAW_NO_BET:
      return "Remis = zwrot";
    case MARKET_TYPE_IDS.ODD_EVEN_GOALS:
      return "Gospodarze Liczba goli P/N";
    default:
      // Known ids get a curated Polish label instead of the raw internal code
      return (
        MARKET_TYPE_FALLBACK_LABELS[market.marketTypeId] ??
        `Rynek ${market.marketTypeId}`
      );
  }
}

/**
 * Exact-goals markets: 00-16/00-17 ("<team> dokładna liczba goli") and 00-3e
 * ("2.połowa: dokładna liczba goli"). Their outcomes are goal counts ("0",
 * "1", "2", "3+"; the 2nd half "0", "1", "2+") whose bare-digit codes are the
 * 1X2 codes too, so the HOME/DRAW/AWAY fallback in getSelectionName rewrote
 * Arsenal's "2 / 3+ / 1 / 0" into "Hull / 3+ / Arsenal / Remis" (health
 * check 2026-11-06, D6). The raw count IS the display label and the catalog
 * selection code; they are exempt like 00-0v/00-0w.
 */
const EXACT_GOALS_MARKET_TYPE_IDS = new Set<string>([
  "ufo:mtyp:00-16",
  "ufo:mtyp:00-17",
  "ufo:mtyp:00-3e",
]);

/**
 * Get selection display name based on outcome code and market type
 */
function getSelectionName(
  outcome: FortunaOutcome,
  marketTypeId: string,
  teams?: ParsedTeams
): string {
  const code = outcome.name;
  const longName = outcome.longName;

  // Use longName if it's meaningful
  if (longName && longName.length > 1 && !longName.match(/^[0-9]+$/)) {
    return longName;
  }

  // 00-0v/00-0w (misleadingly named ASIAN_HANDICAP/EUROPEAN_HANDICAP in
  // MARKET_TYPE_IDS) do NOT carry 1X2/handicap outcomes on the live API —
  // they quote a 4-way corners-count band ("0-1", "2", "3", "4+") whose "2"
  // bucket reuses the same raw outcome code ("2") as the 1X2 AWAY leg. The
  // generic HOME/AWAY-to-teamname fallback below must never fire for these
  // two ids: it was silently replacing the "2" band label with the away
  // team's name (audit /audit-match, premier-league Arsenal vs Coventry
  // City), destroying one of the four selections. Keep the raw band code —
  // it IS the correct display label ("0", "1", "2", ...) for this market.
  // The exact-goals ids share the same collision (EXACT_GOALS_MARKET_TYPE_IDS).
  if (
    marketTypeId === MARKET_TYPE_IDS.ASIAN_HANDICAP ||
    marketTypeId === MARKET_TYPE_IDS.EUROPEAN_HANDICAP ||
    EXACT_GOALS_MARKET_TYPE_IDS.has(marketTypeId)
  ) {
    return code;
  }

  // Map codes to display names
  switch (code) {
    // 1X2
    case SELECTION_CODES.HOME:
      if (
        marketTypeId === MARKET_TYPE_IDS.BTTS ||
        marketTypeId === MARKET_TYPE_IDS.HALF_TIME_BTTS
      ) {
        return "Tak";
      }
      return teams?.homeTeam || "1";
    case SELECTION_CODES.DRAW:
      return "Remis";
    case SELECTION_CODES.AWAY:
      if (
        marketTypeId === MARKET_TYPE_IDS.BTTS ||
        marketTypeId === MARKET_TYPE_IDS.HALF_TIME_BTTS
      ) {
        return "Nie";
      }
      return teams?.awayTeam || "2";

    // Double Chance
    case SELECTION_CODES.HOME_OR_DRAW:
      return "1X";
    case SELECTION_CODES.DRAW_OR_AWAY:
      return "X2";
    case SELECTION_CODES.HOME_OR_AWAY:
      return "12";

    default:
      // For Over/Under, use the code which contains +/- prefix
      if (code.startsWith("+") || code.startsWith("+ ")) {
        return "Powyzej";
      }
      if (code.startsWith("-") || code.startsWith("- ")) {
        return "Ponizej";
      }
      return longName || code;
  }
}

/**
 * Parse ALL markets from Fortuna API response into unified ScrapedMarket format
 * This is the main function for full offer scraping
 */
export function parseAllMarkets(
  markets: FortunaMarket[],
  teams?: ParsedTeams
): ScrapedMarket[] {
  const result: ScrapedMarket[] = [];

  if (!markets || markets.length === 0) {
    return result;
  }

  for (const market of markets) {
    if (!market.outcomes || market.outcomes.length === 0) {
      continue;
    }

    const marketTypeId = market.marketTypeId;

    // Get market metadata
    const marketName = getMarketName(market);
    const groupName = MARKET_GROUPS[marketTypeId] || "Inne";
    const marketType = MARKET_TYPES[marketTypeId];

    // Convert outcomes to MarketSelection format
    const rawSelections: MarketSelection[] = market.outcomes.map((outcome) => ({
      name: getSelectionName(outcome, marketTypeId, teams),
      odds: outcome.odds || 0,
      externalId: market.id,
      status: "active" as const,
    }));

    // Odds of exactly 1.00 (or below) are always a sentinel for a
    // suspended/closed outcome — no bookmaker offers a real quote with zero
    // margin/profit, so this is never a genuine price regardless of whether
    // the market is binary and the other leg is actively quoted. Filter it
    // out unconditionally; only the live leg(s) survive.
    const selections = rawSelections.filter((sel) => sel.odds > 1);

    // Only add markets with valid selections
    if (selections.length > 0) {
      result.push({
        name: marketName,
        bookmakerMarketId: marketTypeId,
        groupName,
        type: marketType,
        selections,
      });
    }
  }

  return result;
}

/**
 * Validate that a fixture has the minimum required data
 */
export function isValidFixture(fixture: FortunaFixture): boolean {
  if (!fixture.id) return false;

  const teams = parseTeamNames(fixture);
  if (!teams.homeTeam || !teams.awayTeam) return false;

  return true;
}
