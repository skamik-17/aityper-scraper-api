import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { createFakeSupabase, type RecordedQuery } from "../../__tests__/helpers/fake-supabase.js";

const ROWS = JSON.parse(
  readFileSync(new URL("../../__tests__/fixtures/db/market-comparison-rows.json", import.meta.url), "utf8"),
) as Array<Record<string, unknown>>;
const { match_id: MATCH_ID, home_team: HOME, away_team: AWAY } = ROWS[0] as { match_id: string; home_team: string; away_team: string };

/** Serves the recorded rows page by page, as PostgREST would for the recorded `range` call. */
function respond(q: RecordedQuery) {
  const range = q.calls.find(([m]) => m === "range");
  const [from, to] = range ? (range.slice(1) as [number, number]) : [0, ROWS.length - 1];
  return { data: ROWS.slice(from, to + 1), error: null };
}

const h = vi.hoisted(() => ({ fake: undefined as unknown as ReturnType<typeof createFakeSupabase> }));
vi.mock("../../config/database.js", async () => ({ getSupabase: () => h.fake.client }));

import { getMatchOdds } from "../../repositories/odds-repository.js";
import { getOddsForMatch } from "../odds-service.js";

beforeEach(() => {
  h.fake = createFakeSupabase(respond);
});

describe("getMatchOdds reads one match by match_id (perf plan 09 Task 1)", () => {
  it("filters latest_odds by match_id, never by team names", async () => {
    await getMatchOdds(HOME, AWAY, "premier-league");
    expect(h.fake.queries[0].table).toBe("latest_odds");
    expect(h.fake.queries[0].calls).toContainEqual(["eq", "match_id", MATCH_ID]);
    expect(
      h.fake.queries[0].calls.filter(([m, c]) => m === "eq" && ["home_team", "away_team", "league_slug"].includes(c as string)),
    ).toEqual([]);
  });

  it("pages in a total order (market_key, then bookmaker)", async () => {
    await getMatchOdds(HOME, AWAY, "premier-league");
    expect(h.fake.queries[0].calls.filter(([m]) => m === "order").map(([, col]) => col)).toEqual(["market_key", "bookmaker"]);
  });

  it("getOddsForMatch output for the recorded rows is unchanged", async () => {
    await expect(JSON.stringify(await getOddsForMatch(HOME, AWAY, "premier-league"), null, 1)).toMatchFileSnapshot(
      "./__snapshots__/odds-for-match.json",
    );
  });
});
