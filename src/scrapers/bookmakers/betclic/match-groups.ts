/**
 * Decides whether one match's per-group gRPC responses are complete enough
 * to be written. A match that fails this check is skipped (no write, so its
 * previous snapshot is not pruned) instead of being saved with a subset of
 * its markets.
 */
import { MARKET_GROUP_FILTERS } from "./constants.js";

export type BetclicGroupName = keyof typeof MARKET_GROUP_FILTERS;

export interface BetclicGroupResult {
  group: BetclicGroupName;
  response: Buffer | null;
  error: string | null;
}

/** Responses smaller than this carry no markets (today's filter). */
export const MIN_GROUP_BYTES = 100;

/** A completed payload left out because it is byte-equal to an earlier group's. */
export interface BetclicDuplicateGroup {
  group: BetclicGroupName;
  sameAs: BetclicGroupName;
}

export type MatchGroupAssessment =
  | {
      ok: true;
      responses: Buffer[];
      emptyGroups: BetclicGroupName[];
      duplicates: BetclicDuplicateGroup[];
      /** Groups the match does not declare that failed: served as TOP's own payload, so nothing is lost. */
      optionalFailed: BetclicGroupName[];
    }
  | { ok: false; reason: string };

const GROUP_ORDER = Object.keys(MARKET_GROUP_FILTERS) as BetclicGroupName[];

/**
 * `declared` is the category list of the match header (parseMatchHeader). When it is
 * non-empty, the required groups are TOP plus every group whose category the match
 * declares; an undeclared category is served as TOP's own payload, so its failure
 * loses nothing. When it is empty (unreadable header), all 7 groups are required.
 */
export function assessMatchGroups(
  results: readonly BetclicGroupResult[],
  declared: readonly string[] = []
): MatchGroupAssessment {
  const byGroup = new Map(results.map((r) => [r.group, r]));
  const declaredSet = new Set(declared);
  const isRequired = (group: BetclicGroupName): boolean => {
    const category = MARKET_GROUP_FILTERS[group];
    return declaredSet.size === 0 || category === null || declaredSet.has(category);
  };

  const top = byGroup.get("TOP");
  if (!top || top.error !== null || !top.response || top.response.length < MIN_GROUP_BYTES) {
    const why = !top ? "not fetched" : top.error ?? `${top.response?.length ?? 0} bytes`;
    return { ok: false, reason: `TOP missing: ${why}` };
  }

  const failed: string[] = [];
  const optionalFailed: BetclicGroupName[] = [];
  for (const group of GROUP_ORDER) {
    const r = byGroup.get(group);
    const problem = !r ? "not fetched" : r.error !== null || !r.response ? r.error ?? "no response" : null;
    if (problem === null) continue;
    if (isRequired(group)) failed.push(`${group} (${problem})`);
    else optionalFailed.push(group);
  }
  if (failed.length > 0) {
    const required = GROUP_ORDER.filter(isRequired).length;
    return { ok: false, reason: `${required - failed.length}/${required} required groups valid; failed: ${failed.join("; ")}` };
  }

  // Far matches echo TOP's payload for several groups. A byte-equal payload adds no
  // market (the parser keeps the first of equal-size markets), so it is not parsed again.
  const responses: Buffer[] = [];
  const kept: BetclicGroupName[] = [];
  const emptyGroups: BetclicGroupName[] = [];
  const duplicates: BetclicDuplicateGroup[] = [];
  for (const group of GROUP_ORDER) {
    const response = byGroup.get(group)?.response;
    if (!response) continue; // an optional group that failed
    if (response.length < MIN_GROUP_BYTES) {
      emptyGroups.push(group);
      continue;
    }
    const same = responses.findIndex((earlier) => earlier.length === response.length && earlier.equals(response));
    if (same >= 0) {
      duplicates.push({ group, sameAs: kept[same] });
      continue;
    }
    responses.push(response);
    kept.push(group);
  }
  return { ok: true, responses, emptyGroups, duplicates, optionalFailed };
}
