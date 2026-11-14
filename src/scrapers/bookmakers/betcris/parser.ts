/**
 * Betcris Parser Module
 *
 * Pure parsing logic for transforming Swarm WebSocket API responses
 * into the unified ScrapedMarket format.
 *
 * This module has NO Playwright dependencies - it only works with
 * raw JSON data captured from WebSocket frames.
 */

import type { MarketSelection, ScrapedMarket } from "../../../types/full-offer.js";
import type {
  SwarmData,
  SwarmGame,
  SwarmMarket,
  SwarmEvent,
  ParsedTeams,
} from "./types.js";
import {
  SWARM_MARKET_TYPES,
  MARKET_GROUPS,
  MARKET_TYPE_MAPPING,
  SELECTION_CODES,
  TEAM_TIER_LADDER_TYPES,
  PLAYER_TIER_LADDER_TYPES,
  PLAYER_TIER_LIST_TYPES,
} from "./constants.js";

/**
 * Parse team names from a Swarm game
 */
export function parseTeamNames(game: SwarmGame): ParsedTeams {
  return {
    homeTeam: game.team1_name?.trim() || "",
    awayTeam: game.team2_name?.trim() || "",
  };
}

/**
 * Get human-readable market name from Swarm market
 */
function getMarketName(market: SwarmMarket): string {
  // Prefer the market name from the API if available
  if (market.name && market.name.length > 0) {
    return market.name;
  }

  // Fallback to type-based naming
  switch (market.type) {
    case SWARM_MARKET_TYPES.MATCH_RESULT:
      return "Wynik meczu";
    case SWARM_MARKET_TYPES.DOUBLE_CHANCE:
    case SWARM_MARKET_TYPES.DOUBLE_CHANCE_ALT:
      return "Podwojna szansa";
    case SWARM_MARKET_TYPES.OVER_UNDER:
      return market.base ? `Liczba goli ${market.base}` : "Liczba goli";
    case SWARM_MARKET_TYPES.BTTS:
      return "Obie druzyny strzela";
    case SWARM_MARKET_TYPES.HALF_TIME_RESULT:
      return "Wynik 1. polowy";
    case SWARM_MARKET_TYPES.HALF_TIME_OVER_UNDER:
      return market.base ? `Gole 1. polowa ${market.base}` : "Gole 1. polowa";
    case SWARM_MARKET_TYPES.HALF_TIME_BTTS:
      return "Obie strzela 1. polowa";
    case SWARM_MARKET_TYPES.TEAM1_OVER_UNDER:
      return market.base ? `Gole gospodarzy ${market.base}` : "Gole gospodarzy";
    case SWARM_MARKET_TYPES.TEAM2_OVER_UNDER:
      return market.base ? `Gole gosci ${market.base}` : "Gole gosci";
    case SWARM_MARKET_TYPES.ASIAN_HANDICAP:
      return market.base ? `Handicap azjatycki ${market.base}` : "Handicap azjatycki";
    case SWARM_MARKET_TYPES.EUROPEAN_HANDICAP:
      return market.base ? `Handicap europejski ${market.base}` : "Handicap europejski";
    case SWARM_MARKET_TYPES.CORRECT_SCORE:
      return "Dokladny wynik";
    case SWARM_MARKET_TYPES.DRAW_NO_BET:
      return "Remis = zwrot";
    case SWARM_MARKET_TYPES.ODD_EVEN:
      return "Parzyste/Nieparzyste";
    case SWARM_MARKET_TYPES.WIN_TO_NIL:
      return "Wygrana do zera";
    case SWARM_MARKET_TYPES.CLEAN_SHEET:
      return "Czyste konto";
    case SWARM_MARKET_TYPES.HALF_TIME_FULL_TIME:
      return "Wynik polowa/mecz";
    default:
      return market.name || `Rynek ${market.type}`;
  }
}

/**
 * Get selection display name from Swarm event
 */
