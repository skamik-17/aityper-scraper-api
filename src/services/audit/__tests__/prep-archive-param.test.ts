import { it, expect } from "vitest";
import { buildPrepAuditOutput } from "../scraper-audit-core.js";
import { betcrisNormalizer } from "../../normalization/bookmakers/betcris-normalizer.js";

const ctx = { homeTeam: "Everton", awayTeam: "Coventry City", league: "premier-league", leagueName: "premier-league" };
const meta = { matchId: "31321159", homeTeam: "Everton", awayTeam: "Coventry City", league: "premier-league" };
it("prep archive keeps raw.paramValue so split ladder rungs and players survive harvesting", () => {
  const out = buildPrepAuditOutput({ normalizer: betcrisNormalizer, ctx, meta, rawMarkets: [
    { name: "Faule. Suma", bookmakerMarketId: "FoulsTotal", paramValue: "21.5", selections: [{ name: "Powyżej", odds: 1.46 }] },
    { name: "Zawodnik - strzały", bookmakerMarketId: "PlayerShots", paramValue: "Ainsley Maitland-Niles", selections: [{ name: "1+", odds: 1.46 }, { name: "2+", odds: 3.1 }] },
    { name: "Dokładna liczba goli", bookmakerMarketId: "TotalGoalsExact", selections: [{ name: " 0", odds: 10.7 }, { name: " 1", odds: 4.57 }] },
  ] });
  expect(out.markets.map((m) => m.raw.paramValue)).toEqual(["21.5", "Ainsley Maitland-Niles", undefined]);
  expect(out.markets.map((m) => m.normalized.marketKey).slice(0, 2)).toEqual(["FOULS_TOTAL:21.5", "PLAYER_SHOTS:Ainsley Maitland-Niles"]);
  expect("paramValue" in out.markets[2].raw).toBe(false); // absent, not null: old archives/fixtures stay byte-identical
});
