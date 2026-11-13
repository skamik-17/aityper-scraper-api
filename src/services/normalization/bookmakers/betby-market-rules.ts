/**
 * Phase-1 rule table for Betby (betters, lebull): Sportradar UOF market id -> catalog code,
 * line and selection codes. Both brands serve the same Sportradar feed, so one table serves
 * both.
 *
 * Everything maps by id. A UOF outcome id fixes the side (`1714` is the home handicap leg
 * whatever the label says), and a market's specifier string fixes the line. Labels are only
 * read where UOF has no id vocabulary of its own: correct-score names (`1:0`, `inny`).
 *
 * Lines come from the shared specifier readers (`readLine`, `readTotalLine`,
 * `readEuropeanHandicap`), never from `Number(raw)`. A reader that returns null skips the
 * market: a missing market beats a wrong line. A specifier with keys its market does not
 * define (a time window, say) is a different bet and is skipped too. Each rule names those
 * keys (`keys`), so `findSpecifierKeyMismatches` can report such a skip: it is the one skip
 * the evidence never shows, and it can take a whole family of lines with it.
 *
 * Plan: docs/superpowers/plans/2026-11-06-scraper-recovery/betby-betters-lebull.md, the
 * "Phase 1" table under Observations.
 */
import {
  classifyLine,
  formatLine,
  formatSignedLine,
  parseSpecifiers,
  readEuropeanHandicap,
  readLine,
  readTotalLine,
} from "../../../scrapers/shared/betby/specifiers.js";
import type { NormalizedMarketType } from "../types.js";

export interface BetbyMarketRule {
  /** Every catalog code `resolve` can return. */
  codes: NormalizedMarketType[];
  /** The specifier keys the market defines. `resolve` skips a specifier with any other key set. */
  keys: readonly string[];
  /** The code and line for one parsed specifier string, or null to skip the market. */
  resolve(specs: Record<string, string>): { code: NormalizedMarketType; paramValue?: string } | null;
  /** The selection code for one outcome, or null to drop the outcome. */
  outcome(externalId: string | undefined, label: string): string | null;
}

type Outcome = BetbyMarketRule["outcome"];
type Resolved = ReturnType<BetbyMarketRule["resolve"]>;

/** True when the specifier carries exactly these keys and no other. */
function hasExactKeys(specs: Record<string, string>, keys: readonly string[]): boolean {
  const present = Object.keys(specs);
  return present.length === keys.length && keys.every((k) => Object.hasOwn(specs, k));
}

/** A rule whose `resolve` runs `read` only on a specifier with exactly `keys`. */
function keyed(
  keys: readonly string[],
  codes: NormalizedMarketType[],
  outcome: Outcome,
  read: (specs: Record<string, string>) => Resolved,
): BetbyMarketRule {
  const own = Object.freeze([...keys]);
  return { codes, keys: own, outcome, resolve: (specs) => (hasExactKeys(specs, own) ? read(specs) : null) };
}

/** Outcome id -> selection code. A Map, so an id such as `constructor` is never found on a prototype. */
function byId(codes: Record<string, string>): Outcome {
  const map = new Map(Object.entries(codes));
  return (externalId) => (externalId === undefined ? null : (map.get(externalId) ?? null));
}

const RESULT = byId({ "1": "HOME", "2": "DRAW", "3": "AWAY" });
const DOUBLE_CHANCE = byId({ "9": "HOME_OR_DRAW", "10": "HOME_OR_AWAY", "11": "DRAW_OR_AWAY" });
const NO_DRAW = byId({ "4": "HOME", "5": "AWAY" });
const OVER_UNDER = byId({ "12": "OVER", "13": "UNDER" });
const YES_NO = byId({ "74": "YES", "76": "NO" });
/** `hcp` is quoted from the home side: 1714 is `{$competitor1} ({+hcp})`, 1715 `{$competitor2} ({-hcp})`. */
const HANDICAP = byId({ "1714": "HOME", "1715": "AWAY" });
const EUROPEAN_HANDICAP = byId({ "1711": "HOME", "1712": "DRAW", "1713": "AWAY" });
/** Which team scores the n-th / last goal; 7 is "żaden" / "bez gola". */
const TEAM_TO_SCORE = byId({ "6": "HOME", "7": "NONE", "8": "AWAY" });

const SCORE_NAME_RE = /^(\d+):(\d+)$/;

/** Correct score by outcome name: `h:a` -> `h-a`; `inny` (any other score) -> OTHER, as peers spell it. */
const SCORE_BY_NAME: Outcome = (_externalId, label) => {
  if (typeof label !== "string") return null;
  const name = label.trim();
  if (name === "inny") return "OTHER";
  const m = SCORE_NAME_RE.exec(name);
  return m === null ? null : `${m[1]}-${m[2]}`;
};

const EXACT_GOALS_ID_RE = /^bb:exact_goals:(\d+)$/;

/** `bb:exact_goals:N` -> `"N"`; the catalog vocabulary then drops counts it has no code for. */
const EXACT_GOALS_BY_ID: Outcome = (externalId) => {
  const m = externalId === undefined ? null : EXACT_GOALS_ID_RE.exec(externalId);
  return m === null ? null : m[1];
};