function getSelectionName(event: SwarmEvent, market: SwarmMarket, teams?: ParsedTeams): string {
  // Prefer the event name if meaningful
  if (event.name && event.name.length > 1 && !event.name.match(/^[0-9]+$/)) {
    return event.name;
  }

  const type1 = event.type_1?.toUpperCase() || "";

  // Map type_1 codes to display names
  switch (type1) {
    case SELECTION_CODES.HOME:
      return teams?.homeTeam || "1";
    case SELECTION_CODES.DRAW:
      return "Remis";
    case SELECTION_CODES.AWAY:
      return teams?.awayTeam || "2";
    case SELECTION_CODES.HOME_OR_DRAW:
      return "1X";
    case SELECTION_CODES.DRAW_OR_AWAY:
      return "X2";
    case SELECTION_CODES.HOME_OR_AWAY:
      return "12";
    case SELECTION_CODES.OVER.toUpperCase():
      return market.base ? `Powyzej ${market.base}` : "Powyzej";
    case SELECTION_CODES.UNDER.toUpperCase():
      return market.base ? `Ponizej ${market.base}` : "Ponizej";
    case SELECTION_CODES.YES.toUpperCase():
      return "Tak";
    case SELECTION_CODES.NO.toUpperCase():
      return "Nie";
    default:
      return event.name || type1;
  }
}

/**
 * Swarm market types that bundle MANY players into a single market object
 * (each event's `name` is a player, not an Over/Under/Yes/No outcome), unlike
 * Betcris' usual one-market-per-player structure (e.g. "PlayerTotalShots").
 * Left unsplit, every player collapses into one unlabeled "base" parameter
 * bucket downstream. The value is the selection label to synthesize for each
 * split entry so the normalizer resolves it to the catalog's expected code
 * ("Powyzej" -> OVER; "1+" matches the player-assists threshold selection
 * directly; "Tak" resolves to the YES/NO family used by the single-price
 * player-prop products, e.g. PLAYER_4_OR_MORE_GOALS).
 */
const BULK_PLAYER_LIST_MARKET_SELECTION: Record<string, string> = {
  PlayerShotsOver: "Powyzej",
  PlayerShotsonTargetOver: "Powyzej",
  PlayerFoulsCommittedOver: "Powyzej",
  PlayerToBeFouledOver: "Powyzej",
  PlayertoBeinOffsideOver: "Powyzej",
  GoalkeeperSaves: "Powyzej",
  ToAssistaGoal: "1+",
  // round8 audit (Arsenal vs Coventry City): this is a standalone one-price
  // 4+ product (PLAYER_4_OR_MORE_GOALS, YES/NO catalog vocabulary), not a
  // rung of the PLAYER_GOALS 1+/2+/3+ tiered ladder — the synthesized marker
  // must match the YES/NO family (see betcris-normalizer.ts's "Tak"->YES
  // handling), not a bare "4+" tier label the catalog no longer declares
  // there.
  PlayerToScore4OrMore: "Tak",
  // "Strzelec gola / mecz zakończy się remisem" — every event in this market
  // is a player, and the whole market represents the fixed "scores AND draw"
  // scenario, so the selection code is the constant draw marker ("X" ->
  // BETCRIS_SELECTION_CODES -> DRAW) once split per player.
  PlayerWillScoreandMatchWillEndDraw: "X",
};

/**
 * Read an "N+" tier label: "22+" (team ladder rung, no subject) or
 * "<player> N+" (player ladder rung). Inner whitespace in the subject is
 * collapsed. Anything else ("Tak", "Powyżej 2.5", ...) returns null.
 */
export function parseTierLabel(name: string): { subject: string | null; tier: number } | null {
  const match = name.trim().match(/^(?:(.*\S)\s+)?(\d+)\+$/);
  if (!match) return null;
  return {
    subject: match[1] !== undefined ? match[1].replace(/\s+/g, " ") : null,
    tier: Number(match[2]),
  };
}

type TierLadderKind = "team" | "player" | "list";

function getTierLadderKind(marketType: string): TierLadderKind | null {
  if (TEAM_TIER_LADDER_TYPES.has(marketType)) return "team";
  if (PLAYER_TIER_LADDER_TYPES.has(marketType)) return "player";
  if (PLAYER_TIER_LIST_TYPES.has(marketType)) return "list";
  return null;
}

/**
 * Split one renamed Swarm "N+" ladder market (see the *_TIER_* sets in
 * constants.ts) into entries the normalizer can key by line or by player:
 * - team ladder: one entry per rung, sorted by tier, `paramValue` = N - 0.5
 *   and a single "Powyżej" selection ("22+" is the same bet as Over 21.5);
 * - player ladder: one entry per player (first-seen order), `paramValue` =
 *   player, selections "<tier>+" sorted by tier;
 * - player list: one entry whose selections are player names, built only
 *   from "1+" events.
 * Every event that does not fit its ladder's shape (a non-tier label, a
 * subject where none belongs or a missing one, a team tier "0+", a list tier
 * other than 1+)
 * goes, with its original label, into one trailing residual entry without
 * `paramValue`. No tier is ever invented or collapsed.
 */
