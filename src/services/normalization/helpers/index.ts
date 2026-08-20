import type { NormalizedSelection, NormalizationContext } from "../types.js";
import { matchToCanonical } from "../../../utils/team-matcher.js";

/**
 * Normalizes a market name by removing diacritics, converting to lowercase,
 * and collapsing whitespace. Used across all bookmaker normalizers.
 */
export function normalizeMarketName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildMarketKey(marketCode: string, paramValue?: string): string {
  if (!paramValue) return marketCode;
  return `${marketCode}:${paramValue.replace(",", ".")}`;
}

/**
 * "Both halves over 0.5 goals" IS "a goal in both halves" — the 0.5
 * threshold on a whole-goals count means "at least one goal", the exact
 * definition of the plain BOTH_HALVES_GOALS Tak/Nie market. Bookmakers that
 * scrape this as the bottom rung of an Over/Under ladder were routing it to
 * BOTH_HALVES_OVER_GOALS:0.5 instead, splitting the "goal in both halves"
 * comparison pool from bookmakers whose site only offers the plain Tak/Nie
 * shape, AND — for a bookmaker that scrapes BOTH raw shapes (e.g. lebull's
 * "Gol w obu połowach" + "Obie połowy powyżej 0.5") — producing two cards
 * for the identical real-world bet at two (slightly different) prices
 * (audit cluster #24). Collapse the 0.5 line onto BOTH_HALVES_GOALS here so
 * every bookmaker's price for this bet pools under one key; genuine higher
 * lines (1.5/2.5/3.5 — "both halves have 2+/3+/4+ goals") are unaffected.
 * Call this right before buildMarketKey wherever a normalizer can resolve
 * BOTH_HALVES_OVER_GOALS.
 */
export function collapseBothHalvesOverGoalsZeroFive(
  marketCode: string,
  paramValue: string | undefined
): { marketCode: string; paramValue: string | undefined } {
  if (marketCode === "BOTH_HALVES_OVER_GOALS" && paramValue === "0.5") {
    return { marketCode: "BOTH_HALVES_GOALS", paramValue: undefined };
  }
  return { marketCode, paramValue };
}

export function parseDecimalLine(text: string): string | undefined {
  const match = text.match(/(\d+)[.,](\d+)/);
  if (match) return `${match[1]}.${match[2]}`;
  return undefined;
}

export function parseIntegerLine(text: string): string | undefined {
  // The negative lookbehind stops the scanner from re-entering a decimal it
  // already rejected: without it "Azjatycka liczba goli 1.75" skipped "1"
  // (followed by ".7") and then matched the FRACTION "75" as the line, so
  // LVBet's quarter-goal asian totals were stored as param 75 / 25 and
  // collided with each other (audit-match, Arsenal vs Coventry City).
  // Returning undefined lets callers fall back to the selection labels
  // ("Powyżej 1.75"), which carry the real line.
  // The second lookahead skips a scope ordinal ("1. połowa - liczba goli 2"
  // used to yield 1, the half index, instead of the line 2). It is deliberately
  // limited to scope words so ordinals that ARE the parameter still match
  // ("1. połowa - 1. rzut rożny" -> 1, the first corner).
  const match = text.match(
    /(?<![\d.,])[+-]?(\d+)(?![.,]\d)(?!\.\s*(?:po[łl]ow|kwart|half|quarter))/i,
  );
  if (match) return match[1];
  return undefined;
}

export function parseHandicapLine(text: string): string | undefined {
  const match = text.match(/([+-]?\d+[.,]?\d*)/);
  if (!match) return undefined;
  const value = match[1].replace(",", ".");
  if (!value.startsWith("+") && !value.startsWith("-") && parseFloat(value) > 0) {
    return `+${value}`;
  }
  return value;
}

export function parseOverUnderLine(selectionNames: string[]): string | undefined {
  for (const name of selectionNames) {
    const decMatch = name.match(/[+-]?(\d+[.,]\d+)/);
    if (decMatch) return decMatch[1].replace(",", ".");

    const intMatch = name.match(/^[+-](\d+)$/);
    if (intMatch) return `${intMatch[1]}.0`;
  }
  return undefined;
}

export function extractMultipleHandicapLines(selectionNames: string[]): string[] | undefined {
  const handicapSet = new Set<string>();

  for (const name of selectionNames) {
    const match = name.match(/([+-]?\d+[.,]?\d*)/);
    if (match) {
      const value = match[1].replace(",", ".");
      if (!value.startsWith("+") && !value.startsWith("-") && parseFloat(value) > 0) {
        handicapSet.add(`+${value}`);
      } else {
        handicapSet.add(value);
      }
    }
  }

  if (handicapSet.size === 0) return undefined;

  return Array.from(handicapSet).sort((a, b) => {
    const numA = parseFloat(a);
    const numB = parseFloat(b);
    return numA - numB;
  });
}

