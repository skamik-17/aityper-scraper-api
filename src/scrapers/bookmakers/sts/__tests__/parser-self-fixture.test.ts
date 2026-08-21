import { describe, it, expect } from "vitest";
import { parseFixtures } from "../parser.js";
import type { STSWebSocketData } from "../types.js";

/**
 * Regression coverage for one of the two ghost-match shapes: a WebSocket
 * frame where the home and away team names arrive already equal (observed
 * live, cause unknown - see the diagnosis notes). Nothing downstream of
 * parseFixtures ever checked home !== away before this fix, so a fixture
 * like this reached the API as "Manchester United vs Manchester United".
 */
function fixture(home: string, away: string) {
  const data: STSWebSocketData = {
    B: {
      S: {
        "1": {
          n: "Football",
          C: {
            "1": {
              n: "Anglia",
              T: {
                "17": {
                  n: "Premier League",
                  FX: {
                    f1: {
                      sid: 1,
                      t: "2026-08-22T14:00:00Z",
                      H: { n: home },
                      A: { n: away },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  return parseFixtures(data, "premier-league");
}

describe("STS parseFixtures: self-fixture guard", () => {
  it("drops a fixture whose home and away names are identical", () => {
    expect(fixture("Manchester United", "Manchester United")).toEqual([]);
  });

  it("drops a self-fixture regardless of case or surrounding whitespace", () => {
    expect(fixture("Sunderland", "  sunderland ")).toEqual([]);
  });

  it("keeps a genuine two-team fixture", () => {
    const fixtures = fixture("Hull City", "Manchester United");
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toMatchObject({ home: "Hull City", away: "Manchester United" });
  });
});
