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
  { pattern: /^(1|home|gospodarz|dom|heim|casa)$/iu, normalized: "HOME" as NormalizedSelection },
  { pattern: /^(x|draw|remis|empate|nul|unentschieden|pareggio)$/iu, normalized: "DRAW" as NormalizedSelection },
  { pattern: /^(2|away|gość|gosc|auswärts|fuera|ospite)$/iu, normalized: "AWAY" as NormalizedSelection },

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
  const type = marketDef.type;

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
  for (const expected of marketDef.selections) {
    const expectedLower = expected.toLowerCase();
    if (
      lowerName === expectedLower ||
      lowerName.startsWith(expectedLower) ||
      expectedLower.startsWith(lowerName)
    ) {
      return { name: originalName, normalizedName: expected, odds: 0 };
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