/**
 * Extracts multiple over/under goal lines from selection names.
 * Handles both cases where lines are in individual selections
 * (e.g., "Powyżej 2.5", "Poniżej 2.5") and where multiple lines
 * are listed in a single selection separated by "/" (e.g., "1,5 / 2,5 / 3,5").
 * Converts Polish comma decimal separator to dot.
 *
 * @param selectionNames - Array of selection names to parse
 * @returns Sorted array of unique goal lines (e.g., ["1.5", "2.5", "3.5"]) or undefined if none found
 */
export function extractMultipleOverUnderLines(selectionNames: string[]): string[] | undefined {
  const linesSet = new Set<string>();

  for (const name of selectionNames) {
    // Case 1: Multiple lines in one selection separated by "/"
    // e.g., "Arsenal / Remis & Powyżej 1,5 / 2,5 / 3,5 / 4,5"
    const slashSeparated = name.split("/");
    for (const part of slashSeparated) {
      const trimmedPart = part.trim();
      // Match decimal numbers with either comma or dot
      const match = trimmedPart.match(/(\d+)[,.](\d+)/);
      if (match) {
        // Always normalize to dot format
        const value = `${match[1]}.${match[2]}`;
        linesSet.add(value);
      }
    }

    // Case 2: Line in selection name (e.g., "Powyżej 2,5")
    // This is handled by the loop above since a single-part string
    // is also processed when split("/") results in [single_part]
  }

  if (linesSet.size === 0) return undefined;

  return Array.from(linesSet).sort((a, b) => {
    const numA = parseFloat(a);
    const numB = parseFloat(b);
    return numA - numB;
  });
}

export function normalize1x2Selection(
  selectionName: string,
  homeTeam?: string,
  awayTeam?: string,
  league?: string
): NormalizedSelection {
  const lower = selectionName.toLowerCase().trim();

  if (/^(1|home)$/i.test(lower)) return "HOME";
  if (/^(x|draw|remis)$/i.test(lower)) return "DRAW";
  if (/^(2|away)$/i.test(lower)) return "AWAY";
  if (/^3$/i.test(lower)) return "DRAW";

  if (/^gospodarz/i.test(lower)) return "HOME";
  if (/^go[śs]ci/i.test(lower)) return "AWAY";

  if (homeTeam) {
    const homeLower = homeTeam.toLowerCase();
    if (lower.includes(homeLower) || (lower.length >= 3 && homeLower.includes(lower))) return "HOME";
  }
  if (awayTeam) {
    const awayLower = awayTeam.toLowerCase();
    if (lower.includes(awayLower) || (lower.length >= 3 && awayLower.includes(lower))) return "AWAY";
  }

  // Canonical fallback: bookmaker selection names may be in a different language
  // than the (canonical) context team names — e.g. World Cup national teams where
  // the selection is Polish ("Argentyna") but homeTeam is the canonical English
  // form ("Argentina"). Resolve the selection via the league alias map and match
  // it against the canonicalized home/away teams.
  if (league && (homeTeam || awayTeam)) {
    const selMatch = matchToCanonical(selectionName, league);
    if (selMatch) {
      const homeMatch = homeTeam ? matchToCanonical(homeTeam, league) : null;
      const awayMatch = awayTeam ? matchToCanonical(awayTeam, league) : null;
      if (homeMatch && selMatch.name === homeMatch.name) return "HOME";
      if (awayMatch && selMatch.name === awayMatch.name) return "AWAY";
    }
  }

  return "UNKNOWN";
}

export function normalizeOverUnderSelection(selectionName: string): NormalizedSelection {
  const normalized = selectionName.replace(/,/g, ".").toLowerCase().trim();

  if (/^(over|powyżej|powyzej|ponad|\+)/i.test(normalized)) return "OVER";
  if (/^(under|poniżej|ponizej|pon|-)/i.test(normalized)) return "UNDER";

  if (normalized.startsWith("+")) return "OVER";
  if (normalized.startsWith("-")) return "UNDER";

  return "UNKNOWN";
}

