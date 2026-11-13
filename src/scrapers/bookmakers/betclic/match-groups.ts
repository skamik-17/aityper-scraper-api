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

export type MatchGroupAssessment =
  | { ok: true; responses: Buffer[]; emptyGroups: BetclicGroupName[] }
  | { ok: false; reason: string };

const GROUP_ORDER = Object.keys(MARKET_GROUP_FILTERS) as BetclicGroupName[];

export function assessMatchGroups(results: readonly BetclicGroupResult[]): MatchGroupAssessment {
  const byGroup = new Map(results.map((r) => [r.group, r]));

  const top = byGroup.get("TOP");
  if (!top || top.error !== null || !top.response || top.response.length < MIN_GROUP_BYTES) {
    const why = !top ? "not fetched" : top.error ?? `${top.response?.length ?? 0} bytes`;
    return { ok: false, reason: `TOP missing: ${why}` };
  }

  const failed: string[] = [];
  for (const group of GROUP_ORDER) {
    const r = byGroup.get(group);
    if (!r) failed.push(`${group} (not fetched)`);
    else if (r.error !== null || !r.response) failed.push(`${group} (${r.error ?? "no response"})`);
  }
  if (failed.length > 0) {
    const valid = GROUP_ORDER.length - failed.length;
    return { ok: false, reason: `${valid}/${GROUP_ORDER.length} required groups valid; failed: ${failed.join("; ")}` };
  }

  const responses: Buffer[] = [];
  const emptyGroups: BetclicGroupName[] = [];
  for (const group of GROUP_ORDER) {
    const response = byGroup.get(group)!.response!;
    if (response.length >= MIN_GROUP_BYTES) responses.push(response);
    else emptyGroups.push(group);
  }
  return { ok: true, responses, emptyGroups };
}
