/**
 * Whether the running server is scraping (or about to), read from /api/health, so a
 * process that persists outside the coordinator (smoke-bookmaker --persist) never
 * overlaps a scheduled run. Never throws.
 */
export type CurrentRunProbe =
  | { state: "idle"; nextScrapeAt: string | null }
  | { state: "running"; run: { runId: string; trigger: string; startedAt: string } }
  | { state: "due"; nextScrapeAt: string }
  | { state: "unreachable"; error: string };

/** A run due within this window counts as running. */
const DUE_WINDOW_MS = 300_000;

export async function probeCurrentRun(
  healthUrl: string,
  deps: { fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number } = {},
): Promise<CurrentRunProbe> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  try {
    const res = await fetchImpl(healthUrl, { signal: AbortSignal.timeout(deps.timeoutMs ?? 2_000) });
    if (!res.ok) return { state: "unreachable", error: `HTTP ${res.status}` };
    const body = (await res.json()) as { data?: { currentRun?: { runId: string; trigger: string; startedAt: string } | null; nextScrapeAt?: string | null } };
    const data = body.data ?? {};
    if (data.currentRun) {
      const { runId, trigger, startedAt } = data.currentRun;
      return { state: "running", run: { runId, trigger, startedAt } };
    }
    const next = typeof data.nextScrapeAt === "string" ? data.nextScrapeAt : null;
    if (next !== null && Date.parse(next) - now() <= DUE_WINDOW_MS) return { state: "due", nextScrapeAt: next };
    return { state: "idle", nextScrapeAt: next };
  } catch (error) {
    return { state: "unreachable", error: error instanceof Error ? error.message : String(error) };
  }
}