export function normalizeYesNoSelection(selectionName: string): NormalizedSelection {
  const lower = selectionName.toLowerCase().trim();
  
  if (/^(yes|tak|si|ja|gg|gol)$/i.test(lower)) return "YES";
  if (/^(no|nie|nein|ng|brak)$/i.test(lower)) return "NO";
  
  return "UNKNOWN";
}

export function normalizeDoubleChanceSelection(selectionName: string): NormalizedSelection {
  const lower = selectionName.toLowerCase().trim();
  
  if (/^(1x|10|1\s*lub\s*x)$/i.test(lower)) return "HOME_OR_DRAW";
  if (/^(x2|02|x\s*lub\s*2)$/i.test(lower)) return "DRAW_OR_AWAY";
  if (/^(12|1\s*lub\s*2)$/i.test(lower)) return "HOME_OR_AWAY";
  
  return "UNKNOWN";
}

export function normalizeOddEvenSelection(selectionName: string): NormalizedSelection {
  const lower = selectionName.toLowerCase().trim();
  
  if (/^(odd|nieparzyste?|impar)/i.test(lower)) return "ODD";
  if (/^(even|parzyste?|par)/i.test(lower)) return "EVEN";
  
  return "UNKNOWN";
}

export function parseScoreSelection(selectionName: string): string | null {
  const match = selectionName.match(/^(\d+)\s*[:–\-]\s*(\d+)$/);
  if (match) return `${match[1]}-${match[2]}`;
  return null;
}

export function parseHtFtSelection(selectionName: string): string | null {
  const match = selectionName.match(/^([1x2])\s*\/\s*([1x2])$/i);
  if (!match) return null;

  // Map to the catalog's HALFTIME_FULLTIME selection codes (HOME_HOME, ...),
  // not the raw "1/1" notation — the aggregator compares codes across
  // bookmakers, so every normalizer must emit the canonical form.
  const toSide = (c: string) =>
    c === "1" ? "HOME" : c.toUpperCase() === "X" ? "DRAW" : "AWAY";

  return `${toSide(match[1])}_${toSide(match[2])}`;
}

