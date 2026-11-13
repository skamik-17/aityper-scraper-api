/**
 * Superbet Parser Module
 *
 * Pure parsing logic for transforming Superbet API responses
 * into the unified ScrapedMarket format.
 *
 * This module has NO Playwright dependencies - it only works with
 * raw JSON data from the API.
 */

import type { MarketSelection, ScrapedMarket } from "../../../types/full-offer.js";
import {
  MARKET_IDS,
  MARKET_GROUPS,
  MARKET_TYPES,
  SELECTION_CODES,
  TEAM_SEPARATOR,
} from "./constants.js";
import type {
  SuperbetEvent,
  SuperbetOddsSelection,
  ParsedTeams,
} from "./types.js";

/**
 * Parse team names from the Superbet matchName format
 * Format: "HomeTeam · AwayTeam"
 */
export function parseTeamNames(matchName: string): ParsedTeams {
  const parts = matchName.split(TEAM_SEPARATOR);
  return {
    homeTeam: (parts[0] || "").trim(),
    awayTeam: (parts[1] || "").trim(),
  };
}

/**
 * Get human-readable market name based on market ID and selection data
 *
 * The Superbet API provides the authoritative display label in the
 * `marketName` field of every odds entry - prefer it whenever present.
 * The legacy id switch below had drifted from the real Superbet id space
 * (e.g. id 549 is "2.połowa - obie drużyny strzelą", NOT asian handicap;
 * id 553 is "1.połowa - handicap 1x2", NOT half-time result), so only the
 * few verified ids are kept as a fallback for responses without labels.
 */
function getMarketName(marketId: number, selection?: SuperbetOddsSelection): string {
  const apiName = selection?.marketName?.trim();
  if (apiName) {
    return apiName;
  }

  switch (marketId) {
    case MARKET_IDS.MATCH_RESULT_1X2:
      return "Wynik meczu";
    case MARKET_IDS.DOUBLE_CHANCE:
    case MARKET_IDS.DOUBLE_CHANCE_ALT:
      return "Podwojna szansa";
    case MARKET_IDS.BTTS:
    case MARKET_IDS.BTTS_ALT:
      return "Obie druzyny strzelą";
    case MARKET_IDS.TOTAL_GOALS:
      if (selection?.specialBetValue) {
        return `Liczba goli ${selection.specialBetValue}`;
      }
      return "Liczba goli";
    default:
      return `Rynek ${marketId}`;
  }
}

/**
 * Market ids whose selections legitimately arrive as bare outcome codes
 * ("1"/"0"/"2", "O"/"U") that should be renamed to display labels. For any
 * other market a short/numeric selection name ("0", "2", "3+") is a real
 * outcome (exact goal counts, ranges) and must be preserved as-is -
 * renaming those by code turned "0"/"1"/"2" into "Remis"/team names.
 */
const CODE_NAMED_MARKET_IDS = new Set<number>([
  MARKET_IDS.MATCH_RESULT_1X2,
  MARKET_IDS.DOUBLE_CHANCE,
  MARKET_IDS.DOUBLE_CHANCE_ALT,
  MARKET_IDS.BTTS,
  MARKET_IDS.BTTS_ALT,
  MARKET_IDS.TOTAL_GOALS,
  MARKET_IDS.TOTAL_GOALS_ALT,
  MARKET_IDS.TOTAL_GOALS_ALT2,
]);

/**
 * Fix malformed time-range labels coming from the Superbet API, e.g.
 * "45:00 - 59 minuty:59 minuty" -> "45:00 - 59:59 minuty".
 */
function cleanSelectionLabel(name: string): string {
  return name.replace(/(\d+)\s+minuty:(\d+)\s+minuty/u, "$1:$2 minuty");
}

/**
 * Get selection display name based on code and market type
 */
