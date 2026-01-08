/**
 * Normalizer Factory
 *
 * Factory function to create the unified normalizer with all bookmaker adapters.
 * Exports a singleton instance for convenience.
 */

import { UnifiedNormalizer } from "./core/unified-normalizer.js";
import {
  stsAdapter,
  fortunaAdapter,
  superbetAdapter,
  betclicAdapter,
  betcrisAdapter,
  betfanAdapter,
  bettersAdapter,
  etotoAdapter,
  forbetAdapter,
  fuksiarzAdapter,
  lebullAdapter,
  lvbetAdapter,
  pzbukAdapter,
  totalbetAdapter,
} from "./bookmakers/index.js";

/**
 * Create normalizer with all bookmaker adapters
 *
 * @returns UnifiedNormalizer instance
 */
export function createNormalizer(): UnifiedNormalizer {
  return new UnifiedNormalizer([
    // All bookmakers with their adapters
    stsAdapter,
    fortunaAdapter,
    superbetAdapter,
    betclicAdapter,
    betcrisAdapter,
    betfanAdapter,
    bettersAdapter,
    etotoAdapter,
    forbetAdapter,
    fuksiarzAdapter,
    lebullAdapter,
    lvbetAdapter,
    pzbukAdapter,
    totalbetAdapter,
  ]);
}

/**
 * Singleton normalizer instance
 *
 * Use this for convenience instead of creating a new instance each time
 */
export const normalizer = createNormalizer();
