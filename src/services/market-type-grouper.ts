/**
 * Market Type Grouper Service
 *
 * Groups normalized markets by type and aggregates parameters.
 * Converts flat list of markets (with different params) into organized structure.
 */

import type { FullMatchOffer, ScrapedMarket } from "../types/full-offer.js";
import type {
  MarketWithParams,
  MarketParameter,
  MarketParameterBookmaker,
  ComparableMarketGroup,
} from "../types/normalized-markets.js";
import {
  getMarketByCode,
  getCategoryForCode,
  marketHasParameters,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
} from "../data/market-catalog.js";
import { MarketCategory } from "../services/normalization/types.js";
import { canonicalizePlayerName } from "./normalization/helpers/index.js";

/**
 * viewTypes whose selection codes may be player names (order must be
 * unified). COMBINATION also covers multi-player combo markets (e.g.
 * TWO_PLAYERS_ANYTIME) alongside many non-player markets (score groups,
 * result+total combos, ...) — safe to include broadly because
 * canonicalizePlayerName() only rewrites a strict "Last, First" comma
 * pattern and passes any other selection code through unchanged.
 */
const PLAYER_SELECTION_VIEW_TYPES = new Set(["PLAYER_DROPDOWN", "PLAYER_STAT_LINES", "COMBINATION"]);

/**
 * Default parameters for each market type
 */
const DEFAULT_PARAMETERS: Record<string, string> = {
  ASIAN_HANDICAP: "0",
  EUROPEAN_HANDICAP: "-1",
  TOTAL_GOALS: "2.5",
  TOTAL_GOALS_ASIAN: "2.0",
  CORNERS_TOTAL: "8.5",
  CARDS_TOTAL: "4.5",
  // Round 8 P5: prefer the middle, most-liquid race-to-N line as the default
  // tab instead of whichever line sorts first ("3"). Cosmetic only — every
  // line is still fully priced and comparable, this only changes which
  // parameter the frontend selects by default.
  CORNERS_RACE_TO: "5",
  HALF_TIME_TOTAL_GOALS: "1.5",
  CORRECT_SCORE: "1:1",
};

/**
 * Canonicalize a numeric parameter value so equivalent spellings collapse
 * into one line ("1.0" -> "1", "+0.5" -> "0.5", "2.50" -> "2.5").
 * Non-numeric values (score formats "1:0", "base", team sides) pass through.
 */
function canonicalizeParamValue(param: string): string {
  if (/^[+-]?\d+(\.\d+)?$/.test(param)) {
    return String(parseFloat(param));
  }
  // Side-scoped lines ("HOME:7.0") must fold onto the same bucket as "HOME:7";
  // LVBet quotes integers with a trailing .0 while Betcris quotes them bare.
  const sided = param.match(/^(HOME|AWAY):([+-]?\d+(?:\.\d+)?)$/);
  if (sided) return `${sided[1]}:${String(parseFloat(sided[2]))}`;
  return param;
}

/**
 * Recovers a market whose normalizer bundled multiple parameter lines'
 * selections into one entry (paramValue unset) by extracting the line number
 * embedded in each selection's raw label and splitting into one synthetic
 * market per line. Returns null when the selections don't confidently encode
 * 2+ distinct lines — callers then fall back to the normal (and stricter)
 * base-bucket handling, so a genuine single-number misroute still gets
 * dropped rather than mistaken for a bundle.
 */
function splitBundledLineSelections(market: ScrapedMarket): ScrapedMarket[] | null {
  const byLine = new Map<string, typeof market.selections>();
  for (const sel of market.selections) {
    const m = sel.name.match(/(\d+)[.,](\d+)/);
    if (!m) return null;
    const line = `${m[1]}.${m[2]}`;
    if (!byLine.has(line)) byLine.set(line, []);
    byLine.get(line)!.push(sel);
  }
  if (byLine.size <= 1) return null;
  return Array.from(byLine.entries()).map(([line, selections]) => ({
    ...market,
    paramValue: line,
    selections,
  }));
}

