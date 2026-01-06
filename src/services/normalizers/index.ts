/**
 * Normalizer Strategy Factory
 *
 * Returns the appropriate normalizer for each bookmaker.
 * This module serves as the central entry point for market normalization.
 *
 * Usage:
 *   import { getNormalizer } from './normalizers';
 *   const normalizer = getNormalizer('sts');
 *   if (normalizer) {
 *     const result = normalizer.normalize(market, homeTeam, awayTeam);
 *   }
 */

import type { BaseNormalizer } from "./base-normalizer.js";

// Bookmaker-specific normalizer imports
import { totalbetNormalizer } from "./totalbet-normalizer.js";
import { forbetNormalizer } from "./forbet-normalizer.js";
import { fuksiarzNormalizer } from "./fuksiarz-normalizer.js";
import { etotoNormalizer } from "./etoto-normalizer.js";
import { lvbetNormalizer } from "./lvbet-normalizer.js";
import { lebullNormalizer } from "./lebull-normalizer.js";
import { superbetNormalizer } from "./superbet-normalizer.js";
import { betfanNormalizer } from "./betfan-normalizer.js";
import { betcrisNormalizer } from "./betcris-normalizer.js";
import { stsNormalizer } from "./sts-normalizer.js";
import { fortunaNormalizer } from "./fortuna-normalizer.js";
import { betclicNormalizer } from "./betclic-normalizer.js";
import { pzbukNormalizer } from "./pzbuk-normalizer.js";
import { bettersNormalizer } from "./betters-normalizer.js";
// import { goplusbetNormalizer } from "./goplusbet-normalizer.js";
// import { noblebetNormalizer } from "./noblebet-normalizer.js";

/**
 * Registry of bookmaker-specific normalizers
 * Key: bookmaker identifier (lowercase)
 * Value: normalizer instance
 */
const normalizers = new Map<string, BaseNormalizer>();

// Register implemented normalizers
normalizers.set("totalbet", totalbetNormalizer);
normalizers.set("forbet", forbetNormalizer);
normalizers.set("fuksiarz", fuksiarzNormalizer);
normalizers.set("etoto", etotoNormalizer);
normalizers.set("lvbet", lvbetNormalizer);
normalizers.set("lebull", lebullNormalizer);
normalizers.set("superbet", superbetNormalizer);
normalizers.set("betfan", betfanNormalizer);
normalizers.set("betcris", betcrisNormalizer);
normalizers.set("sts", stsNormalizer);
normalizers.set("fortuna", fortunaNormalizer);
normalizers.set("betclic", betclicNormalizer);
normalizers.set("pzbuk", pzbukNormalizer);
normalizers.set("betters", bettersNormalizer);
// Normalizers still to be implemented:
// normalizers.set("goplusbet", goplusbetNormalizer);
// normalizers.set("noblebet", noblebetNormalizer);

/**
 * Get the normalizer for a specific bookmaker
 *
 * @param bookmaker - Bookmaker identifier (case-insensitive)
 * @returns Normalizer instance if available, undefined otherwise
 */
export function getNormalizer(bookmaker: string): BaseNormalizer | undefined {
  return normalizers.get(bookmaker.toLowerCase());
}

/**
 * Check if a bookmaker-specific normalizer is available
 *
 * @param bookmaker - Bookmaker identifier (case-insensitive)
 * @returns True if a specific normalizer exists for this bookmaker
 */
export function hasNormalizer(bookmaker: string): boolean {
  return normalizers.has(bookmaker.toLowerCase());
}

/**
 * Get all registered bookmaker identifiers
 *
 * @returns Array of bookmaker identifiers with specific normalizers
 */
export function getRegisteredBookmakers(): string[] {
  return Array.from(normalizers.keys());
}

/**
 * Register a normalizer for a bookmaker
 * Primarily used for testing or dynamic registration
 *
 * @param bookmaker - Bookmaker identifier (will be lowercased)
 * @param normalizer - Normalizer instance to register
 */
export function registerNormalizer(
  bookmaker: string,
  normalizer: BaseNormalizer
): void {
  normalizers.set(bookmaker.toLowerCase(), normalizer);
}

// Re-export base class and types for convenience
export { BaseNormalizer } from "./base-normalizer.js";
export type {
  MarketPattern,
  RawMarketData,
  NormalizedMarket,
} from "./base-normalizer.js";