export function normalizeAsianHandicap3WaySelection(
  selectionName: string,
  homeTeam: string,
  awayTeam: string,
  league?: string
): NormalizedSelection {
  const normalized = selectionName.trim();

  // "Remis (Team -2)" pattern -> DRAW
  if (/^remis\s*\(/i.test(normalized)) {
    return "DRAW";
  }

  // Strip trailing handicap value in parentheses before team matching,
  // e.g. "Nowa Zelandia (-2)" -> "Nowa Zelandia", "Egipt (+2)" -> "Egipt".
  // Betclic renders 3-way handicap selections as "{team} ({sign}{value})"
  // where value uses either comma or dot as decimal separator.
  const teamPart = normalized.replace(/\s*\([+-]?\d+[.,]?\d*\)\s*$/, "").trim();
  if (teamPart.length > 0 && teamPart !== normalized) {
    return normalize1x2Selection(teamPart, homeTeam, awayTeam, league);
  }

  return normalize1x2Selection(normalized, homeTeam, awayTeam, league);
}

export function normalizeHandicapSelection(
  selectionName: string,
  ctx: NormalizationContext
): NormalizedSelection {
  const normalized = selectionName.trim().toLowerCase();
  const home = normalizeMarketName(ctx.homeTeam);
  const away = normalizeMarketName(ctx.awayTeam);

  if (home && normalized.includes(home)) return "HOME";
  if (away && normalized.includes(away)) return "AWAY";

  // Strip parenthetical handicap value — e.g. "Czechy (-2,5)" -> "Czechy"
  // Betclic renders Asian handicap selections as "{team} ({value})" where value
  // uses either comma or dot as decimal separator.
  const teamPart = selectionName.replace(/\s*\([+-]?\d+[.,]\d+\)\s*$/, "").trim();
  if (teamPart !== selectionName.trim()) {
    const teamNormalized = teamPart.toLowerCase();
    if (home && teamNormalized.includes(home)) return "HOME";
    if (away && teamNormalized.includes(away)) return "AWAY";
    // Try canonical team matching on the stripped team name
    return normalize1x2Selection(teamPart, ctx.homeTeam, ctx.awayTeam, ctx.league);
  }

  return normalize1x2Selection(selectionName, ctx.homeTeam, ctx.awayTeam, ctx.league);
}

/**
 * Player names are the merge key for every PLAYER_* market, so a single
 * accent splits one footballer into two dropdown rows with half the odds each.
 * The audit (/audit-match, Arsenal vs Coventry City) found "Viktor Gyökeres"
 * (fuksiarz) sitting next to "Viktor Gyokeres" (betcris/lvbet/superbet), and
 * the same for "Aurèle Amenda" and "Gabriel Magalhães". Most bookmakers
 * already send ASCII, so folding accents into the base letter is what makes
 * the majority form win.
 */
function stripPlayerDiacritics(value: string): string {
  return value
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .replace(/ø/g, "o")
    .replace(/Ø/g, "O")
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "AE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Canonicalize a player-name selection to natural "Firstname Lastname" order.
 *
 * Bookmakers disagree on name order ("Jashari, Ardon" vs "Ardon Jashari"),
 * which strands the same player's odds in duplicate comparison columns. The
 * aggregator merges selections by exact code, so every normalizer (and the
 * grouper as a safety net) must emit one canonical form.
 *
 * Only a single "Last[ Parts], First[ Parts]" comma pattern is rewritten;
 * anything else (codes, scores, multi-comma lists) passes through unchanged
 * apart from whitespace collapsing and apostrophe normalization.
 */
export function canonicalizePlayerName(raw: string): string {
  // Bookmakers render names like "N'Golo" with different apostrophe-ish
  // glyphs (backtick, acute accent, curly quote) depending on their font/
  // encoding pipeline — normalize to a plain apostrophe so e.g. "N`Golo" and
  // "N'Golo" merge into one selection instead of stranding odds separately.
  const collapsed = stripPlayerDiacritics(
    raw.trim().replace(/\s+/g, " ").replace(/[`´'‘]/g, "'"),
  );
  const m = collapsed.match(/^([\p{L}][\p{L}'’.\- ]*),\s*([\p{L}][\p{L}'’.\- ]*)$/u);
  if (!m) return collapsed;
  return `${m[2].trim()} ${m[1].trim()}`;
}

// Surname prefixes that stay attached to the surname when a full name is
// reduced to "I. Surname" — without this list "Milan van Ewijk" would become
// "M. Ewijk" (dropping "van") instead of "M. van Ewijk".
const NAME_PARTICLES = new Set([
  "de", "del", "della", "da", "das", "dos", "di", "van", "von", "der", "den",
  "ten", "ter", "le", "la", "el", "al", "bin", "ibn", "mc", "mac", "st",
]);

/**
 * Reduce a full or partly abbreviated player name to the network-wide combo
 * form "I. Surname". Betclic (and forbet) receive names already abbreviated
 * at the source, so "I. Surname" is the only form every bookmaker can reach
 * without a roster lookup. Middle names are dropped so "Ellis Reco Simms"
 * (superbet's "Simms, Ellis Reco" after canonicalizePlayerName) and
 * "E. Simms" (betcris/lvbet's "Ellis Simms") merge into one code; particle
 * prefixes stay attached so "Milan van Ewijk" -> "M. van Ewijk" and
 * "Rodrigo De Paul" -> "R. De Paul".
 */
export function toComboPlayerForm(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return name.trim();
  let start = tokens.length - 1;
  while (start > 1 && NAME_PARTICLES.has(tokens[start - 1].toLowerCase().replace(/\./g, ""))) {
    start--;
  }
  return `${tokens[0].charAt(0)}. ${tokens.slice(start).join(" ")}`;
}

/**
 * Single canonical form for player-combination selections (PLAYER_PAIR /
 * PLAYER_TRIO markets), where the combo IS the selection code. Every
 * bookmaker quotes the same real-world pair in a different raw shape —
 * betclic pre-abbreviates at the source ("C. Tzolis & K. Havertz"), betcris/
 * lvbet send full names joined by "and" ("Kai Havertz and Christos Tzolis"),
 * and superbet sends "Lastname, Firstname" joined by "i" ("Tzolis, Christos
 * i Havertz, Kai") — without a shared reduction each bookmaker strands its
 * own comparison column instead of merging into one row (audit-match,
 * Arsenal vs Coventry City). Split on every separator any bookmaker uses,
 * canonicalize name order, reduce to "I. Surname", sort, join with " & ".
 */
export function canonicalizePlayerComboSelection(raw: string): string {
  const members = raw
    .replace(/^\d+\.\s*/, "")
    .split(/\s*[/&]\s*|\s+(?:and|or|i|lub)\s+/iu)
    .map((part) => toComboPlayerForm(canonicalizePlayerName(part.trim())))
    .filter((part) => part.length > 0);
  if (members.length < 2) return toComboPlayerForm(canonicalizePlayerName(raw));
  return members.sort((a, b) => a.localeCompare(b, "en")).join(" & ");
}