function getSelectionName(
  code: string,
  originalName: string | undefined,
  marketId: number,
  teams?: ParsedTeams
): string {
  // Use the original name whenever provided; fall through to code-based
  // renaming only for legacy core markets whose names are outcome codes.
  if (originalName && originalName.length > 0) {
    const isCodeLike = originalName.length <= 1 || /^[0-9]+$/.test(originalName);
    if (!isCodeLike || !CODE_NAMED_MARKET_IDS.has(marketId)) {
      return cleanSelectionLabel(originalName);
    }
  }

  // Map codes to display names
  switch (code) {
    // 1X2
    case SELECTION_CODES.HOME:
      if (marketId === MARKET_IDS.BTTS || marketId === MARKET_IDS.BTTS_ALT) {
        return "Tak";
      }
      return teams?.homeTeam || "1";
    case SELECTION_CODES.DRAW:
      return "Remis";
    case SELECTION_CODES.AWAY:
      if (marketId === MARKET_IDS.BTTS || marketId === MARKET_IDS.BTTS_ALT) {
        return "Nie";
      }
      return teams?.awayTeam || "2";

    // Double Chance
    case SELECTION_CODES.HOME_OR_DRAW:
    case SELECTION_CODES.HOME_OR_DRAW_ALT:
      return "1X";
    case SELECTION_CODES.DRAW_OR_AWAY:
    case SELECTION_CODES.DRAW_OR_AWAY_ALT:
      return "X2";
    case SELECTION_CODES.HOME_OR_AWAY:
      return "12";

    // Over/Under
    case SELECTION_CODES.OVER:
      return "Powyzej";
    case SELECTION_CODES.UNDER:
      return "Ponizej";

    // BTTS
    case SELECTION_CODES.BTTS_YES:
      return "Tak";
    case SELECTION_CODES.BTTS_NO:
      return "Nie";

    default:
      return originalName || code;
  }
}

/**
 * Odds at or below this value are placeholder/sentinel prices (Superbet
 * publishes lines it does not really offer as e.g. UNDER 1.00 / OVER 100),
 * never a real bookmaker quote.
 */
const SENTINEL_ODDS_MAX = 1.005;

/**
 * "Każda z drużyn powyżej X ..." markets: the catalog defines only the OVER
 * (yes) side; the "nie" leg has no canonical selection and would normalize
 * to a duplicate OVER (its name also starts with "Powyżej ...").
 * 200697 = fouls, 200709 = shots on target, 200721 = offsides.
 */
const EACH_TEAM_OVER_MARKET_IDS = new Set<number>([200697, 200709, 200721]);

/**
 * Player-list markets (one raw row per player or player pair, no real
 * betting "line") - Superbet's feed still tags every such row with a
 * per-player `specialBetValue`, which the generic grouping key below
 * otherwise treats as a distinguishing line, splitting one logical market
 * into many single-selection groups. Since every player/pair resolves to
 * the identical marketCode with no param, all those groups collapse to the
 * same normalized market_key; the storage upsert (keyed by match+bookmaker+
 * market_key+scraped_at) then keeps only whichever group was written last,
 * silently dropping every other player/pair (confirmed: TWO_PLAYERS_ANYTIME,
 * BOTH_PLAYERS_ANYTIME, GOALSCORER_FIRST, GOALSCORER_ANYTIME, PLAYER_CARDS,
 * PLAYER_RED_CARD, PLAYER_2_OR_MORE_GOALS all persisted with exactly one
 * selection instead of the ~40-100 the raw feed actually offers). Grouping
 * by marketId alone keeps every player/pair in the same market.
 */
const PLAYER_LIST_MARKET_IDS = new Set<number>([
  600,
  601, // GOALSCORER_ANYTIME / GOALSCORER_FIRST listing aliases
  236226,
  236424, // GOALSCORER_ANYTIME / GOALSCORER_FIRST
  233486,
  233487,
  233488, // HALF_TIME/SECOND_HALF_GOALSCORER_ANYTIME, PLAYER_SCORES_BOTH_HALVES
  236240,
  236242, // PLAYER_CARDS, PLAYER_RED_CARD
  201787, // FIRST_PLAYER_CARDED
  239910, // PLAYER_OF_THE_MATCH
  236230,
  236232, // PLAYER_GOAL_OR_ASSIST, PLAYER_GOAL_AND_ASSIST
  236244,
  236246, // PLAYER_2_OR_MORE_GOALS, PLAYER_3_OR_MORE_GOALS
  236426,
  237087, // PLAYER_HEADER_GOAL (+ alt id)
  236428,
  236430, // PLAYER_LEFT_FOOT_GOAL, PLAYER_RIGHT_FOOT_GOAL
  236436, // PLAYER_GOAL_OUTSIDE_BOX
  236432, // PENALTY_SCORER
  237085, // PLAYER_FREE_KICK_GOAL
  233484,
  233485, // TWO_PLAYERS_ANYTIME, BOTH_PLAYERS_ANYTIME
]);

