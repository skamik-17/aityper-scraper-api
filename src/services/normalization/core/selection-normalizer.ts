/**
 * Selection Normalizer
 *
 * Normalizes selection names to canonical values.
 * Uses context-aware logic for different market types.
 */

import type {
  MarketDefinition,
  NormalizedSelection,
  NormalizedSelectionResult,
} from "../types.js";

// ============================================================================
// Selection Patterns (common across all markets)
// ============================================================================

const COMMON_SELECTION_PATTERNS: Array<{
  pattern: RegExp;
  normalized: NormalizedSelection;
}> = [
  // Over/Under - must check before other patterns
  { pattern: /^(over|powyżej|powyzej|ponad|pow)\b/iu, normalized: "OVER" as NormalizedSelection },
  { pattern: /^(under|poniżej|ponizej|pon)\b/iu, normalized: "UNDER" as NormalizedSelection },

  // Yes/No - must check before team names
  { pattern: /^(yes|tak|si|ja|sí|oui|gg|gol)$/iu, normalized: "YES" as NormalizedSelection },
  { pattern: /^(no|nie|nein|non|ng|n[ao]o|brak)$/iu, normalized: "NO" as NormalizedSelection },

  // 1X2 outcomes
  { pattern: /^(1|home|gospodarz|dom|heim|casa|w1)$/iu, normalized: "HOME" as NormalizedSelection },
  { pattern: /^(x|draw|remis|empate|nul|unentschieden|pareggio|tie)$/iu, normalized: "DRAW" as NormalizedSelection },
  { pattern: /^(2|away|gość|gosc|auswärts|fuera|ospite|w2)$/iu, normalized: "AWAY" as NormalizedSelection },

  // Double Chance
  { pattern: /^(1x|10|1\s*lub\s*x)$/iu, normalized: "HOME_OR_DRAW" as NormalizedSelection },
  { pattern: /^(x2|02|x\s*lub\s*2)$/iu, normalized: "DRAW_OR_AWAY" as NormalizedSelection },
  { pattern: /^(12|1\s*lub\s*2)$/iu, normalized: "HOME_OR_AWAY" as NormalizedSelection },

  // Odd/Even
  { pattern: /^(odd|nieparzyste?|impar|ungerade|dispari)/iu, normalized: "ODD" as NormalizedSelection },
  { pattern: /^(even|parzyste?|par|gerade|pari)/iu, normalized: "EVEN" as NormalizedSelection },
];

// ============================================================================
// Main Function
// ============================================================================

/**
 * Normalize a selection name to canonical value
 *
 * Strategy:
 * 1. Check bookmaker-specific overrides
 * 2. Try team name matching (home/away)
 * 3. Try common patterns
 * 4. Apply context-aware logic (market-specific)
 *
 * @param selectionName - Original selection name
 * @param marketDef - Market definition for context
 * @param overrides - Bookmaker-specific overrides
 * @param homeTeam - Home team name for matching
 * @param awayTeam - Away team name for matching
 * @returns Normalized selection with odds placeholder
 */