/** A market without specifiers. */
function plain(code: NormalizedMarketType, outcome: Outcome): BetbyMarketRule {
  return keyed([], [code], outcome, () => ({ code }));
}

/** `total=<line>`: half lines go to `halfCode`, whole and quarter lines (push, split) to `asianCode`. */
function total(halfCode: NormalizedMarketType, asianCode: NormalizedMarketType): BetbyMarketRule {
  return keyed(["total"], [halfCode, asianCode], OVER_UNDER, (specs) => {
    const line = readTotalLine(specs.total);
    if (line === null) return null;
    return { code: classifyLine(line) === "half" ? halfCode : asianCode, paramValue: formatLine(line) };
  });
}

/** `total=<line>`, half lines only: the code has no push or split settlement. */
function halfLineTotal(code: NormalizedMarketType, outcome: Outcome): BetbyMarketRule {
  return keyed(["total"], [code], outcome, (specs) => {
    const line = readTotalLine(specs.total);
    if (line === null || classifyLine(line) !== "half") return null;
    return { code, paramValue: formatLine(line) };
  });
}

/**
 * `hcp=<line>` from the home side, kept signed. Half and whole lines share one code
 * (decision D1: whole lines pool with fortuna/etoto/betfan/fuksiarz/lvbet under
 * ASIAN_HANDICAP); quarter lines are skipped.
 */
function asianHandicap(code: NormalizedMarketType): BetbyMarketRule {
  return keyed(["hcp"], [code], HANDICAP, (specs) => {
    const line = readLine(specs.hcp);
    if (line === null || classifyLine(line) === "quarter") return null;
    return { code, paramValue: formatSignedLine(line) };
  });
}

/** `hcp=a:b`: the home side's goal start a-b, signed (`1:0` -> `+1`); a level start is skipped. */
function europeanHandicap(code: NormalizedMarketType): BetbyMarketRule {
  return keyed(["hcp"], [code], EUROPEAN_HANDICAP, (specs) => {
    const start = readEuropeanHandicap(specs.hcp);
    return start === null ? null : { code, paramValue: formatSignedLine(start) };
  });
}

/** UOF 8 `{goalnr}. gol`: only the first goal has a catalog code. */
const FIRST_GOAL = keyed(["goalnr"], ["FIRST_TEAM_TO_SCORE"], TEAM_TO_SCORE, (specs) =>
  specs.goalnr === "1" ? { code: "FIRST_TEAM_TO_SCORE" } : null,
);

const GOAL_RANGE_VARIANT = "sr:goal_range:7+";

/**
 * UOF 25 "Przedział goli", only the `sr:goal_range:7+` variant, by outcome id. The names are
 * not trusted: in the same description the `bb:goal_range:11+` variant calls `…:0-2` "0-1 goli".
 */
const GOAL_RANGE = keyed(
  ["variant"],
  ["GOAL_RANGE"],
  byId({
    [`${GOAL_RANGE_VARIANT}:1342`]: "0-1",
    [`${GOAL_RANGE_VARIANT}:1343`]: "2-3",
    [`${GOAL_RANGE_VARIANT}:1344`]: "4-6",
    [`${GOAL_RANGE_VARIANT}:1345`]: "7+",
  }),
  (specs) => (specs.variant === GOAL_RANGE_VARIANT ? { code: "GOAL_RANGE" } : null),
);