/**
 * Per-player STAT-LINE markets (shots, shots on target, fouls, fouls won,
 * tackles, assists, offsides; one catalog code per id below): unlike
 * PLAYER_LIST_MARKET_IDS above, the normalizer keys these by the PLAYER as
 * the market parameter and reduces every selection to just the threshold
 * outcome ("1+"/"2+"), so one raw group must hold exactly one player's
 * whole ladder. Grouping by marketId+specialBetValue like the generic O/U
 * markets breaks that in both formats Superbet has used:
 * - Today (2026-11-06 capture) `specialBetValue` is
 *   `sr:player:<id>-<Name>-<line>` (e.g. "sr:player:100578-John Egan-0.5"),
 *   one value per player-line row, so that key would split every player's
 *   ladder into one single-selection raw market per line.
 * - Earlier (2026-08-19 capture) it was the bare THRESHOLD ("0.5", "2.5"),
 *   shared by every player, so that key bundled every player who happened to
 *   share a threshold into one raw group - the normalizer then read only the
 *   first bundled row's player name as the group's single param and mixed
 *   every other player's price under that one player's column (confirmed:
 *   PLAYER_OFFSIDES mixed Sbai's and Mbappe's higher-threshold rows in under
 *   whichever player's row the API happened to list first).
 * Group these by the player identity embedded in the selection name instead
 * ("John Egan - powyżej 0.5", or the older "Sbai, Amine - powyżej 2.5"), so
 * one raw group always corresponds to exactly one player.
 */
const PLAYER_STAT_LINE_MARKET_IDS = new Set<number>([
  236218, // PLAYER_SHOTS: "Zawodnik - liczba strzałów"
  236224, // PLAYER_OFFSIDES: "Zawodnik - liczba spalonych"
  238465, // PLAYER_HEADER_SHOTS_ON_TARGET: "Zawodnik - liczba celnych strzałów głową"
  236216, // PLAYER_FOULS: "Zawodnik - liczba popełnionych fauli"
  238449, // PLAYER_FOULS_WON: "Zawodnik - liczba fauli na zawodniku"
  236220, // PLAYER_SHOTS_ON_TARGET: "Zawodnik - liczba celnych strzałów"
  236222, // PLAYER_TACKLES: "Zawodnik - liczba odbiorów"
  238485, // PLAYER_SHOTS_OUTSIDE_BOX: "Zawodnik - liczba strzałów spoza pola karnego"
  238469, // PLAYER_SHOTS_ON_TARGET_OUTSIDE_BOX: "Zawodnik - liczba celnych strzałów spoza pola karnego"
  239621, // PLAYER_ASSISTS: "Zawodnik - liczba asyst"
  // The OTHER-mapped stat lines (238453, 238457, 238461, 238473, 238477,
  // 238481) are left out on purpose: OTHER has no player key to group by.
]);

/**
 * Player identity portion of a stat-line selection name, e.g.
 * "John Egan - powyżej 0.5" -> "john egan" (today's First-Last format) or
 * "Sbai, Amine - powyżej 2.5" -> "sbai, amine" (the 2026-08 Last, First
 * format). Falls back to the full (lowercased) name for bare player rows
 * with no threshold suffix.
 */
function extractPlayerStatGroupKey(name: string | undefined): string {
  const trimmed = (name ?? "").trim();
  const withoutLine = trimmed.replace(/\s*-\s*powy[żz]ej\s+[\d.,]+\s*$/iu, "");
  return (withoutLine || trimmed).toLowerCase();
}

/**
 * Superbet returns some market names with an uninterpolated "X" placeholder
 * ("Liczba goli - do X minuty"). Substitute the real minute when it can be
 * recovered unambiguously from the selection names.
 */
function interpolatePlaceholderMinute(
  marketName: string,
  selections: SuperbetOddsSelection[]
): string {
  if (!/\bdo X minuty\b/iu.test(marketName)) return marketName;
  const minutes = new Set<string>();
  for (const sel of selections) {
    const match = sel.name?.match(/do\s+(\d+)\.?\s*minut/iu);
    if (match) minutes.add(match[1]);
  }
  if (minutes.size === 1) {
    const minute = Array.from(minutes)[0];
    return marketName.replace(/\bdo X minuty\b/iu, `do ${minute}. minuty`);
  }
  return marketName;
}

/**
 * Parse ALL markets from event odds into unified ScrapedMarket format
 * This is the main function for full offer scraping
 */