export function normalizeSelection(
  selectionName: string,
  marketDef: MarketDefinition,
  overrides?: Record<string, NormalizedSelection>,
  homeTeam?: string,
  awayTeam?: string
): NormalizedSelectionResult {
  const trimmed = selectionName.trim();
  const lowerName = trimmed.toLowerCase();

  // Strategy 1: Check overrides first (bookmaker-specific)
  if (overrides) {
    for (const [pattern, normalized] of Object.entries(overrides)) {
      try {
        if (new RegExp(pattern, "iu").test(trimmed)) {
          return { name: selectionName, normalizedName: normalized, odds: 0 };
        }
      } catch {
        // Invalid regex, skip
      }
    }
  }

  // Strategy 2: Team name matching (for player/team markets)
  if (homeTeam && lowerName.includes(homeTeam.toLowerCase())) {
    return { name: selectionName, normalizedName: "HOME" as NormalizedSelection, odds: 0 };
  }
  if (awayTeam && lowerName.includes(awayTeam.toLowerCase())) {
    return { name: selectionName, normalizedName: "AWAY" as NormalizedSelection, odds: 0 };
  }

  // Special case: Polish team terms
  if (/^gospodarz(?:arze|y)?$/iu.test(trimmed)) {
    return { name: selectionName, normalizedName: "HOME" as NormalizedSelection, odds: 0 };
  }
  if (/^go[śćś]cie|go[śś]ci$/iu.test(trimmed)) {
    return { name: selectionName, normalizedName: "AWAY" as NormalizedSelection, odds: 0 };
  }

  // Strategy 3: Common patterns
  for (const { pattern, normalized } of COMMON_SELECTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { name: selectionName, normalizedName: normalized, odds: 0 };
    }
  }

  // Strategy 4: Context-aware (market-specific logic)
  return normalizeSelectionWithContext(trimmed, lowerName, marketDef, selectionName);
}

// ============================================================================
// Context-Aware Selection Normalization
// ============================================================================

/**
 * Context-aware selection normalization
 * Handles market-specific selection logic
 */