/** A selection label that looks like a person's name rather than a bet-outcome code. */
function looksLikePlayerName(label: string): boolean {
  if (/,\s*[\p{L}]/u.test(label)) return true; // "Lastname, Firstname"
  return /^[\p{L}][\p{L}'’.\-]*\s+[\p{L}][\p{L}'’.\-]*(\s+[\p{L}][\p{L}'’.\-]*)*$/u.test(label);
}

/**
 * A raw market name the scraper never resolved past its bare bookmaker id
 * ("Rynek 72", "Market 500") — an unconfirmed market identity, as opposed to
 * a name the bookmaker actually publishes.
 */
function isPlaceholderMarketName(name: string | undefined): boolean {
  return !name || /^(rynek|market)\s*\d+\b/i.test(name.trim());
}

/**
 * Reconciles the player-name variants a single market collects from different
 * bookmakers. Even after canonicalizePlayerName (order + accents), the same
 * footballer still arrives in shapes that cannot be normalized in isolation —
 * only by looking at every name the market received:
 *
 *   "Amenda Aurele"  (sts sends "Surname Firstname" without a comma)
 *   "M Grimes"       (fuksiarz abbreviates the first name)
 *   "Victor Torp"    (betfan/superbet drop the second surname)
 *
 * Each of these was rendering as its own dropdown row next to the full name,
 * splitting one player's odds across two entries and hiding best-odds
 * (/audit-match, Arsenal vs Coventry City). A variant is folded into another
 * name only when the target is UNAMBIGUOUS; ties and multi-candidate matches
 * are left alone. The surviving spelling is the one more bookmakers use, so
 * the majority form wins and the result is deterministic.
 */
export function reconcilePlayerNameVariants(bookmakersByName: Map<string, Set<string>>): Map<string, string> {
  const alias = new Map<string, string>();
  const names = [...bookmakersByName.keys()].filter((n) => n !== "base");
  if (names.length < 2) return alias;

  const tokensOf = (name: string): string[] => name.toLowerCase().split(/\s+/).filter(Boolean);
  const weight = (name: string): number => bookmakersByName.get(name)?.size ?? 0;
  /** More bookmakers wins; ties break on the longer, then lexicographically smaller name. */
  const preferred = (a: string, b: string): string => {
    if (weight(a) !== weight(b)) return weight(a) > weight(b) ? a : b;
    const ta = tokensOf(a).length;
    const tb = tokensOf(b).length;
    if (ta !== tb) return ta > tb ? a : b;
    return a.localeCompare(b) <= 0 ? a : b;
  };

  const byTokens = new Map<string, string[]>();
  for (const name of names) {
    const key = [...tokensOf(name)].sort().join(" ");
    (byTokens.get(key) ?? byTokens.set(key, []).get(key)!).push(name);
  }

  // 1. Same tokens in a different order ("Amenda Aurele" vs "Aurele Amenda").
  for (const variants of byTokens.values()) {
    if (variants.length < 2) continue;
    const winner = variants.reduce(preferred);
    for (const v of variants) if (v !== winner) alias.set(v, winner);
  }

  const resolve = (name: string): string => alias.get(name) ?? name;

  /**
   * Two spellings describe the same player when the surname matches, the first
   * names match (or one is the other's initial) and every remaining token of
   * the shorter spelling also appears, in order, in the longer one. That single
   * rule covers all the shapes the audit found: "M Grimes" / "Matt Grimes",
   * "Victor Torp" / "Victor Torp Overgaard", "Caleb Yirenkyi" /
   * "Caleb Marfo Yirenkyi" and the combination "C Marfo Yirenkyi" /
   * "Caleb Yirenkyi".
   */
  const sameFirstName = (a: string, b: string): boolean => {
    if (a === b) return true;
    const aInitial = a.replace(".", "");
    const bInitial = b.replace(".", "");
    if (aInitial.length === 1) return b.startsWith(aInitial);
    if (bInitial.length === 1) return a.startsWith(bInitial);
    return false;
  };
  const isSubsequence = (shorter: string[], longer: string[]): boolean => {
    let i = 0;
    for (const token of longer) if (i < shorter.length && token === shorter[i]) i++;
    return i === shorter.length;
  };
  const describeSamePlayer = (a: string[], b: string[]): boolean => {
    if (a.length < 2 || b.length < 2) return false;
    if (!sameFirstName(a[0], b[0])) return false;
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    // A dropped trailing surname ("Victor Torp" / "Victor Torp Overgaard").
    if (
      longer.length > shorter.length &&
      shorter.slice(1).join(" ") === longer.slice(1, shorter.length).join(" ")
    ) {
      return true;
    }
    // Same surname with an optional middle name dropped in one spelling.
    if (a[a.length - 1] !== b[b.length - 1]) return false;
    return isSubsequence(shorter.slice(1, -1), longer.slice(1, -1));
  };

  // 2. Abbreviated first names, dropped middle names and dropped second
  //    surnames. Variants are clustered and a cluster is folded only when it
  //    is a CLIQUE — every member compatible with every other. That merges
  //    "V Torp" / "Victor Torp" / "Victor Torp Overgaard" in one go while
  //    refusing to bridge two different players through a shared abbreviation
  //    ("J Silva" fits both "Joao Silva" and "Jorge Silva", which do not fit
  //    each other, so nothing is merged).
  const canonicalNames = names.filter((n) => !alias.has(n));
  const tokenCache = new Map(canonicalNames.map((n) => [n, tokensOf(n)]));
  const compatible = (a: string, b: string): boolean =>
    describeSamePlayer(tokenCache.get(a)!, tokenCache.get(b)!);

  const clusterOf = new Map<string, string[]>();
  const visited = new Set<string>();
  for (const name of canonicalNames) {
    if (visited.has(name)) continue;
    const cluster = [name];
    visited.add(name);
    const queue = [name];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const other of canonicalNames) {
        if (visited.has(other) || !compatible(current, other)) continue;
        visited.add(other);
        cluster.push(other);
        queue.push(other);
      }
    }
    if (cluster.length > 1) clusterOf.set(name, cluster);
  }

  for (const cluster of clusterOf.values()) {
    const isClique = cluster.every((a) =>
      cluster.every((b) => a === b || compatible(a, b)),
    );
    if (!isClique) continue;
    const winner = cluster.reduce(preferred);
    for (const member of cluster) {
      if (member !== winner && !alias.has(member)) alias.set(member, winner);
    }
  }

  // A fold may point at a name that was itself folded — collapse the chain.
  for (const [from, to] of alias) {
    let target = to;
    const seen = new Set([from]);
    while (alias.has(target) && !seen.has(target)) {
      seen.add(target);
      target = alias.get(target)!;
    }
    alias.set(from, target);
  }

  return alias;
}