export function parseAllMarkets(
  event: SuperbetEvent,
  teams?: ParsedTeams
): ScrapedMarket[] {
  const markets: ScrapedMarket[] = [];
  const odds = event.odds || [];

  if (odds.length === 0) {
    return markets;
  }

  // Get teams from event if not provided
  const parsedTeams = teams || parseTeamNames(event.matchName);

  // Group selections by market ID and line (for O/U markets)
  const marketGroups = new Map<string, SuperbetOddsSelection[]>();

  for (const selection of odds) {
    // Create unique key for market grouping
    // For line markets (O/U, handicap), include the line in the key. Skip
    // this for player-list markets, whose specialBetValue is not a real
    // line - see PLAYER_LIST_MARKET_IDS. Per-player stat-line markets need
    // the opposite treatment: group by player identity, not specialBetValue
    // (a shared threshold in the 2026-08 format, one value per player-line
    // row today) - see PLAYER_STAT_LINE_MARKET_IDS.
    let key = String(selection.marketId);
    if (PLAYER_STAT_LINE_MARKET_IDS.has(selection.marketId)) {
      key += `_${extractPlayerStatGroupKey(selection.name)}`;
    } else if (selection.specialBetValue && !PLAYER_LIST_MARKET_IDS.has(selection.marketId)) {
      key += `_${selection.specialBetValue}`;
    }

    if (!marketGroups.has(key)) {
      marketGroups.set(key, []);
    }
    marketGroups.get(key)!.push(selection);
  }

  // Convert each group to ScrapedMarket
  for (const [key, selections] of marketGroups) {
    if (selections.length === 0) continue;

    const firstSelection = selections[0];
    const marketId = firstSelection.marketId;
    const line = firstSelection.specialBetValue;

    // Get market metadata
    const marketName = interpolatePlaceholderMinute(
      getMarketName(marketId, firstSelection),
      selections
    );
    const groupName = MARKET_GROUPS[marketId] || "Inne";
    const marketType = MARKET_TYPES[marketId];

    // Convert selections to MarketSelection format
    const parsedSelections: MarketSelection[] = selections
      .filter(
        (sel) =>
          // The "nie" leg of "każda z drużyn powyżej X" markets has no
          // canonical selection - see EACH_TEAM_OVER_MARKET_IDS.
          !(EACH_TEAM_OVER_MARKET_IDS.has(marketId) && /-\s*nie\s*$/iu.test(sel.name ?? ""))
      )
      .map((sel) => ({
        name: getSelectionName(sel.code, sel.name, marketId, parsedTeams),
        odds: sel.price || 0,
        // The uuid is the real per-selection id; outcomeId is shared across
        // lines and players, so it is deliberately not a fallback.
        externalId: sel.uuid ?? (sel.id != null ? String(sel.id) : undefined),
        status: sel.status === "active" ? "active" as const : undefined,
      }))
      .filter((sel) => sel.odds > 0);

    // Reject sentinel prices. When a two-way line loses a leg to the filter
    // (e.g. UNDER 1.00 / OVER 100) the whole line is a placeholder Superbet
    // does not actually offer - drop it entirely. The same applies to 3-way
    // lined markets (e.g. "1.połowa - handicap 1X2" at extreme lines where
    // HOME sits at 1.00): publishing only the surviving legs misrepresents
    // the line, so drop the whole line when any leg was a sentinel.
    const priceableSelections = parsedSelections.filter((sel) => sel.odds > SENTINEL_ODDS_MAX);
    const lostSentinelLeg = priceableSelections.length < parsedSelections.length;
    const marketSelections =
      (parsedSelections.length === 2 && priceableSelections.length === 1) ||
      (Boolean(line) && parsedSelections.length === 3 && lostSentinelLeg)
        ? []
        : priceableSelections;

    // Only add markets with valid selections
    if (marketSelections.length > 0) {
      markets.push({
        name: marketName,
        // Carry the stable Superbet market-type id so the audit can match
        // markets by id instead of brittle name regex.
        bookmakerMarketId: String(marketId),
        groupName,
        type: marketType,
        selections: marketSelections,
      });
    }
  }

  return markets;
}

/**
 * Validate that an event has the minimum required data
 */
export function isValidEvent(event: SuperbetEvent): boolean {
  if (!event.matchName) return false;
  if (!event.eventId) return false;

  const teams = parseTeamNames(event.matchName);
  if (!teams.homeTeam || !teams.awayTeam) return false;

  return true;
}

/**
 * Check whether an event from the by-date listing is a genuine upcoming
 * match that still has a full prematch offer.
 *
 * The by-date endpoint also returns already-played matches (status FINISHED /
 * matchStatusLabel "END"), which carry marketCount 0-1 (only residual settled
 * markets). Iterating those first makes the full-offer scrape report a near-empty
 * market count even though every real upcoming match carries ~350 markets.
 * This filter excludes settled / offer-less / kicked-off events so the first
 * processed match reflects the true offer.
 */
export function isUpcomingOfferedEvent(
  event: SuperbetEvent,
  now: number = Date.now()
): boolean {
  if (!isValidEvent(event)) return false;

  // No offer left (settled or closed match)
  if (typeof event.marketCount === "number" && event.marketCount === 0) {
    return false;
  }

  // Finished / ended match (metadata is null for not-yet-started events)
  const status = event.metadata?.status;
  const statusLabel = event.metadata?.matchStatusLabel;
  if (status === "FINISHED" || statusLabel === "END") {
    return false;
  }

  // Kickoff already in the past
  if (typeof event.unixDateMillis === "number" && event.unixDateMillis < now) {
    return false;
  }

  return true;
}
