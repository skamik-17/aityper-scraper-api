/**
 * Plan 10 Tasks 10-11: the incremental report over a server log (read-only, no DB).
 *
 *   npx tsx scripts/incremental-report.ts --log <file> --from <ISO> --to <ISO> --window quiet|matchday [--live]
 *
 * Without --live: the dry run (INCREMENTAL_DRY_RUN=true) — plan-only passes against the
 * hourly full passes' cost. With --live: incremental/forced passes, pass counts and
 * staleness only. Exit 0 when every criterion holds, 1 otherwise, 2 on a usage error.
 */
import { readFileSync } from "node:fs";
import { buildIncrementalReport, formatIncrementalReport, type ReportWindow } from "../src/services/incremental/incremental-report.js";

const USAGE = "Usage: incremental-report.ts --log <file> --from <ISO> --to <ISO> --window quiet|matchday [--live]";

interface Args {
  log: string;
  from: number;
  to: number;
  window: ReportWindow;
  live: boolean;
}

function parseArgs(argv: string[]): Args | null {
  const raw: Record<string, string> = {};
  let live = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--live") {
      live = true;
      continue;
    }
    const value = argv[i + 1];
    if (!["--log", "--from", "--to", "--window"].includes(flag) || value === undefined) return null;
    raw[flag.slice(2)] = value;
    i++;
  }
  const from = Date.parse(raw.from ?? "");
  const to = Date.parse(raw.to ?? "");
  if (!raw.log || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  if (raw.window !== "quiet" && raw.window !== "matchday") return null;
  return { log: raw.log, from, to, window: raw.window, live };
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error(USAGE);
    return 2;
  }
  let text: string;
  try {
    text = readFileSync(args.log, "utf8");
  } catch (error) {
    console.error(`Cannot read ${args.log}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const report = buildIncrementalReport(text.split(/\r?\n/), { from: args.from, to: args.to, window: args.window, live: args.live });
  console.log(formatIncrementalReport(report));
  return report.ok ? 0 : 1;
}

process.exitCode = main();
