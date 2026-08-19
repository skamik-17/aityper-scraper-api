import { describe, it, expect } from "vitest";
import {
  findLadderBreaks,
  findOutliers,
  findArbitrage,
  isExclusiveSelectionSet,
} from "../../../scripts/odds-outliers.js";

const ARGS = { dev: 0.35, minBooks: 4 } as Parameters<typeof findOutliers>[2];

function market(overrides: Record<string, unknown> = {}) {
  return {
    marketKey: "TOTAL_GOALS",
    type: "TOTAL_GOALS",
    category: "GOLE",
    label: "Liczba goli",
    parameters: [],
    ...overrides,
  } as Parameters<typeof findLadderBreaks>[0];
}

function param(value: string, quotes: Array<[string, string, number]>) {
  const byBookmaker = new Map<string, { bookmaker: string; selections: { type: string; odds: number }[] }>();
  for (const [bookmaker, type, odds] of quotes) {
    const entry = byBookmaker.get(bookmaker) ?? { bookmaker, selections: [] };
    entry.selections.push({ type, odds });
    byBookmaker.set(bookmaker, entry);
  }
  return { value, label: value, bookmakers: [...byBookmaker.values()] };
}

describe("findOutliers", () => {
  it("flags a quote far from the peer median and names the bookmaker", () => {
    const m = market({
      parameters: [
        param("2.5", [
          ["sts", "OVER", 1.55],
          ["betcris", "OVER", 1.54],
          ["etoto", "OVER", 1.56],
          ["forbet", "OVER", 1.53],
          ["pzbuk", "OVER", 3.83],
        ]),
      ],
    });
    const findings = findOutliers(m, "GOLE/TOTAL_GOALS", ARGS);
    expect(findings).toHaveLength(1);
    expect(findings[0].bookmaker).toBe("pzbuk");
    expect(findings[0].odds).toBe(3.83);
  });

  it("stays quiet when the field simply disagrees a little", () => {
    const m = market({
      parameters: [
        param("2.5", [
          ["sts", "OVER", 1.55],
          ["betcris", "OVER", 1.6],
          ["etoto", "OVER", 1.5],
          ["forbet", "OVER", 1.62],
        ]),
      ],
    });
    expect(findOutliers(m, "GOLE/TOTAL_GOALS", ARGS)).toHaveLength(0);
  });

  it("does not judge a pool thinner than --min-books", () => {
    const m = market({
      parameters: [
        param("2.5", [
          ["sts", "OVER", 1.55],
          ["pzbuk", "OVER", 9.0],
        ]),
      ],
    });
    expect(findOutliers(m, "GOLE/TOTAL_GOALS", ARGS)).toHaveLength(0);
  });
});

