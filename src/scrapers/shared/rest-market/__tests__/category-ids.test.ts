import { describe, expect, it } from "vitest";
import { getBookmakerLeagueId, getSupportedLeagues } from "../../../../config/leagues.js";
import type { PolishBookmaker } from "../../../../config/index.js";
import { CATEGORY_IDS as BETFAN } from "../../../bookmakers/betfan/constants.js";
import { CATEGORY_IDS as ETOTO } from "../../../bookmakers/etoto/constants.js";
import { CATEGORY_IDS as FORBET } from "../../../bookmakers/forbet/constants.js";
import { CATEGORY_IDS as FUKSIARZ } from "../../../bookmakers/fuksiarz/constants.js";

const BY_BRAND: Record<string, Record<string, number | string>> = { etoto: ETOTO, forbet: FORBET, fuksiarz: FUKSIARZ, betfan: BETFAN };

// Guard: the brands' own category tables must stay equal to src/config/leagues.ts.
describe("rest-market category ids", () => {
  it.each(["etoto", "forbet", "fuksiarz", "betfan"] as PolishBookmaker[])("%s CATEGORY_IDS equal src/config/leagues.ts", (bm) => {
    expect(Object.fromEntries(getSupportedLeagues(bm).map((s) => [s, getBookmakerLeagueId(s, bm)]))).toEqual(BY_BRAND[bm]);
  });
});
