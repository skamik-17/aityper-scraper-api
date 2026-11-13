/**
 * Odds storage flags. Each one is read on use, so tests can stub the env, and
 * each defaults to today's behaviour.
 */

/** The degenerate-write prune guard: off unless ODDS_PRUNE_GUARD=true (owner B13). */
export function isPruneGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ODDS_PRUNE_GUARD === "true";
}

/**
 * Where odds are written. legacy: table odds only | dual: both, legacy primary |
 * switched: both, snapshot primary | snapshot: the snapshot model only.
 */
export type OddsWriteModel = "legacy" | "dual" | "switched" | "snapshot";

const WRITE_MODELS: readonly OddsWriteModel[] = ["legacy", "dual", "switched", "snapshot"];
const warnedWriteModels = new Set<string>();

export function getOddsWriteModel(env: NodeJS.ProcessEnv = process.env): OddsWriteModel {
  const raw = env.ODDS_WRITE_MODEL;
  if (raw === undefined || raw === "") return "legacy";
  if ((WRITE_MODELS as readonly string[]).includes(raw)) return raw as OddsWriteModel;
  // Warn once per value: this runs on every bookmaker save
  if (!warnedWriteModels.has(raw)) {
    warnedWriteModels.add(raw);
    console.warn(`[Config] Unknown ODDS_WRITE_MODEL "${raw}" - using "legacy"`);
  }
  return "legacy";
}
