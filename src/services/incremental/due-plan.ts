/**
 * Which listed events need a detail fetch on this pass (plan 10, README §8 Q5).
 * Pure: every time comes in through `now`.
 *
 * Kickoff tiers bound how old a detail may get; a changed listing fingerprint
 * makes an event due at once. PASS_TOLERANCE_MS absorbs tick jitter, so an
 * event in the 10-minute tier is fetched on every pass at 9-11 minute gaps.
 */
import type { EventRef } from "../../scrapers/shared/incremental/incremental-scraper.js";

export const PASS_TOLERANCE_MS = 120_000;
/** Staleness cap for kickoffs within 72 h or unknown. */
export const HARD_CAP_NEAR_MS = 2 * 3_600_000;
export const HARD_CAP_FAR_MS = 6 * 3_600_000;

export type TierLabel = "lt1h" | "1to3h" | "3to24h" | "24to72h" | "gt72h" | "noKickoff";

const MINUTE = 60_000;
const HOUR = 3_600_000;

export const TIER_MAX_AGE_MS: Record<TierLabel, number> = {
  lt1h: 10 * MINUTE,
  "1to3h": 20 * MINUTE,
  "3to24h": 60 * MINUTE,
  "24to72h": 120 * MINUTE,
  gt72h: 360 * MINUTE,
  noKickoff: 10 * MINUTE,
};

/** ms to kickoff: (-inf,1h) [1h,3h) [3h,24h) [24h,72h) [72h,inf). */
export function tierOf(kickoffMs: number | null, now: number): TierLabel {
  if (kickoffMs === null) return "noKickoff";
  const toKickoff = kickoffMs - now;
  if (toKickoff < HOUR) return "lt1h";
  if (toKickoff < 3 * HOUR) return "1to3h";
  if (toKickoff < 24 * HOUR) return "3to24h";
  if (toKickoff < 72 * HOUR) return "24to72h";
  return "gt72h";
}

export interface EventFetchState {
  lastDetailAt: number | null;
  fingerprint: string | null;
  status: "ok" | "degenerate";
}

export type DueReason = "forced" | "never-fetched" | "degenerate" | "fingerprint-changed" | "tier-age";
export type NotDueReason = "started" | "fresh";

export interface DueDecision {
  ref: EventRef;
  due: boolean;
  reason: DueReason | NotDueReason;
  tier: TierLabel;
  ageMs: number | null;
}

function kickoffMsOf(ref: EventRef): number | null {
  if (ref.kickoff === null) return null;
  const ms = Date.parse(ref.kickoff);
  // An unparsable kickoff is treated as unknown: the 10-minute tier, never "started"
  return Number.isFinite(ms) ? ms : null;
}

function decide(ref: EventRef, state: EventFetchState | undefined, now: number, forceAll: boolean): DueDecision {
  const kickoffMs = kickoffMsOf(ref);
  const tier = tierOf(kickoffMs, now);
  const ageMs = state?.lastDetailAt == null ? null : now - state.lastDetailAt;
  const d = (due: boolean, reason: DueReason | NotDueReason): DueDecision => ({ ref, due, reason, tier, ageMs });

  // First match wins
  if (kickoffMs !== null && kickoffMs <= now) return d(false, "started");
  if (forceAll) return d(true, "forced");
  if (state === undefined || state.lastDetailAt === null || ageMs === null) return d(true, "never-fetched");
  if (state.status === "degenerate") return d(true, "degenerate");
  if (ref.fingerprint !== null && ref.fingerprint !== state.fingerprint) return d(true, "fingerprint-changed");
  if (ageMs + PASS_TOLERANCE_MS >= TIER_MAX_AGE_MS[tier]) return d(true, "tier-age");
  return d(false, "fresh");
}

export function planDetailFetches(
  refs: readonly EventRef[],
  stateOf: (ref: EventRef) => EventFetchState | undefined,
  now: number,
  opts?: { forceAll?: boolean },
): DueDecision[] {
  const forceAll = opts?.forceAll === true;
  return refs.map((ref) => decide(ref, stateOf(ref), now, forceAll));
}
