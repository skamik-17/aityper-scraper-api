import type { NormalizedSelection, NormalizationContext } from "../types.js";

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

export function parseDecimalLine(text: string): string | undefined {
  const match = text.match(/(\d+)[.,](\d+)/);
  if (match) return `${match[1]}.${match[2]}`;
  return undefined;
}

export function parseIntegerLine(text: string): string | undefined {
  const match = text.match(/[+-]?(\d+)(?![.,]\d)/);
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

export function normalize1x2Selection(
  selectionName: string,
  homeTeam?: string,
  awayTeam?: string
): NormalizedSelection {
  const lower = selectionName.toLowerCase().trim();
  
  if (/^(1|home)$/i.test(lower)) return "HOME";
  if (/^(x|draw|remis)$/i.test(lower)) return "DRAW";
  if (/^(2|away)$/i.test(lower)) return "AWAY";
  if (/^3$/i.test(lower)) return "DRAW";
  
  if (/^gospodarz/i.test(lower)) return "HOME";
  if (/^go[śs]ci/i.test(lower)) return "AWAY";
  
  if (homeTeam && lower.includes(homeTeam.toLowerCase())) return "HOME";
  if (awayTeam && lower.includes(awayTeam.toLowerCase())) return "AWAY";
  
  return "UNKNOWN";
}

export function normalizeOverUnderSelection(selectionName: string): NormalizedSelection {
  const lower = selectionName.toLowerCase().trim();
  
  if (/^(over|powyżej|powyzej|ponad|\+)/i.test(lower)) return "OVER";
  if (/^(under|poniżej|ponizej|pon|-)/i.test(lower)) return "UNDER";
  
  if (selectionName.startsWith("+")) return "OVER";
  if (selectionName.startsWith("-")) return "UNDER";
  
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

  const htCode = match[1].toUpperCase();
  const ftCode = match[2].toUpperCase();

  return `${htCode}/${ftCode}`;
}

export function normalizeAsianHandicap3WaySelection(
  selectionName: string,
  homeTeam: string,
  awayTeam: string
): NormalizedSelection {
  const normalized = selectionName.trim();

  if (/^remis\s*\(/i.test(normalized)) {
    return "DRAW";
  }

  return normalize1x2Selection(normalized, homeTeam, awayTeam);
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

  return normalize1x2Selection(selectionName, ctx.homeTeam, ctx.awayTeam);
}
