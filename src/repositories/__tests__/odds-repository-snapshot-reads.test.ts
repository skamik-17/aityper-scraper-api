import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeResponse, type RecordedQuery } from "../../__tests__/helpers/fake-supabase.js";

const db = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../config/database.js", async () => ({ getSupabase: () => db.client }));

import { getLastScrapeTime, getMatchInfoById } from "../odds-repository.js";

const ID = "premier-league:arsenal:hull city";
const INFO = { match_id: ID, home_team: "Arsenal", away_team: "Hull City", league_slug: "premier-league", start_time: "2026-11-08T15:00:00+00:00" };

let fake: ReturnType<typeof createFakeSupabase>;
function useFake(respond: (q: RecordedQuery) => FakeResponse) {
  fake = createFakeSupabase(respond);
  db.client = fake.client;
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  db.client = null;
});

describe("reads from the snapshot model (ODDS_WRITE_MODEL switched/snapshot)", () => {
  it.each(["switched", "snapshot"])("%s: getMatchInfoById reads the matches row", async (model) => {
    vi.stubEnv("ODDS_WRITE_MODEL", model);
    useFake(() => ({ data: [INFO] }));
    expect(await getMatchInfoById(ID)).toEqual(INFO);
    expect(fake.queries[0]).toMatchObject({ table: "matches" });
    expect(fake.queries[0].calls).toContainEqual(["select", "match_id, home_team, away_team, league_slug, start_time"]);
    expect(fake.queries[0].calls).toContainEqual(["eq", "match_id", ID]);
    expect(fake.queries[0].calls).toContainEqual(["limit", 1]);
  });

  it.each(["switched", "snapshot"])("%s: getLastScrapeTime reads odds_snapshot.last_seen_at and parses +00:00", async (model) => {
    vi.stubEnv("ODDS_WRITE_MODEL", model);
    useFake(() => ({ data: [{ last_seen_at: "2026-11-06T16:00:45.385+00:00" }] }));
    expect((await getLastScrapeTime("fortuna", "premier-league"))!.toISOString()).toBe("2026-11-06T16:00:45.385Z");
    expect(fake.queries[0].table).toBe("odds_snapshot");
    expect(fake.queries[0].calls).toContainEqual(["eq", "league_slug", "premier-league"]);
    expect(fake.queries[0].calls).toContainEqual(["eq", "bookmaker", "fortuna"]);
    expect(fake.queries[0].calls).toContainEqual(["order", "last_seen_at", { ascending: false }]);
    expect(fake.queries[0].calls).toContainEqual(["limit", 1]);
  });

  it("switched: the freshness error text is unchanged", async () => {
    vi.stubEnv("ODDS_WRITE_MODEL", "switched");
    useFake(() => ({ error: { message: "boom", code: "XX000" } }));
    await expect(getLastScrapeTime("fortuna", "premier-league")).rejects.toThrow("odds freshness query failed for fortuna: boom [XX000]");
  });

  it.each(["legacy", "dual"])("%s: both reads stay on table odds", async (model) => {
    vi.stubEnv("ODDS_WRITE_MODEL", model);
    useFake(() => ({ data: [] }));
    await getMatchInfoById(ID);
    await getLastScrapeTime("fortuna", "premier-league");
    expect(fake.queries.map((q) => q.table)).toEqual(["odds", "odds"]);
  });
});
