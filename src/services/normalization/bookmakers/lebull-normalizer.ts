/**
 * lebull runs on Betby (Sportradar UOF): the shared id-based Betby normalizer.
 */
import { createBetbyNormalizer } from "./betby-normalizer.js";

export const lebullNormalizer = createBetbyNormalizer("lebull");
export default lebullNormalizer;