function normalizeSelectionWithContext(
  trimmed: string,
  lowerName: string,
  marketDef: MarketDefinition,
  originalName: string
): NormalizedSelectionResult {
  const type = marketDef.code;

  // ==========================================================================
  // CORRECT_SCORE - preserve score format as normalizedName
  // Accepts: "0:0", "1-0", "0 - 1", numeric IDs mapped to scores
  // ==========================================================================
  if (type === "CORRECT_SCORE") {
    // Match standard score formats: "0:0", "1-0", "0 - 1", "2:1", etc.
    const scoreMatch = trimmed.match(/^(\d+)\s*[:–\-]\s*(\d+)$/);
    if (scoreMatch) {
      const normalizedScore = `${scoreMatch[1]}-${scoreMatch[2]}`;
      return { name: originalName, normalizedName: normalizedScore as NormalizedSelection, odds: 0 };
    }
    // For any other format (like "Inny" for other), use the original name
    return { name: originalName, normalizedName: trimmed as NormalizedSelection, odds: 0 };
  }

  // ==========================================================================
  // HALFTIME_FULLTIME - parse HT/FT combinations
  // Input formats: "1/1", "1 / X", "X/2", "1 / 1 i +2.5", etc.
  // ==========================================================================
  if (type === "HALFTIME_FULLTIME") {
    // Match HT/FT format with optional total: "1/1", "1 / X", "X / 2 i +2.5"
    const htftMatch = trimmed.match(/^([1x2])\s*\/\s*([1x2])(?:\s*i\s*([+-]?\d+[.,]?\d*))?$/iu);
    if (htftMatch) {
      const htCode = htftMatch[1].toUpperCase();
      const ftCode = htftMatch[2].toUpperCase();
      const ht = htCode === "1" ? "HOME" : htCode === "X" ? "DRAW" : "AWAY";
      const ft = ftCode === "1" ? "HOME" : ftCode === "X" ? "DRAW" : "AWAY";
      const param = htftMatch[3];

      if (param) {
        // With total parameter: HOME_HOME_OVER_2.5
        const overUnder = param.startsWith("+") || parseFloat(param.replace(",", ".")) > 0 ? "OVER" : "UNDER";
        const lineValue = param.replace(",", ".").replace(/^[+-]/, "");
        return { name: originalName, normalizedName: `${ht}_${ft}_${overUnder}_${lineValue}` as NormalizedSelection, odds: 0 };
      }

      // Standard HT/FT: "1/1" -> "HOME_HOME", "X/2" -> "DRAW_AWAY"
      return { name: originalName, normalizedName: `${ht}_${ft}` as NormalizedSelection, odds: 0 };
    }
    // Return original if can't parse
    return { name: originalName, normalizedName: trimmed as NormalizedSelection, odds: 0 };
  }

  // ==========================================================================
  // RESULT_AND_TOTAL - parse result + over/under combinations
  // Input formats: "1 i +2.5", "X i -2.5", "2 i over 2.5"
  // ==========================================================================
  if (type === "RESULT_AND_TOTAL") {
    // Match: "1 i +2.5", "X i -2.5", "2 i powyżej 2.5"
    const rtMatch = trimmed.match(/^([1x2])\s*i\s*([+-]?\d+[.,]?\d*|over|under|powyżej|poniżej|pow|pon)\s*(\d+[.,]?\d*)?$/iu);
    if (rtMatch) {
      const resultCode = rtMatch[1].toUpperCase();
      const result = resultCode === "1" ? "HOME" : resultCode === "X" ? "DRAW" : "AWAY";

      let overUnder: string;
      let line: string;

      if (rtMatch[3]) {
        // Format: "1 i over 2.5" or "1 i powyżej 2.5"
        const direction = rtMatch[2].toLowerCase();
        overUnder = /over|powyżej|pow|\+/.test(direction) ? "OVER" : "UNDER";
        line = rtMatch[3].replace(",", ".");
      } else {
        // Format: "1 i +2.5" or "1 i -2.5"
        const value = rtMatch[2].replace(",", ".");
        overUnder = value.startsWith("+") || (value.startsWith("-") === false && parseFloat(value) > 0) ? "OVER" : "UNDER";
        if (value.startsWith("-")) {
          overUnder = "UNDER";
        }
        line = value.replace(/^[+-]/, "");
      }

      return { name: originalName, normalizedName: `${result}_${overUnder}` as NormalizedSelection, odds: 0 };
    }
    // Return original if can't parse
    return { name: originalName, normalizedName: trimmed as NormalizedSelection, odds: 0 };
  }

  // ==========================================================================
  // RESULT_AND_BTTS - parse result + BTTS combinations
  // Input formats: "1 i Tak", "X i Nie", "2 i gg"
  // ==========================================================================
  if (type === "RESULT_AND_BTTS") {
    // Match: "1 i Tak", "X i Nie", "2 i gg"
    const rbMatch = trimmed.match(/^([1x2])\s*i\s*(tak|nie|yes|no|gg|ng)$/iu);
    if (rbMatch) {
      const resultCode = rbMatch[1].toUpperCase();
      const result = resultCode === "1" ? "HOME" : resultCode === "X" ? "DRAW" : "AWAY";
      const bttsCode = rbMatch[2].toLowerCase();
      const btts = /tak|yes|gg/.test(bttsCode) ? "YES" : "NO";

      return { name: originalName, normalizedName: `${result}_${btts}` as NormalizedSelection, odds: 0 };
    }
    // Return original if can't parse
    return { name: originalName, normalizedName: trimmed as NormalizedSelection, odds: 0 };
  }

  // ==========================================================================
  // PLAYER MARKETS - use player name as normalizedName
  // (GOALSCORER_FIRST, GOALSCORER_LAST, GOALSCORER_ANYTIME, PLAYER_SHOTS, PLAYER_CARDS, PLAYER_ASSISTS)
  // ==========================================================================
  const playerMarketTypes = [
    "GOALSCORER_FIRST",
    "GOALSCORER_LAST",
    "GOALSCORER_ANYTIME",
    "PLAYER_SHOTS",
    "PLAYER_CARDS",
    "PLAYER_ASSISTS",
  ];
  if (playerMarketTypes.includes(type)) {
    // For player markets, the selection name IS the canonical form (player name)
    // Just clean up and return the player name
    const playerName = trimmed
      .replace(/^\d+\.\s*/, "") // Remove leading numbers like "1. "
      .replace(/\s+/g, " ")     // Normalize whitespace
      .trim();

    return { name: originalName, normalizedName: playerName as NormalizedSelection, odds: 0 };
  }

  // ==========================================================================
  // BTTS / HALF_TIME_BTTS - Tak/Nie
  // ==========================================================================
  if (type === "BTTS" || type === "HALF_TIME_BTTS") {
    if (/^(tak|yes|si|gg|gol|sim|ja)$/iu.test(lowerName)) {
      return { name: originalName, normalizedName: "YES" as NormalizedSelection, odds: 0 };
    }
    if (/^(nie|no|ng|n[ao]o|brak|nein|non)$/iu.test(lowerName)) {
      return { name: originalName, normalizedName: "NO" as NormalizedSelection, odds: 0 };
    }
  }

  // ==========================================================================
  // TEAM_TO_SCORE - Tak = team scores, Nie = opponent scores
  // ==========================================================================
  if (type === "HOME_TEAM_TO_SCORE" || type === "AWAY_TEAM_TO_SCORE") {
    if (/^(tak|yes|si|gg|gol|sim|ja)$/iu.test(lowerName)) {
      // "Tak" means the specified team will score
      const team = type === "HOME_TEAM_TO_SCORE" ? "HOME" : "AWAY";
      return { name: originalName, normalizedName: team as NormalizedSelection, odds: 0 };
    }
    if (/^(nie|no|ng|n[ao]o|brak)$/iu.test(lowerName)) {
      // "Nie" means the specified team won't score (opponent will)
      const opponent = type === "HOME_TEAM_TO_SCORE" ? "AWAY" : "HOME";
      return { name: originalName, normalizedName: opponent as NormalizedSelection, odds: 0 };
    }
  }

  // ==========================================================================
  // HANDICAP - European format "1 (0:1)", "X (0:1)", "2 (0:1)"
  // ==========================================================================
  if (type === "EUROPEAN_HANDICAP") {
    const ehMatch = trimmed.match(/^([1x2])\s*\(\d+:\d+\)$/iu);
    if (ehMatch) {
      const code = ehMatch[1].toLowerCase();
      if (code === "1") return { name: originalName, normalizedName: "HOME" as NormalizedSelection, odds: 0 };
      if (code === "x") return { name: originalName, normalizedName: "DRAW" as NormalizedSelection, odds: 0 };
      if (code === "2") return { name: originalName, normalizedName: "AWAY" as NormalizedSelection, odds: 0 };
    }
  }

  // ==========================================================================
  // Over/Under with explicit "+" / "-" prefix
  // ==========================================================================
  if (/^\+/.test(trimmed)) {
    return { name: originalName, normalizedName: "OVER" as NormalizedSelection, odds: 0 };
  }
  if (/^-/.test(trimmed)) {
    return { name: originalName, normalizedName: "UNDER" as NormalizedSelection, odds: 0 };
  }

  // ==========================================================================
  // Try to match expected selections for this market
  // ==========================================================================
  for (const expected of marketDef.selections || []) {
    const expectedLower = expected.toLowerCase();
    if (
      lowerName === expectedLower ||
      lowerName.startsWith(expectedLower) ||
      expectedLower.startsWith(lowerName)
    ) {
      return { name: originalName, normalizedName: expected as NormalizedSelection, odds: 0 };
    }
  }

  // ==========================================================================
  // Fallback - unknown
  // ==========================================================================
  return { name: originalName, normalizedName: "UNKNOWN" as NormalizedSelection, odds: 0 };
}

// ============================================================================
// Batch Normalization
// ============================================================================

/**
 * Normalize multiple selections at once
 */
export function normalizeSelections(
  selections: Array<{ name: string; odds: number }>,
  marketDef: MarketDefinition,
  overrides?: Record<string, NormalizedSelection>,
  homeTeam?: string,
  awayTeam?: string
): NormalizedSelectionResult[] {
  return selections.map((sel) => {
    const normalized = normalizeSelection(
      sel.name,
      marketDef,
      overrides,
      homeTeam,
      awayTeam
    );
    // Preserve original odds
    return { ...normalized, odds: sel.odds };
  });
}