function splitTierLadder(
  kind: TierLadderKind,
  base: Omit<ScrapedMarket, "selections" | "paramValue">,
  selections: MarketSelection[]
): ScrapedMarket[] {
  const entries: ScrapedMarket[] = [];
  const rungs: Array<{ tier: number; selection: MarketSelection }> = [];
  const players = new Map<string, Array<{ tier: number; selection: MarketSelection }>>();
  const listSelections: MarketSelection[] = [];
  const residual: MarketSelection[] = [];

  for (const selection of selections) {
    const label = parseTierLabel(selection.name);
    // A team rung needs tier >= 1: "0+" would be Over -0.5, a line no peer quotes.
    if (kind === "team" && label && label.subject === null && label.tier >= 1) {
      rungs.push({ tier: label.tier, selection });
    } else if (kind === "player" && label && label.subject !== null) {
      const tiers = players.get(label.subject) ?? [];
      tiers.push({ tier: label.tier, selection });
      players.set(label.subject, tiers);
    } else if (kind === "list" && label && label.subject !== null && label.tier === 1) {
      listSelections.push({ ...selection, name: label.subject });
    } else {
      residual.push(selection);
    }
  }

  for (const { tier, selection } of rungs.sort((a, b) => a.tier - b.tier)) {
    entries.push({
      ...base,
      paramValue: String(tier - 0.5),
      selections: [{ ...selection, name: "Powyżej" }],
    });
  }

  for (const [player, tiers] of players) {
    entries.push({
      ...base,
      paramValue: player,
      selections: tiers
        .sort((a, b) => a.tier - b.tier)
        .map(({ tier, selection }) => ({ ...selection, name: `${tier}+` })),
    });
  }

  if (listSelections.length > 0) {
    entries.push({ ...base, selections: listSelections });
  }

  if (residual.length > 0) {
    entries.push({ ...base, selections: residual });
  }

  return entries;
}

function displayOrder(node: { order?: number }): number {
  return typeof node.order === "number" && Number.isFinite(node.order) ? node.order : Number.MAX_SAFE_INTEGER;
}

/**
 * The values of a Swarm map sorted by (order, id). Event ids (~7.4e9) and, soon,
 * market ids (~2.54e9) are not array-index keys, so `Object.values` would follow
 * the server's key order, which changes between replies with identical odds.
 */
function inDisplayOrder<T extends { id: number; order?: number }>(map: Record<string, T> | undefined): T[] {
  return Object.values(map || {}).sort((a, b) => displayOrder(a) - displayOrder(b) || a.id - b.id);
}

/**
 * Parse ALL markets from a game into unified ScrapedMarket format
 * This is the main function for full offer scraping
 */