/**
 * Recovers a player-parameterized market whose normalizer listed every
 * player as a SELECTION in one raw entry (paramValue unset) instead of the
 * usual one-row-per-player shape — e.g. lvbet's "Zawodnik zanotuje asystę"
 * carries 40+ players as selections with no paramValue, so it collapses into
 * the shared "base" bucket and strands its odds away from peers' per-player
 * rows. Splits into one synthetic market per player, keyed by canonicalized
 * name. The selection code itself is a best-effort default (the catalog's
 * first declared code, e.g. "YES") since a bare flat odds number carries no
 * further signal on which tier it represents — recovering the player
 * identity and odds is the priority; callers needing an exact tier should
 * fix the bookmaker's normalizer directly. Returns null when selections
 * don't confidently look like a name list, or no fallback code exists.
 */
function splitBundledPlayerSelections(
  market: ScrapedMarket,
  fallbackSelectionCode: string | undefined,
): ScrapedMarket[] | null {
  if (market.selections.length < 2 || !fallbackSelectionCode) return null;
  // A bookmaker's catch-all "no scorer" outcome (normalized to the catalog
  // sentinel "NONE") is a real, quotable price that cannot collide with any
  // player — tolerate it inside an otherwise player-shaped selection list
  // instead of letting one non-name selection veto the whole split. Fuksiarz
  // quotes "No GoalScorer" -> NONE alongside 44 player names in
  // GOALSCORER_FIRST; before this, that single NONE entry made every
  // selection in the market fail looksLikePlayerName, so all 45 prices fell
  // through to the shared "base"/misparsed-numeric bucket instead of one row
  // per player (/audit-match Arsenal vs Coventry City, round 8
  // P3-grouper-split-tolerate-none-selection).
  const isCatchAll = (code: string): boolean => code === "NONE";
  let nameLike = 0;
  for (const sel of market.selections) {
    const code = sel.normalizedName || sel.name;
    if (isCatchAll(code)) continue;
    if (!looksLikePlayerName(code)) return null;
    nameLike++;
  }
  // Require a real name list, not a lone catch-all masquerading as one.
  if (nameLike < 2) return null;
  return market.selections.map((sel) => {
    const code = sel.normalizedName || sel.name;
    return {
      ...market,
      paramValue: isCatchAll(code) ? "NONE" : canonicalizePlayerName(code),
      selections: [{ name: sel.name, normalizedName: fallbackSelectionCode as ScrapedMarket["selections"][number]["normalizedName"], odds: sel.odds }],
    };
  });
}

// ============================================================================
// Odds quarantine (SPEC.md §5 — product safety net)
// ============================================================================

/** Minimum number of positive quotes in a (param, selectionType) pool before quarantine checks run. */
const QUARANTINE_MIN_POOL_SIZE = 4;
/** Odds at or above this value are treated as placeholder artifacts (e.g. betcris 1501). */
const QUARANTINE_PLACEHOLDER_ODDS = 1000;
/** Relative deviation from the pool median (> 400%) required for the decimal-shift check. */
const QUARANTINE_DEVIATION_RATIO = 4;
/** The /10 or /100 corrected value must land within ±15% of the pool median. */
const QUARANTINE_SHIFT_TOLERANCE = 0.15;

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function withinShiftTolerance(value: number, target: number): boolean {
  return target > 0 && Math.abs(value - target) <= QUARANTINE_SHIFT_TOLERANCE * target;
}

