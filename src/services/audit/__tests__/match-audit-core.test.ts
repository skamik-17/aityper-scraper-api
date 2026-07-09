import { describe, it, expect } from "vitest";
import {
  analyzeApiMarket,
  analyzeMatchResponse,
  severityScore,
  type ApiMarket,
  type CatalogLookup,
} from "../match-audit-core.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CATALOG: Record<string, { selections: string[]; viewType: string; hasParameter: boolean; labelPl: string }> = {
  DOUBLE_CHANCE: {
    selections: ["HOME_OR_DRAW", "HOME_OR_AWAY", "DRAW_OR_AWAY"],
    viewType: "TRIPLE_BUTTONS",
    hasParameter: false,
    labelPl: "Podwójna szansa",
  },
  BTTS: {
    selections: ["YES", "NO"],
    viewType: "BINARY_BUTTONS",
    hasParameter: false,
    labelPl: "Obie drużyny strzelą",
  },
  TOTAL_GOALS: {
    selections: ["OVER", "UNDER"],
    viewType: "PARAMETER_SLIDER",
    hasParameter: true,
    labelPl: "Suma goli",
  },
  CORRECT_SCORE: {
    selections: [],
    viewType: "SCORE_GRID",
    hasParameter: false,
    labelPl: "Dokładny wynik",
  },
  FIRST_TO_SCORE: {
    selections: ["HOME", "AWAY", "NONE"],
    viewType: "TRIPLE_BUTTONS",
    hasParameter: false,
    labelPl: "Pierwsza strzeli",
  },
};

const lookup: CatalogLookup = (code) => CATALOG[code];

function bm(
  bookmaker: string,
  rawMarketName: string,
  selections: { type: string; odds: number }[],
) {
  return { bookmaker, bookmakerName: bookmaker, rawMarketName, selections };
}

function market(overrides: Partial<ApiMarket> & Pick<ApiMarket, "type" | "parameters">): ApiMarket {
  return {
    marketKey: overrides.type,
    category: "WYNIK_MECZU",
    label: overrides.type,
    viewType: CATALOG[overrides.type]?.viewType,
    defaultParameter: "",
    hasParameters: true,
    ...overrides,
  } as ApiMarket;
}

