/**
 * Incremental scraping settings (plan 10). Disabled by default: with
 * INCREMENTAL_BOOKMAKERS unset every bookmaker keeps today's full pass at
 * SCRAPE_INTERVAL_MINUTES. Any invalid value disables incremental mode with one
 * error line instead of crashing the service.
 */
import { ALL_POLISH_BOOKMAKERS, CONFIG, type PolishBookmaker } from "./index.js";
import { readsSnapshotModel } from "./odds-storage.js";

export interface IncrementalConfig {
  bookmakers: ReadonlySet<PolishBookmaker>;
  passMinutes: number;
  dryRun: boolean;
  error: string | null;
}

export const DEFAULT_INCREMENTAL_PASS_MINUTES = 10;
const MIN_PASS_MINUTES = 5;

function isBookmaker(v: string): v is PolishBookmaker {
  return (ALL_POLISH_BOOKMAKERS as readonly string[]).includes(v);
}

export function readIncrementalConfig(env: NodeJS.ProcessEnv, scrapeIntervalMinutes: number): IncrementalConfig {
  const dryRun = env.INCREMENTAL_DRY_RUN === "true" || env.INCREMENTAL_DRY_RUN === "1";
  const rawPass = env.INCREMENTAL_PASS_MINUTES?.trim() ?? "";
  // Unset: the default, never longer than the full interval
  const defaultPass = Math.min(DEFAULT_INCREMENTAL_PASS_MINUTES, scrapeIntervalMinutes);
  const disabled = (error: string): IncrementalConfig => ({ bookmakers: new Set(), passMinutes: defaultPass, dryRun, error });

  const names = (env.INCREMENTAL_BOOKMAKERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const bookmakers = new Set<PolishBookmaker>();
  for (const name of names) {
    if (!isBookmaker(name)) return disabled(`INCREMENTAL_BOOKMAKERS: unknown bookmaker ${name}`);
    bookmakers.add(name);
  }

  let passMinutes = defaultPass;
  if (rawPass !== "") {
    const n = Number(rawPass);
    if (!/^\d+$/.test(rawPass) || n < MIN_PASS_MINUTES || n > scrapeIntervalMinutes) {
      return disabled(`INCREMENTAL_PASS_MINUTES must be an integer between ${MIN_PASS_MINUTES} and ${scrapeIntervalMinutes}`);
    }
    passMinutes = n;
  }

  // A confirmation bumps only odds_snapshot.last_seen_at: before the read switch (plan 09)
  // every unfetched event would read as stale from table odds.
  if (bookmakers.size > 0 && !dryRun && !readsSnapshotModel(env)) {
    return disabled(
      "INCREMENTAL_BOOKMAKERS needs ODDS_WRITE_MODEL=switched or snapshot (the snapshot read path); incremental mode disabled",
    );
  }
  return { bookmakers, passMinutes, dryRun, error: null };
}

export function formatIncrementalConfigLine(cfg: IncrementalConfig): string {
  if (cfg.error !== null) {
    const suffix = cfg.error.endsWith("incremental mode disabled") ? "" : "; incremental mode disabled";
    return `[Incremental] ${cfg.error}${suffix}`;
  }
  const list = cfg.bookmakers.size > 0 ? [...cfg.bookmakers].join(",") : "none";
  return `[Incremental] bookmakers=${list} passMinutes=${cfg.passMinutes} dryRun=${cfg.dryRun}`;
}

let cached: IncrementalConfig | null = null;

/** The process-wide settings, read once from process.env. */
export function getIncrementalConfig(): IncrementalConfig {
  cached ??= readIncrementalConfig(process.env, CONFIG.SCRAPE_INTERVAL_MINUTES);
  return cached;
}