/**
 * Product safety net (SPEC.md §5): after aggregation, mark obviously broken
 * quotes with `suspect: true` so the frontend never surfaces them as best
 * odds. Runs per (parameter, selectionType) pool with >= 4 positive quotes:
 * - odds >= 1000 → placeholder artifact → suspect;
 * - odds deviating > 400% from the pool median while odds/10 or odds/100
 *   lands within ±15% of the median → decimal shift → suspect.
 * Suspect quotes are NOT dropped — audit tooling must still see raw values.
 */
function markSuspectOdds(parameters: MarketParameter[]): void {
  for (const parameter of parameters) {
    // Pool quotes across bookmakers per selection type
    const pools = new Map<string, MarketParameterBookmaker["selections"]>();
    for (const bmEntry of parameter.bookmakers) {
      for (const sel of bmEntry.selections) {
        if (!(sel.odds > 0)) continue;
        let pool = pools.get(sel.type);
        if (!pool) {
          pool = [];
          pools.set(sel.type, pool);
        }
        pool.push(sel);
      }
    }

    for (const pool of pools.values()) {
      if (pool.length < QUARANTINE_MIN_POOL_SIZE) continue;
      const median = medianOf(pool.map((sel) => sel.odds));

      for (const sel of pool) {
        if (sel.odds >= QUARANTINE_PLACEHOLDER_ODDS) {
          sel.suspect = true;
          continue;
        }
        if (median <= 0) continue;
        const deviation = Math.abs(sel.odds - median) / median;
        if (
          deviation > QUARANTINE_DEVIATION_RATIO &&
          (withinShiftTolerance(sel.odds / 10, median) ||
            withinShiftTolerance(sel.odds / 100, median))
        ) {
          sel.suspect = true;
        }
      }
    }
  }
}

/**
 * Sort parameters intelligently
 */
function sortParameters(params: string[]): string[] {
  // Separate numeric and non-numeric params
  const numericParams: { value: number; original: string }[] = [];
  const specialParams: string[] = [];

  for (const param of params) {
    const num = parseFloat(param);
    if (!isNaN(num)) {
      numericParams.push({ value: num, original: param });
    } else {
      specialParams.push(param);
    }
  }

  // Sort numeric parameters
  numericParams.sort((a, b) => a.value - b.value);

  return [
    ...numericParams.map((p) => p.original),
    ...specialParams.sort(),
  ];
}

/**
 * Format a handicap line value for display (e.g. "-0.5", "+0.5", "-2").
 * Always includes explicit +/- sign.
 */
