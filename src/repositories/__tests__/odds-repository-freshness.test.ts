import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeResponse, type RecordedQuery } from "../../__tests__/helpers/fake-supabase.js";

const db = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../config/database.js", async () => ({ getSupabase: () => db.client }));

import { getOddsFreshnessByBookmaker } from "../odds-repository.js";

const shapes = JSON.parse(
  readFileSync(
    new URL("../../services/__tests__/fixtures/observability/db-error-shapes-2026-11-06.json", import.meta.url),
    "utf8",
  ),
);

// Latest scraped_at per bookmaker as PostgREST returned it (db-probe §3).
const LATEST: Record<string, string> = {
  sts: "2026-11-06T16:02:49.048+00:00",
  fortuna: "2026-11-06T16:00:45.385+00:00",
};

let fake: ReturnType<typeof createFakeSupabase>;

function useFake(respond: (q: RecordedQuery) => FakeResponse) {
  fake = createFakeSupabase(respond);
  db.client = fake.client;
}

const bookmakerOf = (q: RecordedQuery) =>
  q.calls.find(([method, column]) => method === "eq" && column === "bookmaker")?.[2] as string;

afterEach(() => {
  vi.unstubAllEnvs();
  db.client = null;
});

describe("getOddsFreshnessByBookmaker", () => {
  it("issues one limit(1) query per bookmaker instead of an unbounded scan", async () => {
    useFake((q) => {
      const latest = LATEST[bookmakerOf(q)];
      return { data: latest ? [{ scraped_at: latest }] : [] }; // totalbet has no odds rows
    });
    const m = await getOddsFreshnessByBookmaker("premier-league", ["sts", "fortuna", "totalbet"]);
    expect(fake.queries).toHaveLength(3);
    for (const q of fake.queries) {
      expect(q.table).toBe("odds");
      expect(q.calls).toContainEqual(["eq", "league_slug", "premier-league"]);
      expect(q.calls).toContainEqual(["order", "scraped_at", { ascending: false }]);
      expect(q.calls).toContainEqual(["limit", 1]);
    }
    expect(fake.queries.map(bookmakerOf)).toEqual(["sts", "fortuna", "totalbet"]);
    expect(m.get("fortuna")!.toISOString()).toBe("2026-11-06T16:00:45.385Z");
    expect(m.get("sts")!.toISOString()).toBe("2026-11-06T16:02:49.048Z");
    expect(m.has("totalbet")).toBe(false);
  });

  it("rejects when PostgREST errors, so the snapshot falls back to all-stale", async () => {
    useFake(() => ({ error: shapes.econnrefused }));
    await expect(getOddsFreshnessByBookmaker("premier-league", ["sts"])).rejects.toThrow(
      "odds freshness query failed for sts: TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:54321)",
    );
  });

  it("after the switch, one limit(1) query per bookmaker on odds_snapshot.last_seen_at", async () => {
    vi.stubEnv("ODDS_WRITE_MODEL", "switched");
    useFake((q) => {
      const latest = LATEST[bookmakerOf(q)];
      return { data: latest ? [{ last_seen_at: latest }] : [] };
    });
    const m = await getOddsFreshnessByBookmaker("premier-league", ["sts", "fortuna", "totalbet"]);
    expect(fake.queries).toHaveLength(3);
    for (const q of fake.queries) {
      expect(q.table).toBe("odds_snapshot");
      expect(q.calls).toContainEqual(["eq", "league_slug", "premier-league"]);
      expect(q.calls).toContainEqual(["order", "last_seen_at", { ascending: false }]);
      expect(q.calls).toContainEqual(["limit", 1]);
    }
    expect(m.get("fortuna")!.toISOString()).toBe("2026-11-06T16:00:45.385Z");
    expect(m.has("totalbet")).toBe(false);
  });
});