/** A healthy DOUBLE_CHANCE quoted by 4 books with tight odds. */
function healthyDoubleChance(): ApiMarket {
  const sels = [
    { type: "HOME_OR_DRAW", odds: 1.45 },
    { type: "HOME_OR_AWAY", odds: 1.53 },
    { type: "DRAW_OR_AWAY", odds: 1.27 },
  ];
  return market({
    type: "DOUBLE_CHANCE",
    parameters: [
      {
        value: "",
        label: "",
        bookmakers: [
          bm("betclic", "Podwójna Szansa", sels),
          bm("sts", "Podwójna szansa", sels.map((s) => ({ ...s, odds: s.odds + 0.02 }))),
          bm("fortuna", "Podwojna szansa", sels.map((s) => ({ ...s, odds: s.odds - 0.02 }))),
          bm("etoto", "Podwójna szansa", sels.map((s) => ({ ...s, odds: s.odds + 0.01 }))),
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// unknown selections
// ---------------------------------------------------------------------------

describe("analyzeApiMarket — unknown selections", () => {
  it("reports bookmaker entries containing UNKNOWN selection types", () => {
    const m = healthyDoubleChance();
    m.parameters[0].bookmakers.push(
      bm("lvbet", "Podwójna szansa", [{ type: "UNKNOWN", odds: 1.65 }]),
    );
    const flags = analyzeApiMarket(m, lookup);
    expect(flags.unknown_selection_entries).toHaveLength(1);
    expect(flags.unknown_selection_entries[0]).toMatchObject({
      bookmaker: "lvbet",
      count: 1,
    });
  });

  it("is empty for a healthy market", () => {
    const flags = analyzeApiMarket(healthyDoubleChance(), lookup);
    expect(flags.unknown_selection_entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// selection gaps (vs peer union, peers >= 2)
// ---------------------------------------------------------------------------

describe("analyzeApiMarket — selection gaps", () => {
  it("flags a bookmaker missing a code quoted by >=2 peers", () => {
    const m = healthyDoubleChance();
    // betclic loses DRAW_OR_AWAY
    m.parameters[0].bookmakers[0].selections = m.parameters[0].bookmakers[0].selections.filter(
      (s) => s.type !== "DRAW_OR_AWAY",
    );
    const flags = analyzeApiMarket(m, lookup);
    expect(flags.selection_gaps).toHaveLength(1);
    expect(flags.selection_gaps[0]).toMatchObject({
      bookmaker: "betclic",
      missing: ["DRAW_OR_AWAY"],
    });
  });

  it("does NOT flag when only one peer quotes the code", () => {
    const m = market({
      type: "DOUBLE_CHANCE",
      parameters: [
        {
          value: "",
          label: "",
          bookmakers: [
            bm("betclic", "Podwójna Szansa", [{ type: "HOME_OR_DRAW", odds: 1.4 }]),
            bm("sts", "Podwójna szansa", [
              { type: "HOME_OR_DRAW", odds: 1.42 },
              { type: "DRAW_OR_AWAY", odds: 1.3 }, // only sts has it
            ]),
          ],
        },
      ],
    });
    const flags = analyzeApiMarket(m, lookup);
    expect(flags.selection_gaps).toHaveLength(0);
  });

  it("ignores UNKNOWN when computing the peer union", () => {
    const m = healthyDoubleChance();
    m.parameters[0].bookmakers.push(
      bm("lvbet", "x", [{ type: "UNKNOWN", odds: 2 }]),
      bm("betfan", "x", [{ type: "UNKNOWN", odds: 3 }]),
    );
    const flags = analyzeApiMarket(m, lookup);
    // lvbet/betfan miss all 3 canonical codes; nobody "misses" UNKNOWN
    for (const gap of flags.selection_gaps) {
      expect(gap.missing).not.toContain("UNKNOWN");
    }
  });
});

// ---------------------------------------------------------------------------
// orphans + mixed vocabulary
// ---------------------------------------------------------------------------

describe("analyzeApiMarket — orphan selections and mixed vocabulary", () => {
  it("flags codes outside the catalog selections list as orphans", () => {
    const m = healthyDoubleChance();
    m.parameters[0].bookmakers.push(
      bm("betters", "podwójna szansa", [
        { type: "1X", odds: 1.44 },
        { type: "X2", odds: 1.29 },
      ]),
    );
    const flags = analyzeApiMarket(m, lookup);
    const orphanCodes = flags.orphan_selection_entries.flatMap((o) => o.codes);
    expect(orphanCodes).toEqual(expect.arrayContaining(["1X", "X2"]));
  });

  it("detects mixed canonical + raw-ish vocabulary", () => {
    const m = market({
      type: "BTTS",
      parameters: [
        {
          value: "",
          label: "",
          bookmakers: [
            bm("sts", "Obie drużyny strzelą", [
              { type: "YES", odds: 1.9 },
              { type: "NO", odds: 1.9 },
            ]),
            bm("fortuna", "Obie drużyny strzelą gola", [
              { type: "tak", odds: 1.88 },
              { type: "nie", odds: 1.92 },
            ]),
          ],
        },
      ],
    });
    const flags = analyzeApiMarket(m, lookup);
    expect(flags.mixed_vocabulary).not.toBeNull();
    expect(flags.mixed_vocabulary!.rawish).toEqual(expect.arrayContaining(["tak", "nie"]));
  });

  it("exempts SCORE_GRID markets (score codes are legit)", () => {
    const m = market({
      type: "CORRECT_SCORE",
      parameters: [
        {
          value: "",
          label: "",
          bookmakers: [
            bm("sts", "Dokładny wynik", [
              { type: "1:0", odds: 7.5 },
              { type: "DRAW", odds: 9 },
            ]),
          ],
        },
      ],
    });
    const flags = analyzeApiMarket(m, lookup);
    expect(flags.mixed_vocabulary).toBeNull();
    expect(flags.orphan_selection_entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// odds disagreements (per parameter + selection type, implied-probability space)
// ---------------------------------------------------------------------------

describe("analyzeApiMarket — odds disagreements", () => {
  it("flags a quote whose implied probability deviates >35% from the pool median", () => {
    const m = healthyDoubleChance();
    m.parameters[0].bookmakers.push(
      bm("betfan", "2. połowa - podwójna szansa i obie drużyny strzelą gola", [
        { type: "DRAW_OR_AWAY", odds: 6.0 },
      ]),
    );
    const flags = analyzeApiMarket(m, lookup);
    expect(flags.odds_disagreements).toHaveLength(1);
    expect(flags.odds_disagreements[0]).toMatchObject({
      bookmaker: "betfan",
      selectionType: "DRAW_OR_AWAY",
    });
    // Legacy fields preserved + new implied-space deviation.
    expect(flags.odds_disagreements[0].median).toBeGreaterThan(0);
    expect(flags.odds_disagreements[0].deviationPct).toBeGreaterThan(0);
    expect(flags.odds_disagreements[0].impliedDevPct).toBeGreaterThan(35);
    // No scrapedAt anywhere -> everything is fresh, nothing is stale.
    expect(flags.stale_bookmakers).toHaveLength(0);
  });

  it("does NOT mix different parameter lines into one comparison", () => {
    // OVER 0.5 ~1.2 and OVER 3.5 ~5.0 are both healthy; naive cross-line
    // comparison would scream disagreement.
    const mkLine = (value: string, odds: number) => ({
      value,
      label: value,
      bookmakers: [
        bm("sts", "Suma goli", [{ type: "OVER", odds }]),
        bm("fortuna", "Suma goli", [{ type: "OVER", odds: odds + 0.05 }]),
        bm("betclic", "Suma goli", [{ type: "OVER", odds: odds - 0.05 }]),
        bm("etoto", "Suma goli", [{ type: "OVER", odds: odds + 0.02 }]),
      ],
    });
    const m = market({
      type: "TOTAL_GOALS",
      parameters: [mkLine("0.5", 1.2), mkLine("3.5", 5.0)],
    });
    const flags = analyzeApiMarket(m, lookup);
    expect(flags.odds_disagreements).toHaveLength(0);
  });

  it("needs at least 4 quotes to call a disagreement", () => {
    const m = market({
      type: "BTTS",
      parameters: [
        {
          value: "",
          label: "",
          bookmakers: [
            bm("sts", "BTTS", [{ type: "YES", odds: 1.9 }]),
            bm("fortuna", "BTTS", [{ type: "YES", odds: 1.85 }]),
            bm("betfan", "BTTS", [{ type: "YES", odds: 9.0 }]),
          ],
        },
      ],
    });
    const flags = analyzeApiMarket(m, lookup);
    expect(flags.odds_disagreements).toHaveLength(0);
  });

  it("tolerates legitimate longshot spread [9, 12, 15, 11] — no disagreement, no integrity", () => {
    const m = market({
      type: "FIRST_TO_SCORE",
      parameters: [
        {
          value: "",
          label: "",
          bookmakers: [
            bm("sts", "Pierwsza strzeli", [{ type: "NONE", odds: 9 }]),
            bm("fortuna", "Pierwsza strzeli", [{ type: "NONE", odds: 12 }]),
            bm("betclic", "Pierwsza strzeli", [{ type: "NONE", odds: 15 }]),
            bm("superbet", "Pierwsza strzeli", [{ type: "NONE", odds: 11 }]),
          ],
        },
      ],
    });
    const flags = analyzeApiMarket(m, lookup);
    expect(flags.odds_disagreements).toHaveLength(0);
    expect(flags.odds_integrity).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// odds integrity (zero-tolerance detectors, delegated to odds-integrity.ts)
// ---------------------------------------------------------------------------

describe("analyzeApiMarket — odds integrity", () => {
  it("flags impossible odds (<= 1.0) as odds_integrity regardless of quote count", () => {
    const m = market({
      type: "BTTS",
      parameters: [
        {
          value: "",
          label: "",
          bookmakers: [bm("superbet", "Rynek 123", [{ type: "YES", odds: 0.5 }])],
        },
      ],
    });
    const flags = analyzeApiMarket(m, lookup);
    expect(flags.odds_integrity).toHaveLength(1);
    expect(flags.odds_integrity[0]).toMatchObject({
      bookmaker: "superbet",
      detector: "impossible_odds",
      odds: 0.5,
      expected: null,
    });
  });

  it("flags a decimal-shifted quote against the peer pool", () => {
    const m = market({
      type: "FIRST_TO_SCORE",
      parameters: [
        {
          value: "",
          label: "",
          bookmakers: [
            bm("betclic", "Pierwsza strzeli", [{ type: "NONE", odds: 150 }]),
            bm("sts", "Pierwsza strzeli", [{ type: "NONE", odds: 46 }]),
            bm("fortuna", "Pierwsza strzeli", [{ type: "NONE", odds: 47 }]),
            bm("superbet", "Pierwsza strzeli", [{ type: "NONE", odds: 50 }]),
          ],
        },
      ],
    });
    const flags = analyzeApiMarket(m, lookup);
    const shifts = flags.odds_integrity.filter((f) => f.detector === "decimal_shift");
    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({ bookmaker: "betclic", selectionType: "NONE", odds: 150 });
  });
});

// ---------------------------------------------------------------------------
// freshness windowing + stale_bookmaker (spec §3.1)
// ---------------------------------------------------------------------------

describe("analyzeApiMarket — freshness windowing", () => {
  it("excludes quotes >60min older than the pool newest and flags stale_bookmaker", () => {
    const m = healthyDoubleChance();
    for (const b of m.parameters[0].bookmakers) b.scrapedAt = "2026-07-09T12:00:00Z";
    m.parameters[0].bookmakers.push({
      ...bm("lvbet", "Podwójna szansa", [{ type: "DRAW_OR_AWAY", odds: 6.0 }]),
      scrapedAt: "2026-07-09T10:30:00Z", // 90 min behind the pool
    });
    const flags = analyzeApiMarket(m, lookup);
    // The deviant quote is stale -> excluded, so NOT a disagreement.
    expect(flags.odds_disagreements).toHaveLength(0);
    expect(flags.odds_integrity).toHaveLength(0);
    expect(flags.stale_bookmakers).toEqual([{ bookmaker: "lvbet", ageMinutes: 90 }]);
  });

  it("keeps quotes within the 60-minute window", () => {
    const m = healthyDoubleChance();
    for (const b of m.parameters[0].bookmakers) b.scrapedAt = "2026-07-09T12:00:00Z";
    m.parameters[0].bookmakers[0].scrapedAt = "2026-07-09T11:30:00Z"; // 30 min: fresh
    const flags = analyzeApiMarket(m, lookup);
    expect(flags.stale_bookmakers).toHaveLength(0);
  });

  it("treats missing scrapedAt as fresh (never excludes on missing data)", () => {
    const m = healthyDoubleChance();
    m.parameters[0].bookmakers[0].scrapedAt = "2026-07-09T12:00:00Z";
    // Other entries have no scrapedAt at all.
    const flags = analyzeApiMarket(m, lookup);
    expect(flags.stale_bookmakers).toHaveLength(0);
  });

  it("uses opts.now as an additional freshness reference when provided", () => {
    const m = healthyDoubleChance();
    for (const b of m.parameters[0].bookmakers) b.scrapedAt = "2026-07-09T10:00:00Z";
    const flags = analyzeApiMarket(m, lookup, { now: "2026-07-09T12:00:00Z" });
    // All quotes are 120 min behind `now` -> all stale (scraper-health signal).
    expect(flags.stale_bookmakers).toHaveLength(4);
    expect(flags.stale_bookmakers[0].ageMinutes).toBe(120);
    expect(flags.odds_disagreements).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// coverage baseline gate (spec §3.4)
// ---------------------------------------------------------------------------

describe("analyzeApiMarket — coverage gate on selection gaps", () => {
  /** lvbet quotes HOME/AWAY only; three peers quote NONE too. */
  function firstToScoreMarket(): ApiMarket {
    const full = [
      { type: "HOME", odds: 1.5 },
      { type: "AWAY", odds: 2.5 },
      { type: "NONE", odds: 15 },
    ];
    return market({
      type: "FIRST_TO_SCORE",
      parameters: [
        {
          value: "",
          label: "",
          bookmakers: [
            bm("sts", "Pierwsza strzeli", full),
            bm("fortuna", "Pierwsza strzeli", full.map((s) => ({ ...s, odds: s.odds + 0.02 }))),
            bm("etoto", "Pierwsza strzeli", full.map((s) => ({ ...s, odds: s.odds - 0.02 }))),
            bm("lvbet", "Pierwsza strzeli", [
              { type: "HOME", odds: 1.52 },
              { type: "AWAY", odds: 2.45 },
            ]),
          ],
        },
      ],
    });
  }

  it("flags the gap when no coverage callback is given (today's behaviour)", () => {
    const flags = analyzeApiMarket(firstToScoreMarket(), lookup);
    expect(flags.selection_gaps).toHaveLength(1);
    expect(flags.selection_gaps[0]).toMatchObject({ bookmaker: "lvbet", missing: ["NONE"] });
  });

  it("does NOT flag a gap for a code the bookmaker never offered", () => {
    const calls: [string, string, string][] = [];
    const coverage = (bookmaker: string, marketType: string, code: string) => {
      calls.push([bookmaker, marketType, code]);
      return !(bookmaker === "lvbet" && code === "NONE");
    };
    const flags = analyzeApiMarket(firstToScoreMarket(), lookup, { coverage });
    expect(flags.selection_gaps).toHaveLength(0);
    expect(calls).toContainEqual(["lvbet", "FIRST_TO_SCORE", "NONE"]);
  });

  it("still flags the gap when coverage says the bookmaker has offered the code", () => {
    const flags = analyzeApiMarket(firstToScoreMarket(), lookup, { coverage: () => true });
    expect(flags.selection_gaps).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// misroute hints
// ---------------------------------------------------------------------------

describe("analyzeApiMarket — misroute hints", () => {
  it("flags half-time raw names inside a full-time market", () => {
    const m = healthyDoubleChance();
    m.parameters[0].bookmakers.push(
      bm("betfan", "2. połowa - podwójna szansa i obie drużyny strzelą gola", [
        { type: "UNKNOWN", odds: 14 },
      ]),
    );
    const flags = analyzeApiMarket(m, lookup);
    expect(flags.misroute_hints).toHaveLength(1);
    expect(flags.misroute_hints[0]).toMatchObject({ bookmaker: "betfan" });
    expect(flags.misroute_hints[0].hints).toEqual(
      expect.arrayContaining(["half", "btts_combo"]),
    );
  });

  it("does not flag half markers when the market IS a half market", () => {
    const m = market({
      type: "HALF_TIME_TOTAL_GOALS",
      parameters: [
        {
          value: "1.5",
          label: "1.5",
          bookmakers: [
            bm("sts", "1. połowa - suma goli", [
              { type: "OVER", odds: 2.5 },
              { type: "UNDER", odds: 1.5 },
            ]),
          ],
        },
      ],
    });
    const flags = analyzeApiMarket(m, lookup);
    expect(flags.misroute_hints).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// placeholders + param anomalies + view type
// ---------------------------------------------------------------------------

describe("analyzeApiMarket — placeholders, params, view type", () => {
  it("flags 'Rynek NNN' placeholder raw names", () => {
    const m = healthyDoubleChance();
    m.parameters[0].bookmakers.push(
      bm("superbet", "Rynek 573", [
        { type: "HOME_OR_DRAW", odds: 1.5 },
        { type: "HOME_OR_AWAY", odds: 1.5 },
        { type: "DRAW_OR_AWAY", odds: 1.3 },
      ]),
    );
    const flags = analyzeApiMarket(m, lookup);
    expect(flags.placeholder_names).toHaveLength(1);
    expect(flags.placeholder_names[0]).toMatchObject({ bookmaker: "superbet" });
  });

  it("flags a visible 'base' parameter on multi-param markets only", () => {
    const multi = market({
      type: "TOTAL_GOALS",
      parameters: [
        { value: "base", label: "", bookmakers: [bm("sts", "Suma goli", [{ type: "OVER", odds: 1.9 }])] },
        { value: "2.5", label: "2.5", bookmakers: [bm("sts", "Suma goli", [{ type: "OVER", odds: 1.9 }])] },
      ],
    });
    expect(analyzeApiMarket(multi, lookup).param_anomalies).toContain("base_visible");

    const single = market({
      type: "BTTS",
      parameters: [
        { value: "base", label: "", bookmakers: [bm("sts", "BTTS", [{ type: "YES", odds: 1.9 }])] },
      ],
    });
    expect(analyzeApiMarket(single, lookup).param_anomalies).not.toContain("base_visible");
  });

  it("flags viewType/selection-count mismatch for button views", () => {
    const m = market({
      type: "DOUBLE_CHANCE",
      parameters: [
        {
          value: "",
          label: "",
          bookmakers: [
            bm("sts", "Podwójna szansa", [
              { type: "HOME_OR_DRAW", odds: 1.4 },
              { type: "HOME_OR_AWAY", odds: 1.5 },
              { type: "DRAW_OR_AWAY", odds: 1.3 },
              { type: "DRAW", odds: 3.2 },
              { type: "HOME", odds: 2.2 },
            ]),
          ],
        },
      ],
    });
    const flags = analyzeApiMarket(m, lookup);
    expect(flags.view_type_mismatch).not.toBeNull();
    expect(flags.view_type_mismatch!.expected).toBe(3);
    expect(flags.view_type_mismatch!.actual).toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------------------
// severity + match-level aggregation
// ---------------------------------------------------------------------------

describe("severityScore and analyzeMatchResponse", () => {
  it("scores a broken market higher than a healthy one", () => {
    const healthy = analyzeApiMarket(healthyDoubleChance(), lookup);
    const broken = healthyDoubleChance();
    broken.parameters[0].bookmakers.push(
      bm("betfan", "2. połowa - podwójna szansa i obie drużyny strzelą gola", [
        { type: "UNKNOWN", odds: 14 },
        { type: "DRAW_OR_AWAY", odds: 6 },
      ]),
    );
    const brokenFlags = analyzeApiMarket(broken, lookup);
    expect(severityScore(brokenFlags)).toBeGreaterThan(severityScore(healthy));
    expect(severityScore(healthy)).toBe(0);
  });

  it("aggregates a per-bookmaker culprit matrix across markets", () => {
    const data = {
      match: { homeTeam: "A", awayTeam: "B", league: "test" },
      categories: [
        {
          name: "WYNIK_MECZU",
          label: "Wynik meczu",
          order: 0,
          markets: [
            (() => {
              const m = healthyDoubleChance();
              m.parameters[0].bookmakers.push(
                bm("betfan", "2. połowa - podwójna szansa i obie drużyny strzelą gola", [
                  { type: "UNKNOWN", odds: 14 },
                ]),
              );
              return m;
            })(),
          ],
        },
      ],
      stats: { totalMarkets: 1, normalizedMarkets: 1, coveragePercent: 100, bookmakersWithOdds: [] },
    };
    const result = analyzeMatchResponse(data, lookup);
    expect(result.markets).toHaveLength(1);
    expect(result.summary.culpritMatrix.betfan.misroute_hint).toBeGreaterThanOrEqual(1);
    expect(result.summary.culpritMatrix.betfan.unknown_selection).toBeGreaterThanOrEqual(1);
    expect(result.summary.totalFlagged).toBe(1);
    expect(result.summary.integrityViolations).toBe(0);
  });

  it("counts integrityViolations and bumps odds_integrity per bookmaker", () => {
    const data = {
      match: { homeTeam: "A", awayTeam: "B", league: "test" },
      categories: [
        {
          name: "GOLE",
          label: "Gole",
          order: 0,
          markets: [
            market({
              type: "BTTS",
              parameters: [
                {
                  value: "",
                  label: "",
                  bookmakers: [bm("superbet", "BTTS", [{ type: "YES", odds: 0.5 }])],
                },
              ],
            }),
          ],
        },
      ],
      stats: { totalMarkets: 1, normalizedMarkets: 1, coveragePercent: 100, bookmakersWithOdds: [] },
    };
    const result = analyzeMatchResponse(data, lookup);
    expect(result.summary.integrityViolations).toBe(1);
    expect(result.summary.flagTotals.odds_integrity).toBe(1);
    expect(result.summary.culpritMatrix.superbet.odds_integrity).toBe(1);
  });

  it("bumps stale_bookmaker in flagTotals and the culprit matrix with zero severity weight", () => {
    const m = healthyDoubleChance();
    for (const b of m.parameters[0].bookmakers) b.scrapedAt = "2026-07-09T12:00:00Z";
    m.parameters[0].bookmakers.push({
      ...bm("lvbet", "Podwójna szansa", [
        { type: "HOME_OR_DRAW", odds: 1.46 },
        { type: "HOME_OR_AWAY", odds: 1.54 },
        { type: "DRAW_OR_AWAY", odds: 1.28 },
      ]),
      scrapedAt: "2026-07-09T09:00:00Z",
    });
    const data = {
      match: { homeTeam: "A", awayTeam: "B", league: "test" },
      categories: [{ name: "WYNIK_MECZU", label: "Wynik meczu", order: 0, markets: [m] }],
      stats: { totalMarkets: 1, normalizedMarkets: 1, coveragePercent: 100, bookmakersWithOdds: [] },
    };
    const result = analyzeMatchResponse(data, lookup);
    expect(result.summary.flagTotals.stale_bookmaker).toBe(1);
    expect(result.summary.culpritMatrix.lvbet.stale_bookmaker).toBe(1);
    // Informational only: a stale bookmaker alone must not raise severity.
    expect(result.markets[0].severity).toBe(0);
  });
});
