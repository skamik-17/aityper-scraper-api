import { describe, it, expect } from "vitest";
import {
  detectOddsIntegrity,
  type IntegrityMarketInput,
  type IntegrityBookmakerQuotes,
  type OddsIntegrityFlag,
} from "../odds-integrity.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bmQuotes(
  bookmaker: string,
  quotes: Record<string, number>,
  canonical = true,
): IntegrityBookmakerQuotes {
  return {
    bookmaker,
    quotes: Object.entries(quotes).map(([selectionType, odds]) => ({
      selectionType,
      odds,
      canonical,
    })),
  };
}

function marketInput(
  bookmakers: IntegrityBookmakerQuotes[],
  overrides: Partial<IntegrityMarketInput> = {},
): IntegrityMarketInput {
  return {
    catalogSelections: null,
    vocabExempt: false,
    params: [{ param: "", bookmakers }],
    ...overrides,
  };
}

function byDetector(flags: OddsIntegrityFlag[], detector: string): OddsIntegrityFlag[] {
  return flags.filter((f) => f.detector === detector);
}

// ---------------------------------------------------------------------------
// impossible_odds
// ---------------------------------------------------------------------------

describe("detectOddsIntegrity — impossible_odds", () => {
  it("fires for 0 < odds <= 1.0", () => {
    const flags = detectOddsIntegrity(
      marketInput([bmQuotes("superbet", { YES: 0.5, NO: 1.0 })]),
    );
    const hits = byDetector(flags, "impossible_odds");
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ bookmaker: "superbet", expected: null });
  });

  it("does not fire for odds just above 1.0", () => {
    const flags = detectOddsIntegrity(marketInput([bmQuotes("sts", { YES: 1.01 })]));
    expect(byDetector(flags, "impossible_odds")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// decimal_shift (spec §3.5 ground truth: betclic 150 vs peers [46, 47, 50])
// ---------------------------------------------------------------------------

describe("detectOddsIntegrity — decimal_shift", () => {
  it("fires for betclic-style 150 vs peers [46, 47, 50] with expected near 47.7", () => {
    const flags = detectOddsIntegrity(
      marketInput([
        bmQuotes("betclic", { NONE: 150 }),
        bmQuotes("sts", { NONE: 46 }),
        bmQuotes("fortuna", { NONE: 47 }),
        bmQuotes("superbet", { NONE: 50 }),
      ]),
    );
    const hits = byDetector(flags, "decimal_shift");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      bookmaker: "betclic",
      selectionType: "NONE",
      odds: 150,
    });
    // Spec ground truth: expected ~= 47.7 (peer central tendency).
    expect(hits[0].expected).not.toBeNull();
    expect(Math.abs(hits[0].expected! - 47.7)).toBeLessThanOrEqual(1.5);
  });

  it("fires on an exact power-of-ten upshift (470 vs peers ~47)", () => {
    const flags = detectOddsIntegrity(
      marketInput([
        bmQuotes("betclic", { NONE: 470 }),
        bmQuotes("sts", { NONE: 46 }),
        bmQuotes("fortuna", { NONE: 47 }),
        bmQuotes("superbet", { NONE: 48 }),
      ]),
    );
    const hits = byDetector(flags, "decimal_shift");
    expect(hits).toHaveLength(1);
    expect(hits[0].bookmaker).toBe("betclic");
  });

  it("fires on a downshift (1.5 vs peers ~15)", () => {
    const flags = detectOddsIntegrity(
      marketInput([
        bmQuotes("betclic", { NONE: 1.5 }),
        bmQuotes("sts", { NONE: 14 }),
        bmQuotes("fortuna", { NONE: 15 }),
        bmQuotes("superbet", { NONE: 16 }),
      ]),
    );
    const hits = byDetector(flags, "decimal_shift");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ bookmaker: "betclic", odds: 1.5 });
  });

  it("does NOT fire on a legitimately disagreeing longshot pool [9, 12, 15, 11]", () => {
    const flags = detectOddsIntegrity(
      marketInput([
        bmQuotes("sts", { NONE: 9 }),
        bmQuotes("fortuna", { NONE: 12 }),
        bmQuotes("betclic", { NONE: 15 }),
        bmQuotes("superbet", { NONE: 11 }),
      ]),
    );
    expect(flags).toHaveLength(0);
  });

  it("requires at least 3 peers", () => {
    const flags = detectOddsIntegrity(
      marketInput([
        bmQuotes("betclic", { NONE: 150 }),
        bmQuotes("sts", { NONE: 46 }),
        bmQuotes("fortuna", { NONE: 47 }),
      ]),
    );
    expect(byDetector(flags, "decimal_shift")).toHaveLength(0);
  });

  it("only pools canonical selection codes", () => {
    const flags = detectOddsIntegrity(
      marketInput([
        bmQuotes("betclic", { "raw name": 150 }, false),
        bmQuotes("sts", { "raw name": 46 }, false),
        bmQuotes("fortuna", { "raw name": 47 }, false),
        bmQuotes("superbet", { "raw name": 50 }, false),
      ]),
    );
    expect(byDetector(flags, "decimal_shift")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// placeholder_odds (spec §3.5 ground truth: betcris 1501 across 6 players)
// ---------------------------------------------------------------------------

describe("detectOddsIntegrity — placeholder_odds", () => {
  it("fires for betcris-style 1501 repeated across 6 players while peers vary", () => {
    const players = ["P1", "P2", "P3", "P4", "P5", "P6"];
    const betcris = bmQuotes(
      "betcris",
      Object.fromEntries(players.map((p) => [p, 1501])),
      false,
    );
    const sts = bmQuotes(
      "sts",
      { P1: 3.5, P2: 5.0, P3: 7.5, P4: 9.0, P5: 11.0, P6: 13.0 },
      false,
    );
    const fortuna = bmQuotes(
      "fortuna",
      { P1: 3.6, P2: 5.2, P3: 7.2, P4: 9.5, P5: 10.5, P6: 12.5 },
      false,
    );
    const flags = detectOddsIntegrity(
      marketInput([betcris, sts, fortuna], { vocabExempt: true }),
    );
    const hits = byDetector(flags, "placeholder_odds");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    for (const hit of hits) {
      expect(hit.bookmaker).toBe("betcris");
      expect(hit.odds).toBe(1501);
    }
    // Nothing else should fire for the peers.
    expect(flags.every((f) => f.bookmaker === "betcris")).toBe(true);
  });

  it("fires when the same sub-1000 odds repeats across >=5 selections while peers vary", () => {
    const betcris = bmQuotes(
      "betcris",
      { P1: 2.0, P2: 2.0, P3: 2.0, P4: 2.0, P5: 2.0 },
      false,
    );
    const sts = bmQuotes("sts", { P1: 1.5, P2: 3.0, P3: 6.0, P4: 9.0, P5: 12.0 }, false);
    const flags = detectOddsIntegrity(marketInput([betcris, sts], { vocabExempt: true }));
    const hits = byDetector(flags, "placeholder_odds");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ bookmaker: "betcris", odds: 2.0 });
  });

  it("does NOT fire when peers agree with the repeated value", () => {
    const betcris = bmQuotes(
      "betcris",
      { P1: 1.9, P2: 1.9, P3: 1.9, P4: 1.9, P5: 1.9 },
      false,
    );
    const sts = bmQuotes("sts", { P1: 1.85, P2: 1.9, P3: 1.95, P4: 1.88, P5: 1.92 }, false);
    const flags = detectOddsIntegrity(marketInput([betcris, sts], { vocabExempt: true }));
    expect(byDetector(flags, "placeholder_odds")).toHaveLength(0);
  });

  it("does NOT fire the repeated-value rule with fewer than 5 repeats", () => {
    const betcris = bmQuotes("betcris", { P1: 2.0, P2: 2.0, P3: 2.0, P4: 2.0 }, false);
    const sts = bmQuotes("sts", { P1: 1.5, P2: 3.0, P3: 6.0, P4: 9.0 }, false);
    const flags = detectOddsIntegrity(marketInput([betcris, sts], { vocabExempt: true }));
    expect(byDetector(flags, "placeholder_odds")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// axis_swap (spec §3.5 ground truth: pzbuk 3.63/1.72 vs consensus ~1.6/~5.5)
// ---------------------------------------------------------------------------

const MATCH_WINNER = ["HOME", "DRAW", "AWAY"];

function pzbukSwapInput(peerCount = 4): IntegrityMarketInput {
  const peerVectors = [
    { HOME: 1.58, DRAW: 3.9, AWAY: 5.4 },
    { HOME: 1.6, DRAW: 4.0, AWAY: 5.5 },
    { HOME: 1.62, DRAW: 4.1, AWAY: 5.6 },
    { HOME: 1.6, DRAW: 4.0, AWAY: 5.5 },
  ].slice(0, peerCount);
  const peers = peerVectors.map((v, i) => bmQuotes(`peer${i}`, v));
  return marketInput([bmQuotes("pzbuk", { HOME: 3.63, DRAW: 4.0, AWAY: 1.72 }), ...peers], {
    catalogSelections: MATCH_WINNER,
  });
}

describe("detectOddsIntegrity — axis_swap", () => {
  it("fires for pzbuk-style HOME/AWAY swap against a 4-peer consensus", () => {
    const flags = detectOddsIntegrity(pzbukSwapInput());
    const hits = byDetector(flags, "axis_swap");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ bookmaker: "pzbuk", evidence: "HOME<->AWAY" });
    // Well-formed book on both sides: no overround noise.
    expect(byDetector(flags, "overround")).toHaveLength(0);
  });

  it("requires at least 4 fresh peer bookmakers", () => {
    const flags = detectOddsIntegrity(pzbukSwapInput(3));
    expect(byDetector(flags, "axis_swap")).toHaveLength(0);
  });

  it("does NOT fire when the vector is broken but matches no permutation", () => {
    const input = pzbukSwapInput();
    // HOME too long, AWAY too short as well -> no permutation of the median
    // vector fits within tolerance.
    input.params[0].bookmakers[0] = bmQuotes("pzbuk", { HOME: 3.63, DRAW: 4.0, AWAY: 3.6 });
    const flags = detectOddsIntegrity(input);
    expect(byDetector(flags, "axis_swap")).toHaveLength(0);
  });

  it("fires for a clean 2-way swap", () => {
    const peers = [0, 1, 2, 3].map((i) => bmQuotes(`peer${i}`, { HOME: 1.25, AWAY: 4.0 }));
    const flags = detectOddsIntegrity(
      marketInput([bmQuotes("pzbuk", { HOME: 4.0, AWAY: 1.25 }), ...peers], {
        catalogSelections: ["HOME", "AWAY"],
      }),
    );
    const hits = byDetector(flags, "axis_swap");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ bookmaker: "pzbuk", evidence: "HOME<->AWAY" });
  });

  it("does NOT fire for healthy peers", () => {
    const peers = [0, 1, 2, 3, 4].map((i) =>
      bmQuotes(`peer${i}`, { HOME: 1.6 + i * 0.01, DRAW: 4.0, AWAY: 5.5 - i * 0.02 }),
    );
    const flags = detectOddsIntegrity(marketInput(peers, { catalogSelections: MATCH_WINNER }));
    expect(byDetector(flags, "axis_swap")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// overround
// ---------------------------------------------------------------------------

describe("detectOddsIntegrity — overround", () => {
  const BTTS = ["YES", "NO"];

  it("fires when the implied-probability sum is below 0.95", () => {
    const flags = detectOddsIntegrity(
      marketInput([bmQuotes("sts", { YES: 4.0, NO: 4.0 })], { catalogSelections: BTTS }),
    );
    const hits = byDetector(flags, "overround");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ bookmaker: "sts", detector: "overround" });
    expect(hits[0].odds).toBeCloseTo(0.5, 3);
  });

  it("fires when the implied-probability sum is above 1.45", () => {
    const flags = detectOddsIntegrity(
      marketInput([bmQuotes("sts", { YES: 1.3, NO: 1.3 })], { catalogSelections: BTTS }),
    );
    expect(byDetector(flags, "overround")).toHaveLength(1);
  });

  it("does NOT fire for a healthy two-way book", () => {
    const flags = detectOddsIntegrity(
      marketInput([bmQuotes("sts", { YES: 1.9, NO: 1.9 })], { catalogSelections: BTTS }),
    );
    expect(byDetector(flags, "overround")).toHaveLength(0);
  });

  it("skips partial quotes", () => {
    const flags = detectOddsIntegrity(
      marketInput([bmQuotes("sts", { YES: 4.0 })], { catalogSelections: BTTS }),
    );
    expect(byDetector(flags, "overround")).toHaveLength(0);
  });

  it("skips dynamic-vocabulary markets", () => {
    const flags = detectOddsIntegrity(
      marketInput([bmQuotes("sts", { YES: 4.0, NO: 4.0 })], {
        catalogSelections: BTTS,
        vocabExempt: true,
      }),
    );
    expect(byDetector(flags, "overround")).toHaveLength(0);
  });

  it("skips overlapping-outcome markets (double chance) whose sums are ~2 by design", () => {
    const flags = detectOddsIntegrity(
      marketInput(
        [bmQuotes("sts", { HOME_OR_DRAW: 1.45, HOME_OR_AWAY: 1.53, DRAW_OR_AWAY: 1.27 })],
        { catalogSelections: ["HOME_OR_DRAW", "HOME_OR_AWAY", "DRAW_OR_AWAY"] },
      ),
    );
    expect(byDetector(flags, "overround")).toHaveLength(0);
  });

  it("defers to impossible_odds when the vector contains odds <= 1", () => {
    const flags = detectOddsIntegrity(
      marketInput([bmQuotes("sts", { YES: 0.5, NO: 1.9 })], { catalogSelections: BTTS }),
    );
    expect(byDetector(flags, "overround")).toHaveLength(0);
    expect(byDetector(flags, "impossible_odds")).toHaveLength(1);
  });
});