function formatHandicapLine(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

/**
 * Detect if a market uses the handicap line convention (paramValue = home's signed line).
 */
function isLineBasedHandicap(marketType: string): boolean {
  if (!marketType.includes("HANDICAP")) return false;
  // CORRECT_SCORE_HANDICAP or similar score-format handicaps are excluded
  return true;
}

/**
 * Get display label for a parameter
 */
function getParameterLabel(param: string, marketType: string): string {
  if (param === "base") return "";

  const marketDef = getMarketByCode(marketType);

  // Handicap markets: paramValue is the home team's signed line.
  // Render as "Gospodarze (-0.5) / Goście (+0.5)" so the 2-part perspective is visible on the tab.
  if (isLineBasedHandicap(marketType) && !param.includes(":")) {
    const line = parseFloat(param);
    if (!isNaN(line)) {
      const homeLine = formatHandicapLine(line);
      const awayLine = formatHandicapLine(-line);
      return `Gospodarze (${homeLine}) / Goście (${awayLine})`;
    }
  }

  // Side-scoped stat lines ("HOME:7.5") are user-facing chips; render the side in Polish.
  const sided = param.match(/^(HOME|AWAY):(.+)$/);
  if (sided) return `${sided[1] === "HOME" ? "Gospodarze" : "Goście"} ${sided[2]}`;

  // For team-parameterized markets (HOME/AWAY), translate to Polish
  if (marketDef?.parameterType === "team") {
    if (param === "HOME") return "Gospodarze";
    if (param === "AWAY") return "Goście";
  }

  // Player-parameterized markets: "NONE" is the catch-all "no scorer" row
  // (see splitBundledPlayerSelections' isCatchAll) — show its Polish label
  // instead of the raw catalog sentinel.
  if (marketDef?.parameterType === "player" && param === "NONE") {
    return "Brak strzelca";
  }

  // For Asian total goals, format as integer (1 instead of 1.0)
  if (marketType === "TOTAL_GOALS_ASIAN") {
    const num = parseFloat(param);
    if (!isNaN(num) && Number.isInteger(num)) {
      return num.toString();
    }
  }

  return param;
}

/**
 * Group markets by type and aggregate parameters
 *
 * Input: Array of markets with bookmakers (e.g., multiple ASIAN_HANDICAP markets with different lines)
 * Output: Array of MarketWithParams (one per type, with all parameters)
 */
export function groupMarketsByTypeWithParameters(
  marketsWithBookmakers: Array<{ market: ScrapedMarket; bookmaker: string }>
): MarketWithParams[] {
  // Some bookmaker normalizers can only emit ONE market per raw entry, so a
  // raw market that bundles several parameter lines together (the line lives
  // only inside each selection's raw label, e.g. "Team & Powyżej 2,5") comes
  // through with paramValue unset and every line's selections mixed as one.
  // Recover it into per-line entries here — before the base-bucket drop below
  // would otherwise discard the whole thing as an apparent misroute.
  const expandedInput = marketsWithBookmakers.flatMap((entry) => {
    const marketType = entry.market.normalizedType || "OTHER";
    const catalogEntry = getMarketByCode(marketType);
    // Gate on hasParameter like the later canonicalization step (below) does —
    // some catalog entries carry a stray parameterType even though
    // hasParameter is false (e.g. BOTH_PLAYERS_ANYTIME/TWO_PLAYERS_ANYTIME:
    // the pair IS the selection, not a parameter). Without this gate,
    // splitBundledPlayerSelections fires whenever a bookmaker's raw pair
    // label happens to look name-shaped (looksLikePlayerName), overwriting
    // the real pair identity with the catalog's generic fallback code.
    const parameterType = catalogEntry?.hasParameter ? catalogEntry.parameterType : undefined;
    if (entry.market.paramValue) {
      // Player-parameterized markets: some bookmakers (Fortuna) emit one
      // market per player, so paramValue is already set to the player name
      // AND the selection code repeats that same player name instead of the
      // catalog's generic code ("PLAYER_NAME"/"PLAYER"). Peers reach the
      // catalog code through splitBundledPlayerSelections below, which only
      // runs when paramValue is unset — leaving the name-shaped selection
      // code intact here splits the market vocabulary and strands that
      // bookmaker's column in the comparison table (/audit-match Arsenal vs
      // Coventry City, round 8 P1-grouper-canonicalize-player-selection).
      const fallbackCode = catalogEntry?.selections?.[0];
      if (parameterType === "player" && fallbackCode) {
        const paramPlayer = canonicalizePlayerName(entry.market.paramValue);
        const selections = entry.market.selections.map((sel) => {
          const code = sel.normalizedName || sel.name;
          return canonicalizePlayerName(code) === paramPlayer
            ? { ...sel, normalizedName: fallbackCode as ScrapedMarket["selections"][number]["normalizedName"] }
            : sel;
        });
        return [{ ...entry, market: { ...entry.market, selections } }];
      }
      return [entry];
    }
    if (parameterType === "decimal") {
      const split = splitBundledLineSelections(entry.market);
      if (split) return split.map((market) => ({ market, bookmaker: entry.bookmaker }));
    } else if (parameterType === "player") {
      const fallbackCode = catalogEntry?.selections?.[0];
      const split = splitBundledPlayerSelections(entry.market, fallbackCode);
      if (split) return split.map((market) => ({ market, bookmaker: entry.bookmaker }));
    }
    return [entry];
  });

  // Group by market type (without parameter)
  const typeGroups = new Map<string, {
    marketType: string;
    category: MarketCategory;
    label: string;
    markets: Array<{ market: ScrapedMarket; bookmaker: string; param: string }>;
  }>();

  for (const { market, bookmaker } of expandedInput) {
    const marketType = market.normalizedType || "OTHER";
    const entryDef = getMarketByCode(marketType);
    const parameterType = entryDef?.hasParameter ? entryDef.parameterType : undefined;
    let param = canonicalizeParamValue(market.paramValue || "base");

    // Player-scoped markets key their parameter by player name; unify the
    // name order so the same player merges across bookmakers.
    if (parameterType === "player" && param !== "base") {
      param = canonicalizePlayerName(param);
    }

    // Line/team-parameterized markets must not accumulate a "base" bucket: an
    // entry with no extractable parameter there is almost always a misrouted
    // market or a stale row keyed under an old market_key. Player markets are
    // exempt — the player identity may live in the selection instead.
    if (param === "base" && (parameterType === "decimal" || parameterType === "team")) {
      continue;
    }

    // On numeric-line markets, reject params that are neither a number nor a
    // side-scoped line ("HOME:5.5"): bare side tokens or score notation mean
    // the line failed to parse upstream and would render as a garbage chip.
    if (
      parameterType === "decimal" &&
      param !== "base" &&
      !/^[+-]?\d+(\.\d+)?$/.test(param) &&
      !/^(HOME|AWAY):[+-]?\d+(\.\d+)?$/.test(param)
    ) {
      continue;
    }

    // Vocabulary guard: on PARAMETER_SLIDER markets the catalog declares a
    // fixed, closed selection vocabulary (typically OVER/UNDER). Reject an
    // entry whose raw selections share NO code with that vocabulary at all —
    // a bookmaker can route an unrelated product onto the same normalized
    // code. Fuksiarz's "Arsenal - liczba goli" quotes three mutually
    // exclusive interval buckets (0-1/2-3/4+) that land on
    // HOME_TEAM_TOTAL_GOALS (catalog vocab OVER/UNDER only) at a phantom
    // param "0" (/audit-match Arsenal vs Coventry City, round 8
    // P1-grouper-vocab-gate). None of that entry's outcomes belong to this
    // market, so drop the whole entry rather than let a garbage parameter
    // row through. `.some` (not `.every`) is deliberate: an entry with even
    // one recognized code must still get through untouched.
    if (
      entryDef?.viewType === "PARAMETER_SLIDER" &&
      entryDef.selections.length > 0 &&
      market.selections.length > 0 &&
      !market.selections.some((sel) => entryDef.selections.includes(sel.normalizedName || sel.name))
    ) {
      continue;
    }

    if (!typeGroups.has(marketType)) {
      typeGroups.set(marketType, {
        marketType,
        category: getCategoryForCode(marketType),
        label: getMarketByCode(marketType)?.labels?.pl || market.name || marketType,
        markets: [],
      });
    }

    typeGroups.get(marketType)!.markets.push({ market, bookmaker, param });
  }

  // Build MarketWithParams for each type
  const result: MarketWithParams[] = [];

  for (const [marketType, group] of typeGroups.entries()) {
    // Group by parameter
    const paramGroups = new Map<string, MarketParameter>();
    const handicapMarket = isLineBasedHandicap(marketType);

    // Computed once per market type and reused both by the rawMarketName-
    // collision overlap check below and by the selection-code canonicalization
    // loop further down, so a player's selection code is compared on the same
    // normalized basis in both places.
    const isPlayerSelectionMarket = PLAYER_SELECTION_VIEW_TYPES.has(
      String(getMarketByCode(marketType)?.viewType ?? ""),
    );

    // Player-keyed markets: fold the spelling variants of one footballer into
    // a single parameter before grouping, using the whole market's name set.
    const isPlayerParam =
      getMarketByCode(marketType)?.hasParameter &&
      getMarketByCode(marketType)?.parameterType === "player";
    let playerAlias = new Map<string, string>();
    if (isPlayerParam) {
      const bookmakersByName = new Map<string, Set<string>>();
      for (const { bookmaker, param } of group.markets) {
        if (param === "base") continue;
        const set = bookmakersByName.get(param) ?? new Set<string>();
        set.add(bookmaker);
        bookmakersByName.set(param, set);
      }
      playerAlias = reconcilePlayerNameVariants(bookmakersByName);
    }

    for (const { market, bookmaker, param } of group.markets) {
      const paramKey = playerAlias.get(param) ?? param;

      if (!paramGroups.has(paramKey)) {
        paramGroups.set(paramKey, {
          value: paramKey,
          label: getParameterLabel(paramKey, marketType),
          bookmakers: [],
        });
      }

      // Add bookmaker selections for this parameter
      const paramEntry = paramGroups.get(paramKey)!;

      // Find or create bookmaker entry
      let bmEntry = paramEntry.bookmakers.find((bm) => bm.bookmaker === bookmaker);
      if (!bmEntry) {
        bmEntry = {
          bookmaker,
          bookmakerName: bookmaker,
          rawMarketName: market.name,
          selections: [],
        };
        paramEntry.bookmakers.push(bmEntry);
      } else if (bmEntry.rawMarketName !== market.name) {
        // A DIFFERENT raw market collided on (type, param, bookmaker). Two
        // shapes exist. (1) Both describe the SAME outcomes — a misrouted
        // normalization; merging would poison odds, so exactly one must win.
        // (2) They describe DISJOINT, side-scoped outcomes of ONE catalog
        // market: fuksiarz sends "1. połowa - Arsenal - liczba goli" as
        // HOME_OVER/HOME_UNDER and "... - Coventry - ..." as AWAY_OVER/
        // AWAY_UNDER on the same line, and the blanket skip below dropped
        // every home-side line (/audit-match Arsenal vs Coventry). Only
        // overlapping selection codes can poison anything. Player-keyed
        // selection codes must go through the same canonicalizePlayerName
        // transform as bmEntry.selections[].type below (governed by
        // isPlayerSelectionMarket) - otherwise "Jashari, Ardon" vs "Ardon
        // Jashari" would compare unequal here and a true collision on the
        // same player could slip through as a false "disjoint" verdict.
        const incomingCodes = new Set(
          market.selections.map((sel) => {
            const code = sel.normalizedName || sel.name;
            return isPlayerSelectionMarket ? canonicalizePlayerName(code) : code;
          }),
        );
        if (bmEntry.selections.some((sel) => incomingCodes.has(sel.type))) {
          // Case (1): arrival order is arbitrary and has picked the wrong
          // side before (pzbuk id 72 "Rynek 72" sat ahead of the genuine id
          // 33 "Wynik meczu i obie drużyny strzelą" and evicted it from
          // RESULT_AND_BTTS, round 8 grouper-prefer-named-market-on-
          // collision). A raw name the scraper could not resolve past the
          // "Rynek <id>"/"Market <id>" placeholder is an unconfirmed market
          // identity, so a REAL name always beats a placeholder; only when
          // both sides are equally (un)named does the first arrival keep the
          // slot.
          const incumbentIsPlaceholder = isPlaceholderMarketName(bmEntry.rawMarketName);
          const challengerIsPlaceholder = isPlaceholderMarketName(market.name);
          if (incumbentIsPlaceholder && !challengerIsPlaceholder) {
            bmEntry.rawMarketName = market.name;
            bmEntry.selections = [];
          } else {
            continue;
          }
        }
      }

      // Create a map to track existing selections by type to prevent duplicates
      const existingSelections = new Map<string, { type: string; odds: number; hasNoTaxPromo?: boolean; label?: string }>();
      for (const sel of bmEntry.selections) {
        existingSelections.set(sel.type, sel);
      }

      // For handicap markets, compute per-team+line labels so each outcome is self-describing
      const homeLine = handicapMarket ? parseFloat(paramKey) : NaN;
      const buildSelectionLabel = (selType: string): string | undefined => {
        if (!handicapMarket || isNaN(homeLine)) return undefined;
        if (selType === "HOME") return `Gospodarze (${formatHandicapLine(homeLine)})`;
        if (selType === "AWAY") return `Goście (${formatHandicapLine(-homeLine)})`;
        // Draw in 3-way handicap: anchor the line to the home perspective so the reader can tell
        // the exact goal-difference the draw bet covers (matches Betclic's own "Remis (Chelsea -2)" wording).
        if (selType === "DRAW") return `Remis (Gospodarze ${formatHandicapLine(homeLine)})`;
        return undefined;
      };

      // Add or update selections from this market (isPlayerSelectionMarket
      // computed once above, reused here).
      for (const selection of market.selections) {
        let selectionType = selection.normalizedName || selection.name;
        // Unify player-name order so the same player merges across bookmakers
        // ("Jashari, Ardon" vs "Ardon Jashari" stranded odds in duplicates).
        if (isPlayerSelectionMarket) {
          selectionType = canonicalizePlayerName(selectionType);
        }

        // Check if this selection type already exists
        if (existingSelections.has(selectionType)) {
          // Duplicate selection type within the same raw market — keep the
          // first quote. Overwriting with the higher odds silently mixed
          // prices of different outcomes that mapped to one code.
        } else {
          // Add new selection
          const label = buildSelectionLabel(selectionType);
          bmEntry.selections.push({
            type: selectionType,
            odds: selection.odds,
            hasNoTaxPromo: false, // TODO: Detect no-tax promotions
            ...(label ? { label } : {}),
          });
          existingSelections.set(selectionType, bmEntry.selections[bmEntry.selections.length - 1]);
        }
      }
    }

    const allParams = Array.from(paramGroups.keys());
    const sortedParams = sortParameters(allParams);

    // Build parameters array in sorted order
    const parameters: MarketParameter[] = sortedParams.map((param) => paramGroups.get(param)!);

    let hasParameters = marketHasParameters(marketType) && sortedParams.length >= 1;

    // Handle non-parameterized markets that need parameters[0] for frontend components
    // This includes: SINGLE_SELECTION, BINARY_BUTTONS, TRIPLE_BUTTONS, PARAMETER_SLIDER, and any market without hasParameter: true
    if (!hasParameters) {
      const marketDef = getMarketByCode(marketType);
      const needsParametersStructure =
        marketDef?.viewType === "SINGLE_SELECTION" ||
        marketDef?.viewType === "BINARY_BUTTONS" ||
        marketDef?.viewType === "TRIPLE_BUTTONS" ||
        marketDef?.viewType === "PARAMETER_SLIDER" ||
        marketDef?.viewType === "COMBINATION";

      if (needsParametersStructure) {
        const bookmakersMap = new Map<string, { rawMarketName?: string; selections: { type: string; odds: number }[] }>();

        for (const [_, paramEntry] of paramGroups.entries()) {
          for (const bmEntry of paramEntry.bookmakers) {
            if (!bookmakersMap.has(bmEntry.bookmaker)) {
              bookmakersMap.set(bmEntry.bookmaker, { rawMarketName: bmEntry.rawMarketName, selections: [] });
            }

            const bmData = bookmakersMap.get(bmEntry.bookmaker)!;

            if (marketDef?.viewType === "BINARY_BUTTONS" || marketDef?.viewType === "TRIPLE_BUTTONS" || marketDef?.viewType === "PARAMETER_SLIDER" || marketDef?.viewType === "COMBINATION") {
              for (const selection of bmEntry.selections) {
                bmData.selections.push({
                  type: selection.type,
                  odds: selection.odds,
                });
              }
            } else if (marketDef?.viewType === "SINGLE_SELECTION") {
              // Audit r7 (Arsenal vs Coventry City): SINGLE_SELECTION was
              // written assuming every market of this viewType is a plain
              // "yes, this happens" bet — true for BTTS_PENALTY-style codes,
              // but later additions (FIRST_GOAL_TIME_30MIN, FIRST_GOAL_METHOD,
              // AWAY_FIRST_GOAL_TIME, TOTAL_GOALS_OVER_LINES,
              // TOTAL_GOALS_MINIMUM) carry a real multi-value ladder with no
              // numeric parameter. Hard-coding "keep only YES" silently
              // zeroed out every selection for those five codes across every
              // bookmaker — the market reached the API with prices and no
              // outcome. Keep whatever the catalog actually declares for
              // this code instead of assuming YES.
              const declared = new Set(marketDef?.selections ?? ["YES"]);
              for (const selection of bmEntry.selections) {
                if (!declared.has(selection.type)) continue;
                bmData.selections.push({
                  type: selection.type,
                  odds: selection.odds,
                });
              }
            } else {
              const yesSelection = bmEntry.selections.find((s) => s.type === "YES");
              if (yesSelection) {
                bmData.selections.push({
                  type: "YES",
                  odds: yesSelection.odds,
                });
              }
            }
          }
        }

        const parameterBookmakers: MarketParameterBookmaker[] = Array.from(bookmakersMap.entries()).map(([bookmaker, data]) => ({
          bookmaker,
          bookmakerName: bookmaker,
          rawMarketName: data.rawMarketName,
          selections: data.selections,
        }));

        // Collapse ALL raw param-group buckets into exactly ONE dummy
        // parameter. A stray non-"base" paramValue from a single bookmaker
        // (the catalog says this market has no real parameter) would
        // otherwise survive as parameters[1+], a phantom duplicate bucket
        // alongside the intended single empty-value/empty-label entry.
        parameters.length = 0;
        parameters.push({
          value: "",
          label: "",
          bookmakers: parameterBookmakers,
        });

        // Set hasParameters to true so frontend gets data
        hasParameters = true;
      }
    }

    // Get default parameter
    const isNonParameterized = !marketHasParameters(marketType);
    const defaultParam = DEFAULT_PARAMETERS[marketType];
    const useDefault = isNonParameterized ? "" : (defaultParam && sortedParams.includes(defaultParam) ? defaultParam : sortedParams[0]);

    // Odds quarantine: flag placeholder / decimal-shifted quotes AFTER all
    // aggregation (incl. the dummy-parameter collapse above) so pools reflect
    // exactly what the API ships.
    markSuspectOdds(parameters);

    // Get description, displayOrder, and viewType from market registry
    const marketDef = getMarketByCode(marketType);
    const description = marketDef?.descriptions?.pl;
    const displayOrder = marketDef?.displayOrder ?? 999;
    const viewType = marketDef?.viewType;
    const subCategory = marketDef?.subCategory;

    result.push({
      marketKey: marketType,
      type: marketType,
      category: group.category,
      subCategory,
      label: group.label,
      description,
      displayOrder,
      viewType,
      parameters,
      defaultParameter: useDefault,
      hasParameters,
    });
  }

  return result;
}

/**
 * Convert marketsWithBookmakers to category structure with type grouping
 */
export function buildCategoriesWithMarketTypes(
  marketsWithBookmakers: Array<{ market: ScrapedMarket; bookmaker: string }>
): Array<{
  name: MarketCategory;
  label: string;
  order: number;
  markets: MarketWithParams[];
}> {
  // Group by market type with parameters
  const marketsByType = groupMarketsByTypeWithParameters(marketsWithBookmakers);

  // Group by category
  const categoryMap = new Map<MarketCategory, MarketWithParams[]>();

  for (const category of CATEGORY_ORDER) {
    categoryMap.set(category as MarketCategory, []);
  }

  for (const market of marketsByType) {
    const category = market.category || MarketCategory.INNE;
    categoryMap.get(category)?.push(market);
  }

  // Build category structure with sorted markets
  const categories: Array<{
    name: MarketCategory;
    label: string;
    order: number;
    markets: MarketWithParams[];
  }> = [];

  for (let i = 0; i < CATEGORY_ORDER.length; i++) {
    const categoryName = CATEGORY_ORDER[i] as MarketCategory;
    const markets = categoryMap.get(categoryName) || [];

    // Sort markets by displayOrder within each category
    markets.sort((a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999));

    categories.push({
      name: categoryName,
      label: CATEGORY_LABELS[categoryName],
      order: i,
      markets,
    });
  }

  return categories;
}
