/**
 * betters runs on Betby (Sportradar UOF): the shared id-based Betby normalizer.
 */
import { createBetbyNormalizer } from "./betby-normalizer.js";

export const bettersNormalizer = createBetbyNormalizer("betters");
export default bettersNormalizer;
