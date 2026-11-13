import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProcessTree, createProcSummary, startProcessSampler } from "../proc-sampler.js";

let root: string;
const writeProc = (pid: number | string, comm: string, ppid: number, utime: number, stime: number, rssKb: number) => {
  const dir = join(root, String(pid));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "stat"), `${pid} (${comm}) S ${ppid} 1 1 0 -1 4194560 0 0 0 0 ${utime} ${stime} 0 0`);
  writeFileSync(join(dir, "status"), `Name:\t${comm}\nVmRSS:\t${rssKb} kB\n`);
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "proc-"));
  writeProc(100, "node", 1, 10, 5, 300000);
  writeProc(200, "headless_shell", 100, 30, 20, 102400);
  writeProc(201, "headless_shell", 200, 5, 5, 51200);
  writeProc(202, "chrome_crashpad", 200, 1, 1, 1024);
  writeProc(300, "chrome", 1, 9, 9, 9999); // not a descendant
  writeProc(400, "python3", 100, 2, 2, 2048); // descendant, not chromium
  writeProc(500, "Web Content (x)", 1, 1, 1, 1024); // comm with parentheses
  mkdirSync(join(root, "600"), { recursive: true }); // vanished mid-read
  mkdirSync(join(root, "self"), { recursive: true }); // non-numeric
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("proc sampler", () => {
  it("reads the root RSS and the chromium descendants only", async () => {
    const t = await readProcessTree(100, root);
    expect(t.rootRssBytes).toBe(300000 * 1024);
    expect(t.chromium.map((c) => c.pid)).toEqual([200, 201, 202]);
    expect(t.chromium[0]).toEqual({ pid: 200, rssBytes: 102400 * 1024, cpuTicks: 50 });
  });

  it("summarises peaks, process counts and last-seen CPU", () => {
    const s = createProcSummary();
    const MB = 1048576;
    s.add({ rootRssBytes: 200 * MB, chromium: [{ pid: 200, rssBytes: 100 * MB, cpuTicks: 50 }, { pid: 201, rssBytes: 50 * MB, cpuTicks: 20 }] });
    s.add({ rootRssBytes: 300 * MB, chromium: [{ pid: 200, rssBytes: 120 * MB, cpuTicks: 80 }, { pid: 203, rssBytes: 10 * MB, cpuTicks: 5 }] });
    expect(s.summary()).toEqual({
      samples: 2,
      nodePeakRssMb: 300,
      chromiumPeakRssMb: 150,
      chromiumPeakProcesses: 2,
      chromiumProcessesEver: 3,
      chromiumCpuS: 1.05,
    });
  });

  it("startProcessSampler samples until stop and takes a final sample", async () => {
    const sampler = startProcessSampler({ rootPid: 100, intervalMs: 10, procRoot: root });
    await new Promise((r) => setTimeout(r, 35));
    const s = await sampler.stop();
    expect(s.samples).toBeGreaterThanOrEqual(3);
    expect(s.chromiumProcessesEver).toBe(3);
  });
});