export function parseAllMarkets(game: SwarmGame, teams?: ParsedTeams): ScrapedMarket[] {
  const markets: ScrapedMarket[] = [];
  const parsedTeams = teams || parseTeamNames(game);

  for (const market of inDisplayOrder(game.market)) {
    const events = inDisplayOrder(market.event);
    if (events.length === 0) continue;

    // Get market metadata
    const marketName = getMarketName(market);
    const groupName = MARKET_GROUPS[market.type] || "Inne";
    const marketType = MARKET_TYPE_MAPPING[market.type];

    // Extract the raw line value (total/handicap) so parameterized markets do
    // not collapse into a single placeholder "base" bucket at normalization
    // time. Swarm exposes the line on the market itself; when absent, fall
    // back to the home-side event base (home-relative for handicap markets)
    // or any event that carries a base.
    let lineBase: number | undefined =
      market.base !== undefined && market.base !== null ? market.base : undefined;
    if (lineBase === undefined) {
      const homeSideEvent = events.find((event) => {
        const type1 = (event.type_1 || "").toUpperCase();
        return type1 === "W1" || type1 === "HOME" || type1 === "OVER";
      });
      const anyEventWithBase = events.find(
        (event) => event.base !== undefined && event.base !== null
      );
      const fallbackBase = homeSideEvent?.base ?? anyEventWithBase?.base;
      lineBase = fallbackBase !== undefined && fallbackBase !== null ? fallbackBase : undefined;
    }

    // Convert selections
    const selections: MarketSelection[] = events
      .map((event) => ({
        name: getSelectionName(event, market, parsedTeams),
        odds: event.price || 0,
        externalId: String(event.id),
        status: "active" as const,
      }))
      .filter((sel) => sel.odds > 1);

    // Swarm omits the threshold from some market names — race markets
    // ("Rzuty rożne. Wyścig do  ") and bulk player "must start" O/U markets
    // ("Zawodnik. Liczba strzałów celnych (musi rozpocząć): Powyżej ") both
    // arrive with the trailing numeric line missing from the name string.
    // Recover it from the base field so the market label carries the real
    // threshold like peers ("... Wyścig do 5", "... Powyżej 0.5") instead of
    // truncating it away.
    let resolvedName = marketName;
    if (
      lineBase !== undefined &&
      /(?:wy[śs]cig\s+do|powy[żz]ej|poni[żz]ej)\s*$/i.test(marketName)
    ) {
      resolvedName = `${marketName.trimEnd()} ${lineBase}`;
    }

    // Renamed Swarm stats markets quote a whole "N+" ladder in one market
    // object. Split it per rung (team) or per player so every line/player
    // gets its own entry. The line comes from the tier, never from base, so
    // the name is the raw market name (resolvedName may append a base line).
    const ladderKind = getTierLadderKind(market.type);
    if (ladderKind && selections.length > 0) {
      markets.push(
        ...splitTierLadder(
          ladderKind,
          { name: marketName, bookmakerMarketId: market.type, groupName, type: marketType },
          selections
        )
      );
      continue;
    }

    // Split bulk multi-player markets into one synthetic entry per player so
    // each player gets their own market parameter downstream instead of all
    // of them merging into a single "base" bucket. The player's raw name is
    // carried via paramValue (never a numeric line for these market types),
    // and the single selection is normalized to the fixed marker this stat
    // family expects (see BULK_PLAYER_LIST_MARKET_SELECTION).
    const bulkSelectionMarker = BULK_PLAYER_LIST_MARKET_SELECTION[market.type];
    if (bulkSelectionMarker && selections.length > 0) {
      for (const sel of selections) {
        markets.push({
          name: resolvedName,
          bookmakerMarketId: market.type,
          groupName,
          type: marketType,
          paramValue: sel.name,
          selections: [{ name: bulkSelectionMarker, odds: sel.odds, externalId: sel.externalId, status: sel.status }],
        });
      }
      continue;
    }

    if (selections.length > 0) {
      markets.push({
        name: resolvedName,
        // Carry the stable Swarm market-type code (e.g. "P1XP2", "OverUnder")
        // so the normalization audit can match by id instead of brittle name regex.
        bookmakerMarketId: market.type,
        groupName,
        type: marketType,
        // Pre-extracted line value consumed by the betcris normalizer for
        // parameterized markets (totals/handicaps).
        ...(lineBase !== undefined ? { paramValue: String(lineBase) } : {}),
        selections,
      });
    }
  }

  return markets;
}

/**
 * Parse Swarm data for full offer scraping
 * Returns all matches with all their markets
 */
export function parseSwarmDataForFullOffer(
  data: SwarmData,
  league: string,
  competitionId: number
): Array<{
  game: SwarmGame;
  teams: ParsedTeams;
  regionAlias: string;
  competitionId: number;
}> {
  const results: Array<{
    game: SwarmGame;
    teams: ParsedTeams;
    regionAlias: string;
    competitionId: number;
  }> = [];

  for (const sport of Object.values(data.sport || {})) {
    if (sport.alias !== "Soccer") continue;

    for (const region of Object.values(sport.region || {})) {
      for (const competition of Object.values(region.competition || {})) {
        if (competition.id !== competitionId) continue;

        for (const game of Object.values(competition.game || {})) {
          if (game.is_blocked) continue;

          const teams = parseTeamNames(game);
          if (!teams.homeTeam || !teams.awayTeam) continue;

          results.push({
            game,
            teams,
            regionAlias: region.alias || "",
            competitionId: competition.id,
          });
        }
      }
    }
  }

  return results;
}