/** The 36 phase-1 UOF market ids. Any other id normalizes to null (a hidden OTHER row). */
export const BETBY_MARKET_RULES: Readonly<Record<string, BetbyMarketRule>> = Object.freeze({
  "1": plain("MATCH_WINNER", RESULT),
  "10": plain("DOUBLE_CHANCE", DOUBLE_CHANCE),
  "11": plain("DRAW_NO_BET", NO_DRAW),
  "18": total("TOTAL_GOALS", "TOTAL_GOALS_ASIAN"),
  "68": total("HALF_TIME_TOTAL_GOALS", "HALF_TIME_TOTAL_GOALS_ASIAN"),
  "90": total("SECOND_HALF_TOTAL_GOALS", "SECOND_HALF_TOTAL_GOALS_ASIAN"),
  "19": halfLineTotal("HOME_TEAM_TOTAL_GOALS", OVER_UNDER),
  "20": halfLineTotal("AWAY_TEAM_TOTAL_GOALS", OVER_UNDER),
  "16": asianHandicap("ASIAN_HANDICAP"),
  "66": asianHandicap("FIRST_HALF_ASIAN_HANDICAP"),
  "14": europeanHandicap("EUROPEAN_HANDICAP"),
  "65": europeanHandicap("FIRST_HALF_EUROPEAN_HANDICAP"),
  "29": plain("BTTS", YES_NO),
  "75": plain("HALF_TIME_BTTS", YES_NO),
  "95": plain("SECOND_HALF_BTTS", YES_NO),
  "60": plain("HALF_TIME_RESULT", RESULT),
  "83": plain("SECOND_HALF_RESULT", RESULT),
  "63": plain("HALF_TIME_DOUBLE_CHANCE", DOUBLE_CHANCE),
  "85": plain("SECOND_HALF_DOUBLE_CHANCE", DOUBLE_CHANCE),
  "64": plain("HALF_TIME_DRAW_NO_BET", NO_DRAW),
  "26": plain("ODD_EVEN_GOALS", byId({ "70": "ODD", "72": "EVEN" })),
  "45": plain("CORRECT_SCORE", SCORE_BY_NAME),
  "81": plain("HALF_TIME_CORRECT_SCORE", SCORE_BY_NAME),
  // Half time first, full time second.
  "47": plain(
    "HALFTIME_FULLTIME",
    byId({
      "418": "HOME_HOME",
      "420": "HOME_DRAW",
      "422": "HOME_AWAY",
      "424": "DRAW_HOME",
      "426": "DRAW_DRAW",
      "428": "DRAW_AWAY",
      "430": "AWAY_HOME",
      "432": "AWAY_DRAW",
      "434": "AWAY_AWAY",
    }),
  ),
  "35": plain(
    "RESULT_AND_BTTS",
    byId({ "78": "HOME_YES", "80": "HOME_NO", "82": "DRAW_YES", "84": "DRAW_NO", "86": "AWAY_YES", "88": "AWAY_NO" }),
  ),
  "37": halfLineTotal(
    "RESULT_AND_TOTAL",
    byId({
      "794": "HOME_UNDER",
      "796": "HOME_OVER",
      "798": "DRAW_UNDER",
      "800": "DRAW_OVER",
      "802": "AWAY_UNDER",
      "804": "AWAY_OVER",
    }),
  ),
  "36": halfLineTotal(
    "TOTAL_GOALS_AND_BTTS",
    byId({ "90": "OVER_YES", "92": "UNDER_YES", "94": "OVER_NO", "96": "UNDER_NO" }),
  ),
  "546": plain(
    "DOUBLE_CHANCE_BTTS",
    byId({ "1718": "1X_YES", "1719": "1X_NO", "1720": "12_YES", "1721": "12_NO", "1722": "X2_YES", "1723": "X2_NO" }),
  ),
  "547": halfLineTotal(
    "DOUBLE_CHANCE_TOTAL",
    byId({
      "1724": "1X_UNDER",
      "1725": "12_UNDER",
      "1726": "X2_UNDER",
      "1727": "1X_OVER",
      "1728": "12_OVER",
      "1729": "X2_OVER",
    }),
  ),
  "560": plain("HOME_TEAM_TO_SCORE", YES_NO),
  "561": plain("AWAY_TEAM_TO_SCORE", YES_NO),
  "8": FIRST_GOAL,
  "13670": plain("LAST_TEAM_TO_SCORE", TEAM_TO_SCORE),
  "52": plain("HALF_WITH_MORE_GOALS", byId({ "436": "1ST_HALF", "438": "2ND_HALF", "440": "DRAW" })),
  "25": GOAL_RANGE,
  "50063": plain("EXACT_GOALS", EXACT_GOALS_BY_ID),
});

/** The rule for a UOF market id, string or number, or null. Own keys only: `constructor` has no rule. */
export function betbyRuleFor(marketId: string | number | undefined): BetbyMarketRule | null {
  if (marketId === undefined) return null;
  const id = String(marketId);
  return Object.hasOwn(BETBY_MARKET_RULES, id) ? BETBY_MARKET_RULES[id] : null;
}

/** True when a parsed specifier carries exactly the keys `rule` defines. */
export function hasRuleKeys(rule: BetbyMarketRule, specs: Record<string, string>): boolean {
  return hasExactKeys(specs, rule.keys);
}

/** A market pair as the smoke output prints it: `18[total=2.5]`, `1[]`. */
export function marketPairLabel(marketId: string | number, specifier: string | undefined): string {
  return `${marketId}[${specifier ?? ""}]`;
}

/**
 * Every pair whose market id has a phase-1 rule but whose specifier key set is not the one that
 * rule defines (`18[total=2.5|type=x]`, `18[]`), in input order. The normalizer skips such a
 * pair, so a whole family (the nine TOTAL_GOALS lines of 18, say) can vanish while the match
 * still clears a market-count floor. The Betby smoke (`scripts/betby-smoke.ts`) fails on any entry here.
 * Pairs the rules skip by design (`19[total=1]`, `8[goalnr=2]`, a goal-range variant other
 * than `sr:goal_range:7+`) and ids without a rule are not reported.
 */
export function findSpecifierKeyMismatches(
  markets: Iterable<{ bookmakerMarketId?: string | number; paramValue?: string }>,
): string[] {
  const found: string[] = [];
  for (const m of markets) {
    const rule = betbyRuleFor(m.bookmakerMarketId);
    if (rule === null || hasRuleKeys(rule, parseSpecifiers(m.paramValue ?? ""))) continue;
    found.push(marketPairLabel(String(m.bookmakerMarketId), m.paramValue));
  }
  return found;
}
