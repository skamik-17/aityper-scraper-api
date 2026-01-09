/**
 * Pattern Engine
 *
 * Pattern matching engine for market names.
 * Tests market names against all patterns in the market registry.
 */

import type { MarketDefinition, PatternMatch } from "../types.js";

// ============================================================================
// Main Function
// ============================================================================

/**
 * Try to match market name against all patterns in registry
 *
 * Strategy:
 * 1. Iterate through all market definitions
 * 2. For each definition, test all patterns
 * 3. Return first match with extracted parameter
 *
 * Patterns are tested in order of definition in the registry.
 * More specific patterns should be defined first.
 *
 * @param marketName - The market name to match
 * @param registry - The market registry to search
 * @returns Pattern match result or null if no match
 */
export function matchPattern(
  marketName: string,
  registry: MarketDefinition[]
): PatternMatch | null {
  const trimmed = marketName.trim();

  // Try each market definition
  for (const def of registry) {
    // Try main patterns
    for (const pattern of def.patterns) {
      try {
        const match = trimmed.match(pattern);
        if (match) {
          const param = def.extractParam ? def.extractParam(match) : undefined;
          return { definition: def, param, match };
        }
      } catch (e) {
        // Invalid regex or error in extractParam, skip this pattern
        console.warn(`Pattern error for ${def.slug}:`, e);
        continue;
      }
    }

    // Try bookmaker-specific additional patterns
    if (def.bookmakerData) {
      for (const bmData of Object.values(def.bookmakerData)) {
        if (bmData.additionalPatterns) {
          for (const pattern of bmData.additionalPatterns) {
            try {
              const match = trimmed.match(pattern);
              if (match) {
                const param = def.extractParam ? def.extractParam(match) : undefined;
                return { definition: def, param, match };
              }
            } catch (e) {
              console.warn(`Bookmaker pattern error for ${def.slug}:`, e);
              continue;
            }
          }
        }
      }
    }
  }

  // No match found
  return null;
}

// ============================================================================
// Batch Matching
// ============================================================================

/**
 * Match multiple market names at once
 *
 * @param marketNames - Array of market names to match
 * @param registry - The market registry to search
 * @returns Array of match results (null for no match)
 */
export function matchPatterns(
  marketNames: string[],
  registry: MarketDefinition[]
): (PatternMatch | null)[] {
  return marketNames.map((name) => matchPattern(name, registry));
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract parameter from market name using regex
 *
 * Common patterns:
 * - Decimal line: 2.5, 3.5, etc.
 * - Integer: 1, 2, 3, etc.
 * - Handicap: +1.5, -0.5, etc.
 *
 * @param marketName - The market name
 * @param pattern - The regex pattern to use
 * @returns Extracted parameter or undefined
 */
export function extractParameter(
  marketName: string,
  pattern: RegExp
): string | undefined {
  const match = marketName.match(pattern);
  if (!match) return undefined;

  // Look for a number in the match groups
  for (let i = 1; i < match.length; i++) {
    const value = match[i];
    if (value) {
      // Normalize decimal separator
      return value.replace(",", ".");
    }
  }

  return undefined;
}

/**
 * Check if a market name matches any pattern for a given market type
 *
 * @param marketName - The market name to check
 * @param marketType - The market type to check against
 * @param registry - The market registry
 * @returns true if matches any pattern for the type
 */
export function matchesMarketType(
  marketName: string,
  marketType: string,
  registry: MarketDefinition[]
): boolean {
  const match = matchPattern(marketName, registry);
  return match?.definition.code === marketType;
}

/**
 * Get all possible market types for a market name
 *
 * Useful for debugging or finding ambiguous patterns
 *
 * @param marketName - The market name
 * @param registry - The market registry
 * @returns Array of matching market types
 */
export function getMatchingTypes(
  marketName: string,
  registry: MarketDefinition[]
): string[] {
  const trimmed = marketName.trim();
  const matches: string[] = [];

  for (const def of registry) {
    for (const pattern of def.patterns) {
      try {
        if (trimmed.match(pattern)) {
          matches.push(def.code);
          break; // Found a match, move to next definition
        }
      } catch {
        continue;
      }
    }
  }

  return matches;
}
