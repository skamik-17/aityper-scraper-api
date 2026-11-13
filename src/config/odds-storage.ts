/**
 * Odds storage flags. Each one is read on use, so tests can stub the env, and
 * each defaults to today's behaviour.
 */

/** The degenerate-write prune guard: off unless ODDS_PRUNE_GUARD=true (owner B13). */
export function isPruneGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ODDS_PRUNE_GUARD === "true";
}
