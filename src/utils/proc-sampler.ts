/**
 * Linux /proc process-tree sampler: node RSS plus the RSS and CPU ticks of
 * every Chromium descendant, for perf smoke runs.
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";

export const CLOCK_TICKS_PER_S = 100;

export interface ProcTree {
  rootRssBytes: number;
  /** Sorted by pid. */
  chromium: Array<{ pid: number; rssBytes: number; cpuTicks: number }>;
}

interface ProcEntry {
  pid: number;
  comm: string;
  ppid: number;
  cpuTicks: number;
}

async function readStat(procRoot: string, pid: number): Promise<ProcEntry | null> {
  try {
    const raw = await fs.readFile(join(procRoot, String(pid), "stat"), "utf8");
    const open = raw.indexOf("(");
    const close = raw.lastIndexOf(")");
    if (open < 0 || close < open) return null;
    const comm = raw.slice(open + 1, close);
    const rest = raw.slice(close + 2).trim().split(/\s+/); // state, ppid, ...
    const ppid = Number(rest[1]);
    const utime = Number(rest[11]);
    const stime = Number(rest[12]);
    if (!Number.isFinite(ppid)) return null;
    return { pid, comm, ppid, cpuTicks: (Number.isFinite(utime) ? utime : 0) + (Number.isFinite(stime) ? stime : 0) };
  } catch {
    return null; // vanished mid-read
  }
}

async function readRssBytes(procRoot: string, pid: number): Promise<number | null> {
  try {
    const status = await fs.readFile(join(procRoot, String(pid), "status"), "utf8");
    const m = /^VmRSS:\s+(\d+)\s*kB/m.exec(status);
    return m ? Number(m[1]) * 1024 : null;
  } catch {
    return null;
  }
}

export async function readProcessTree(rootPid: number, procRoot = "/proc"): Promise<ProcTree> {
  const names = await fs.readdir(procRoot).catch(() => [] as string[]);
  const pids = names.filter((n) => /^\d+$/.test(n)).map(Number);
  const entries = (await Promise.all(pids.map((pid) => readStat(procRoot, pid)))).filter((e): e is ProcEntry => e !== null);

  const children = new Map<number, ProcEntry[]>();
  for (const e of entries) {
    const list = children.get(e.ppid) ?? [];
    list.push(e);
    children.set(e.ppid, list);
  }

  const descendants: ProcEntry[] = [];
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop()!;
    for (const child of children.get(pid) ?? []) {
      descendants.push(child);
      stack.push(child.pid);
    }
  }

  const chromiumEntries = descendants.filter((e) => /chrome|headless/i.test(e.comm));
  const chromium = (
    await Promise.all(
      chromiumEntries.map(async (e) => {
        const rss = await readRssBytes(procRoot, e.pid);
        return rss === null ? null : { pid: e.pid, rssBytes: rss, cpuTicks: e.cpuTicks };
      }),
    )
  )
    .filter((c): c is { pid: number; rssBytes: number; cpuTicks: number } => c !== null)
    .sort((a, b) => a.pid - b.pid);

  return { rootRssBytes: (await readRssBytes(procRoot, rootPid)) ?? 0, chromium };
}

export interface ProcessSamplerSummary {
  samples: number;
  nodePeakRssMb: number;
  chromiumPeakRssMb: number;
  chromiumPeakProcesses: number;
  chromiumProcessesEver: number;
  chromiumCpuS: number;
}

const toMb = (bytes: number) => Math.round(bytes / 1048576);

export function createProcSummary(): { add(t: ProcTree): void; summary(): ProcessSamplerSummary } {
  let samples = 0;
  let nodePeak = 0;
  let chromiumPeak = 0;
  let peakProcesses = 0;
  const lastTicks = new Map<number, number>();
  return {
    add(t) {
      samples++;
      nodePeak = Math.max(nodePeak, t.rootRssBytes);
      chromiumPeak = Math.max(chromiumPeak, t.chromium.reduce((s, c) => s + c.rssBytes, 0));
      peakProcesses = Math.max(peakProcesses, t.chromium.length);
      for (const c of t.chromium) lastTicks.set(c.pid, c.cpuTicks);
    },
    summary() {
      const ticks = [...lastTicks.values()].reduce((s, v) => s + v, 0);
      return {
        samples,
        nodePeakRssMb: toMb(nodePeak),
        chromiumPeakRssMb: toMb(chromiumPeak),
        chromiumPeakProcesses: peakProcesses,
        chromiumProcessesEver: lastTicks.size,
        chromiumCpuS: Math.round((ticks / CLOCK_TICKS_PER_S) * 100) / 100,
      };
    },
  };
}

export function startProcessSampler(opts: { rootPid: number; intervalMs: number; procRoot?: string }): {
  stop(): Promise<ProcessSamplerSummary>;
} {
  const acc = createProcSummary();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const sample = () => readProcessTree(opts.rootPid, opts.procRoot).then((t) => acc.add(t));
  const tick = () => {
    inFlight = sample().finally(() => {
      if (!stopped) timer = setTimeout(tick, opts.intervalMs); // chained: samples never overlap
    });
  };
  tick();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight.catch(() => {});
      await sample().catch(() => {});
      return acc.summary();
    },
  };
}