describe("findLadderBreaks", () => {
  // The pzbuk first-half 0.5 inversion had exactly this shape, and only one
  // bookmaker quoted it — there was no peer to compare against.
  it("flags a price that moves the wrong way along the line", () => {
    const m = market({
      parameters: [
        param("0.5", [["pzbuk", "OVER", 3.83]]),
        param("1.5", [["pzbuk", "OVER", 2.6]]),
      ],
    });
    const findings = findLadderBreaks(m, "POLOWY/HALF_TIME_TOTAL_GOALS");
    expect(findings).toHaveLength(1);
    expect(findings[0].bookmaker).toBe("pzbuk");
    expect(findings[0].severity).toBe("BROKEN");
  });

  it("accepts a correctly ordered ladder", () => {
    const m = market({
      parameters: [
        param("0.5", [["sts", "OVER", 1.02], ["sts", "UNDER", 17]]),
        param("1.5", [["sts", "OVER", 1.18], ["sts", "UNDER", 4.7]]),
        param("2.5", [["sts", "OVER", 1.55], ["sts", "UNDER", 2.32]]),
      ],
    });
    expect(findLadderBreaks(m, "GOLE/TOTAL_GOALS")).toHaveLength(0);
  });

  it("ignores a tie between neighbouring lines", () => {
    const m = market({
      parameters: [
        param("3.5", [["sts", "OVER", 2.35]]),
        param("4.0", [["sts", "OVER", 2.34]]),
      ],
    });
    expect(findLadderBreaks(m, "GOLE/TOTAL_GOALS")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Market-type-aware ladder direction
// (round8-detector-patches: P1-ladder-time-window-direction,
// P2-ladder-strict-param-parse-and-subline-key,
// ladder-direction-per-market-type, ladder-exempt-nonmonotonic-markets)
// ---------------------------------------------------------------------------

describe("findLadderBreaks — market-type-aware direction (false-alarm regression)", () => {
  // round8 P1: fuksiarz "goals in the first N minutes" ladder — a WIDER
  // time window can only add goal chances, so OVER gets SHORTER (not
  // longer) and UNDER gets LONGER as the parameter grows. The default
  // LADDER_DIRECTION assumes the opposite (a goal LINE), which used to
  // flag every single step of this market as broken.
  it("accepts the inverted direction for a time-window parameter (GOLE/TIME_PERIOD_TOTAL_GOALS)", () => {
    const m = market({
      marketKey: "TIME_PERIOD_TOTAL_GOALS",
      type: "TIME_PERIOD_TOTAL_GOALS",
      category: "GOLE",
      parameters: [
        param("5", [["fuksiarz", "OVER", 5.3], ["fuksiarz", "UNDER", 1.11]]),
        param("10", [["fuksiarz", "OVER", 3.3], ["fuksiarz", "UNDER", 1.27]]),
        param("15", [["fuksiarz", "OVER", 2.5], ["fuksiarz", "UNDER", 1.45]]),
        param("30", [["fuksiarz", "OVER", 1.58], ["fuksiarz", "UNDER", 2.2]]),
      ],
    });
    expect(findLadderBreaks(m, "GOLE/TIME_PERIOD_TOTAL_GOALS")).toHaveLength(0);
  });

  it("still flags a genuine inversion within a time-window ladder (GOLE/TIME_PERIOD_TOTAL_GOALS)", () => {
    const m = market({
      marketKey: "TIME_PERIOD_TOTAL_GOALS",
      type: "TIME_PERIOD_TOTAL_GOALS",
      category: "GOLE",
      parameters: [
        // A wider window with a LONGER OVER price is the wrong direction
        // even under the inverted rule.
        param("5", [["fuksiarz", "OVER", 5.3]]),
        param("10", [["fuksiarz", "OVER", 8.0]]),
      ],
    });
    const findings = findLadderBreaks(m, "GOLE/TIME_PERIOD_TOTAL_GOALS");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("BROKEN");
  });

  // round8 P2: the "16-30"/"11-20" style disjoint band parameters that
  // TIME_PERIOD_TOTAL_GOALS also carries must not be parsed as a numeric
  // rung (parseFloat("16-30") = 16 would splice a disjoint bucket into the
  // middle of the real 5/10/15/30/60/75-minute ladder).
  it("ignores a disjoint band parameter instead of splicing it into the ladder", () => {
    const m = market({
      marketKey: "TIME_PERIOD_TOTAL_GOALS",
      type: "TIME_PERIOD_TOTAL_GOALS",
      category: "GOLE",
      parameters: [
        param("15", [["fuksiarz", "OVER", 2.5]]),
        // If parsed as line=16 this would sit between "15" and "30" with an
        // odds value that breaks monotonicity on both sides.
        param("16-30", [["fuksiarz", "OVER", 1.05]]),
        param("30", [["fuksiarz", "OVER", 1.58]]),
      ],
    });
    expect(findLadderBreaks(m, "GOLE/TIME_PERIOD_TOTAL_GOALS")).toHaveLength(0);
  });

  // round8 P2: sub-lines ("60" vs "60 (1.5)") describe the SAME window at a
  // different goal line and must not collapse into one series, or two
  // unrelated prices get compared as neighbours.
  it("keeps parenthesised sub-lines in separate series", () => {
    const m = market({
      marketKey: "TIME_PERIOD_TOTAL_GOALS",
      type: "TIME_PERIOD_TOTAL_GOALS",
      category: "GOLE",
      parameters: [
        param("60", [["fuksiarz", "OVER", 1.12]]),
        param("75", [["fuksiarz", "OVER", 1.05]]),
        param("60 (1.5)", [["fuksiarz", "OVER", 2.34]]),
        param("75 (1.5)", [["fuksiarz", "OVER", 1.9]]),
      ],
    });
    // Both sub-lines fall consistently with the inverted (time-window)
    // direction; collapsing "60"/"60 (1.5)" into one series would instead
    // read as an odds jump 1.12 -> 2.34 at the "same" line and misfire.
    expect(findLadderBreaks(m, "GOLE/TIME_PERIOD_TOTAL_GOALS")).toHaveLength(0);
  });

  // round8 ladder-direction-per-market-type: YES/NO is a shape, not a
  // direction. BOTH_HALVES_UNDER_GOALS's YES means "...and UNDER X", so
  // raising the line only adds favourable outcomes — P(YES) rises and its
  // price must FALL, the mirror image of the LADDER_DIRECTION default.
  it("accepts the per-market-type override for a YES=cumulative-under shape (GOLE/BOTH_HALVES_UNDER_GOALS)", () => {
    const m = market({
      marketKey: "BOTH_HALVES_UNDER_GOALS",
      type: "BOTH_HALVES_UNDER_GOALS",
      category: "GOLE",
      parameters: [
        param("1.5", [["lebull", "YES", 2.71], ["lebull", "NO", 1.28]]),
        param("2.5", [["lebull", "YES", 1.45], ["lebull", "NO", 2.2]]),
        param("3.5", [["lebull", "YES", 1.09], ["lebull", "NO", 4.25]]),
      ],
    });
    expect(findLadderBreaks(m, "GOLE/BOTH_HALVES_UNDER_GOALS")).toHaveLength(0);
  });

  it("still flags a genuine break under the per-market-type override", () => {
    const m = market({
      marketKey: "BOTH_HALVES_UNDER_GOALS",
      type: "BOTH_HALVES_UNDER_GOALS",
      category: "GOLE",
      parameters: [
        // YES must fall as the line rises; here it rises instead.
        param("1.5", [["lebull", "YES", 1.45]]),
        param("2.5", [["lebull", "YES", 2.71]]),
      ],
    });
    const findings = findLadderBreaks(m, "GOLE/BOTH_HALVES_UNDER_GOALS");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("BROKEN");
  });

  // round8 ladder-exempt-nonmonotonic-markets: an exact-value market prices
  // one bucket, not a cumulative tail — the price is U-shaped in the line by
  // construction, so no monotonic rule ever applies.
  it("exempts a U-shaped exact-value market entirely", () => {
    const m = market({
      marketKey: "EXACT_GOALS_COUNT_YN",
      type: "EXACT_GOALS_COUNT_YN",
      category: "GOLE",
      parameters: [
        // Cheap in the middle of the distribution, long at both ends — this
        // would break the default YES:"rises" rule between "2" and "3".
        param("1", [["fuksiarz", "YES", 9.0]]),
        param("2", [["fuksiarz", "YES", 3.5]]),
        param("3", [["fuksiarz", "YES", 4.2]]),
      ],
    });
    expect(findLadderBreaks(m, "GOLE/EXACT_GOALS_COUNT_YN")).toHaveLength(0);
  });
});

describe("isExclusiveSelectionSet", () => {
  it("accepts mutually exclusive outcomes", () => {
    expect(isExclusiveSelectionSet(["HOME", "DRAW", "AWAY"])).toBe(true);
    expect(isExclusiveSelectionSet(["YES", "NO"])).toBe(true);
    expect(isExclusiveSelectionSet(["OVER", "UNDER"])).toBe(true);
  });

  it("rejects cumulative ladders and nested ranges", () => {
    // "2+ shots" is contained in "1+ shots", so their prices never sum to 1.
    expect(isExclusiveSelectionSet(["1+", "2+", "3+"])).toBe(false);
    expect(isExclusiveSelectionSet(["0-1", "0-2", "0-3"])).toBe(false);
  });
});

describe("findArbitrage", () => {
  it("flags a selection set whose best prices cannot both be right", () => {
    const m = market({
      marketKey: "BTTS",
      type: "BTTS",
      parameters: [param("", [["forbet", "YES", 11], ["etoto", "NO", 4.5]])],
    });
    const findings = findArbitrage(m, "GOLE/BTTS");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("BROKEN");
  });

  it("stays quiet on a normally priced pair", () => {
    const m = market({
      marketKey: "BTTS",
      type: "BTTS",
      parameters: [param("", [["forbet", "YES", 2.36], ["etoto", "NO", 1.52]])],
    });
    expect(findArbitrage(m, "GOLE/BTTS")).toHaveLength(0);
  });

  // round8-detector-patches PM-2 (arsenal-vs-coventry-city, GOLE/PENALTY_MISSED):
  // betcris prices "misses a penalty" per team (HOME=14, AWAY=46) — an
  // independent per-team YES prop, not a partition of the outcome space. The
  // dominant "no penalty at all" branch (its own book prices that at 1.31 =
  // 76%) is never in this selection set, so summing HOME+AWAY is meaningless
  // and must not be read as an arbitrage / mis-mapped price.
  it("does not sum a non-exhaustive per-team prop set (PENALTY_MISSED)", () => {
    const m = market({
      marketKey: "PENALTY_MISSED",
      type: "PENALTY_MISSED",
      category: "GOLE",
      parameters: [param("", [["betcris", "HOME", 14], ["betcris", "AWAY", 46]])],
    });
    expect(findArbitrage(m, "GOLE/PENALTY_MISSED")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Absolute / tail probability floor for BROKEN escalation
// (round8-detector-patches: det-abs-prob-floor, det-abs-floor,
// DET-TAIL-PROB-FLOOR, det-abs-gap-floor, WM-1-abs-delta-floor,
// DCT-D1-longshot-abs-floor, CS-DET-1, ceiling-aware-outliers,
// detector-ceiling-clamp-guard, multi-result-overmargin-guard)
//
// Relative deviation of the implied probability explodes in the deep tail
// even for genuine, faithfully-scraped prices — a house ceiling, or simple
// model disagreement between books on a longshot. BROKEN now additionally
// requires either a real probability gap (>= 5 p.p.) or a non-tail reference
// median; each case below is a real false alarm from the Arsenal vs Coventry
// City audit (round 8), pinned as a regression against the fix regressing.
// ---------------------------------------------------------------------------

describe("findOutliers — absolute/tail probability floor (false-alarm regression)", () => {
  it("downgrades a house-ceiling price on a deep longshot grid (DOKLADNY_WYNIK/CORRECT_SCORE)", () => {
    // fortuna caps its correct-score tail at 100 while peers price the same
    // cell around 300 — a real, faithful ceiling price, not a mapping bug.
    const m = market({
      marketKey: "CORRECT_SCORE",
      type: "CORRECT_SCORE",
      category: "DOKLADNY_WYNIK",
      parameters: [
        param("base", [
          ["sts", "0-4", 300],
          ["betclic", "0-4", 300],
          ["superbet", "0-4", 300],
          ["pzbuk", "0-4", 300],
          ["fortuna", "0-4", 100],
        ]),
      ],
    });
    const findings = findOutliers(m, "DOKLADNY_WYNIK/CORRECT_SCORE", ARGS);
    const fortunaFinding = findings.find((f) => f.bookmaker === "fortuna");
    expect(fortunaFinding).toBeDefined();
    expect(fortunaFinding!.severity).toBe("MAJOR");
  });

  it("downgrades a house-ceiling price on a combined HT/FT grid (DOKLADNY_WYNIK/HT_FT_CORRECT_SCORE)", () => {
    const m = market({
      marketKey: "HT_FT_CORRECT_SCORE",
      type: "HT_FT_CORRECT_SCORE",
      category: "DOKLADNY_WYNIK",
      parameters: [
        param("base", [
          ["sts", "0:0 / 0:3", 290],
          ["betcris", "0:0 / 0:3", 283],
          ["superbet", "0:0 / 0:3", 295],
          ["pzbuk", "0:0 / 0:3", 288],
          ["etoto", "0:0 / 0:3", 100],
        ]),
      ],
    });
    const findings = findOutliers(m, "DOKLADNY_WYNIK/HT_FT_CORRECT_SCORE", ARGS);
    const etotoFinding = findings.find((f) => f.bookmaker === "etoto");
    expect(etotoFinding).toBeDefined();
    expect(etotoFinding!.severity).toBe("MAJOR");
  });

  it("downgrades a per-param house ceiling (KOMBINACJE/HALFTIME_FULLTIME_AND_TOTAL)", () => {
    // etoto caps every HT/FT + total-goals cell at 100 for this parameter
    // while peers price it around 250 — the same ceiling artefact, one param.
    const m = market({
      marketKey: "HALFTIME_FULLTIME_AND_TOTAL",
      type: "HALFTIME_FULLTIME_AND_TOTAL",
      category: "KOMBINACJE",
      parameters: [
        param("4.5", [
          ["sts", "HOME_DRAW_OVER", 260],
          ["betcris", "HOME_DRAW_OVER", 255],
          ["superbet", "HOME_DRAW_OVER", 250],
          ["pzbuk", "HOME_DRAW_OVER", 258],
          ["etoto", "HOME_DRAW_OVER", 100],
        ]),
      ],
    });
    const findings = findOutliers(m, "KOMBINACJE/HALFTIME_FULLTIME_AND_TOTAL", ARGS);
    const etotoFinding = findings.find((f) => f.bookmaker === "etoto");
    expect(etotoFinding).toBeDefined();
    expect(etotoFinding!.severity).toBe("MAJOR");
  });

  it("downgrades a small absolute gap that reads huge in relative terms (KOMBINACJE/HALFTIME_FULLTIME)", () => {
    // betfan/forbet/fuksiarz all quote HOME_AWAY at 50 while the peer field
    // sits around 136 — 200%+ relative deviation, but only 1.3 percentage
    // points of implied probability apart.
    const m = market({
      marketKey: "HALFTIME_FULLTIME",
      type: "HALFTIME_FULLTIME",
      category: "KOMBINACJE",
      parameters: [
        param("base", [
          ["lebull", "HOME_AWAY", 136],
          ["sts", "HOME_AWAY", 136],
          ["superbet", "HOME_AWAY", 136],
          ["pzbuk", "HOME_AWAY", 136],
          ["betfan", "HOME_AWAY", 50],
        ]),
      ],
    });
    const findings = findOutliers(m, "KOMBINACJE/HALFTIME_FULLTIME", ARGS);
    const betfanFinding = findings.find((f) => f.bookmaker === "betfan");
    expect(betfanFinding).toBeDefined();
    expect(betfanFinding!.severity).toBe("MAJOR");
  });

  it("downgrades a shorter-than-field price on a parametric combo grid (KOMBINACJE/RESULT_AND_TOTAL)", () => {
    // lebull DRAW_OVER 25 vs a peer field around 95 on the "result and total
    // 4.5" grid — a real published price, not a shifted line.
    const m = market({
      marketKey: "RESULT_AND_TOTAL",
      type: "RESULT_AND_TOTAL",
      category: "KOMBINACJE",
      parameters: [
        param("4.5", [
          ["sts", "DRAW_OVER", 95],
          ["betcris", "DRAW_OVER", 95],
          ["superbet", "DRAW_OVER", 95],
          ["pzbuk", "DRAW_OVER", 95],
          ["lebull", "DRAW_OVER", 25],
        ]),
      ],
    });
    const findings = findOutliers(m, "KOMBINACJE/RESULT_AND_TOTAL", ARGS);
    const lebullFinding = findings.find((f) => f.bookmaker === "lebull");
    expect(lebullFinding).toBeDefined();
    expect(lebullFinding!.severity).toBe("MAJOR");
  });

  it("downgrades a player longshot even when the absolute gap is large, via the tail-median floor (ZAWODNICY/PLAYER_SHOTS)", () => {
    // superbet prices "Tzolis 7+ shots" at 5.35 (its own combo-bet tickets
    // confirm this is a genuine, self-consistent price) while the peer field
    // sits at 18.00 — an 18-point relative deviation AND a 13-point absolute
    // gap, both explained by ordinary tail-model disagreement once the
    // reference median itself is this deep (< 10% implied probability).
    const m = market({
      marketKey: "PLAYER_SHOTS",
      type: "PLAYER_SHOTS",
      category: "ZAWODNICY",
      parameters: [
        param("Christos Tzolis", [
          ["sts", "7+", 18],
          ["betcris", "7+", 18],
          ["etoto", "7+", 18],
          ["pzbuk", "7+", 18],
          ["superbet", "7+", 5.35],
        ]),
      ],
    });
    const findings = findOutliers(m, "ZAWODNICY/PLAYER_SHOTS", ARGS);
    const superbetFinding = findings.find((f) => f.bookmaker === "superbet");
    expect(superbetFinding).toBeDefined();
    expect(superbetFinding!.severity).toBe("MAJOR");
  });

  it("downgrades a small absolute gap on a first-half combo prop (POLOWY/HALF_TIME_RESULT_AND_BTTS)", () => {
    // fuksiarz/betcris/lvbet all price AWAY_YES around 30-31 vs a peer field
    // of 80 — only ~2 percentage points of implied probability apart.
    const m = market({
      marketKey: "HALF_TIME_RESULT_AND_BTTS",
      type: "HALF_TIME_RESULT_AND_BTTS",
      category: "POLOWY",
      parameters: [
        param("base", [
          ["sts", "AWAY_YES", 80],
          ["superbet", "AWAY_YES", 80],
          ["pzbuk", "AWAY_YES", 80],
          ["etoto", "AWAY_YES", 80],
          ["fuksiarz", "AWAY_YES", 30],
        ]),
      ],
    });
    const findings = findOutliers(m, "POLOWY/HALF_TIME_RESULT_AND_BTTS", ARGS);
    const fuksiarzFinding = findings.find((f) => f.bookmaker === "fuksiarz");
    expect(fuksiarzFinding).toBeDefined();
    expect(fuksiarzFinding!.severity).toBe("MAJOR");
  });

  it("downgrades a merged-selection longshot price (GOLE/WINNING_MARGIN)", () => {
    // fuksiarz merges "by 3" and "by 4+" into AWAY_BY_3PLUS via implied-
    // probability addition (1/(1/30+1/30) = 15) — a real synthetic price
    // deep in the tail, not a decimal shift.
    const m = market({
      marketKey: "WINNING_MARGIN",
      type: "WINNING_MARGIN",
      category: "GOLE",
      parameters: [
        param("base", [
          ["sts", "AWAY_BY_3PLUS", 300],
          ["betfan", "AWAY_BY_3PLUS", 310],
          ["etoto", "AWAY_BY_3PLUS", 305],
          ["forbet", "AWAY_BY_3PLUS", 295],
          ["fuksiarz", "AWAY_BY_3PLUS", 15],
        ]),
      ],
    });
    const findings = findOutliers(m, "GOLE/WINNING_MARGIN", ARGS);
    const fuksiarzFinding = findings.find((f) => f.bookmaker === "fuksiarz");
    expect(fuksiarzFinding).toBeDefined();
    expect(fuksiarzFinding!.severity).toBe("MAJOR");
  });

  it("downgrades a longshot double-chance-and-total price via the tail-median floor (KOMBINACJE/DOUBLE_CHANCE_TOTAL)", () => {
    // lebull X2_OVER@4.5 = 14.3 vs a peer field of 90 — 5.9 points of
    // absolute gap AND a tail (< 10%) reference median.
    const m = market({
      marketKey: "DOUBLE_CHANCE_TOTAL",
      type: "DOUBLE_CHANCE_TOTAL",
      category: "KOMBINACJE",
      parameters: [
        param("4.5", [
          ["sts", "X2_OVER", 90],
          ["betcris", "X2_OVER", 90],
          ["etoto", "X2_OVER", 90],
          ["pzbuk", "X2_OVER", 90],
          ["lebull", "X2_OVER", 14.3],
        ]),
      ],
    });
    const findings = findOutliers(m, "KOMBINACJE/DOUBLE_CHANCE_TOTAL", ARGS);
    const lebullFinding = findings.find((f) => f.bookmaker === "lebull");
    expect(lebullFinding).toBeDefined();
    expect(lebullFinding!.severity).toBe("MAJOR");
  });

  it("downgrades an over-margined book's uniformly-short combination prices (KOMBINACJE/MULTI_RESULT)", () => {
    // betcris/lvbet run a much heavier margin on this egzotic combinations
    // grid, so every cell reads short vs the field — a book-level pricing
    // choice, not a per-cell mapping bug.
    const m = market({
      marketKey: "MULTI_RESULT",
      type: "MULTI_RESULT",
      category: "KOMBINACJE",
      parameters: [
        param("base", [
          ["etoto", "1:2, 1:3 lub 1:4", 40],
          ["fortuna", "1:2, 1:3 lub 1:4", 40],
          ["sts", "1:2, 1:3 lub 1:4", 42],
          ["superbet", "1:2, 1:3 lub 1:4", 36],
          ["betcris", "1:2, 1:3 lub 1:4", 15],
        ]),
      ],
    });
    const findings = findOutliers(m, "KOMBINACJE/MULTI_RESULT", ARGS);
    const betcrisFinding = findings.find((f) => f.bookmaker === "betcris");
    expect(betcrisFinding).toBeDefined();
    expect(betcrisFinding!.severity).toBe("MAJOR");
  });

  it("still flags a genuine short-market mismapping as BROKEN (floor does not apply outside the tail)", () => {
    // A near-certain price (1.15) where the field prices the outcome at
    // 3.00 is exactly the shape of an axis-swap / decimal-shift bug on a
    // mainstream market — the reference median here is nowhere near the
    // tail (33% implied probability), so neither floor should apply.
    const m = market({
      parameters: [
        param("2.5", [
          ["sts", "OVER", 3.0],
          ["betcris", "OVER", 3.0],
          ["etoto", "OVER", 3.0],
          ["forbet", "OVER", 3.0],
          ["pzbuk", "OVER", 1.15],
        ]),
      ],
    });
    const findings = findOutliers(m, "GOLE/TOTAL_GOALS", ARGS);
    const pzbukFinding = findings.find((f) => f.bookmaker === "pzbuk");
    expect(pzbukFinding).toBeDefined();
    expect(pzbukFinding!.severity).toBe("BROKEN");
  });
});
