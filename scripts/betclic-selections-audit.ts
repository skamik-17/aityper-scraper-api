#!/usr/bin/env npx tsx
/**
 * Betclic selection-level normalization audit.
 *
 * Takes same pipeline as betclic-strict-audit.ts but inspects each normalized
 * market's selections for:
 *   - UNKNOWN codes (selection label not mapped)
 *   - Orphan codes (code not in catalog entry's `selections` list)
 *   - Duplicate codes within a single market
 *   - Count mismatch raw vs normalized
 *   - Missing expected selections (catalog expects N, we got <N)
 *
 * Output: writes docs/betclic-selection-audit.md
 *
 * Usage:
 *   npx tsx scripts/betclic-selections-audit.ts --match <id> --home "<team>" --away "<team>" --league <slug>
 */
import { fetchAllMarketGroups } from "../src/scrapers/bookmakers/betclic/navigation.js";
import {
  parseAllMarketsFromMultipleResponses,
} from "../src/scrapers/bookmakers/betclic/parser.js";
import { betclicNormalizer } from "../src/services/normalization/bookmakers/betclic-normalizer.js";
import { MARKET_CATALOG } from "../src/data/market-catalog.js";
import type { MarketCatalogEntry } from "../src/data/market-catalog.js";
import type { NormalizationContext, RawBookmakerMarket } from "../src/services/normalization/types.js";
import { isSelectionOrphan, HANDICAP_CODES } from "../src/services/audit/selection-checks.js";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface Args {
  matchId: string;
  home: string;
  away: string;
  league: string;
  out: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i < 0 || i === argv.length - 1) return undefined;
    return argv[i + 1];
  };
  const matchId = get("--match");
  const home = get("--home");
  const away = get("--away");
  const league = get("--league") ?? "premier-league";
  const out = get("--out") ?? resolve(process.cwd(), "../docs/betclic-selection-audit.md");
  if (!matchId || !home || !away) {
    console.error("Usage: --match <id> --home <team> --away <team> [--league <slug>] [--out <path>]");
    process.exit(1);
  }
  return { matchId, home, away, league, out };
}

interface SelectionIssue {
  type: "unknown" | "orphan" | "duplicate" | "count_mismatch" | "missing_expected" | "unexpected_codes";
  rawName: string;
  marketCode: string;
  marketKey: string;
  detail: string;
}

const catalogByCode = new Map<string, MarketCatalogEntry>(
  MARKET_CATALOG.map((m) => [m.code, m]),
);

async function main() {
  const args = parseArgs();
  console.error(`[sel-audit] match=${args.matchId} ${args.home} vs ${args.away} (${args.league})`);

  const responses = await fetchAllMarketGroups(args.matchId);
  const rawDeduped = parseAllMarketsFromMultipleResponses(responses);
  console.error(`[sel-audit] rawDeduped=${rawDeduped.length}`);

  const ctx: NormalizationContext = {
    homeTeam: args.home,
    awayTeam: args.away,
    leagueName: args.league,
  };

  const issues: SelectionIssue[] = [];
  const marketsWithAnyIssue = new Set<string>();

  let totalMarkets = 0;
  let otherMarkets = 0;
  let marketsOK = 0;
  let unknownSelectionCount = 0;
  let orphanSelectionCount = 0;
  let duplicateSelectionCount = 0;
  let totalSelections = 0;

  for (const raw of rawDeduped) {
    totalMarkets++;
    const rawForNorm: RawBookmakerMarket = {
      bookmakerMarketId: raw.bookmakerMarketId,
      name: raw.name,
      groupName: raw.groupName,
      paramValue: raw.paramValue,
      selections: raw.selections.map((s) => ({ name: s.name, odds: s.odds })),
    };
    const result = betclicNormalizer.normalizeMarket(rawForNorm, ctx);
    if (!result || result.marketCode === "OTHER") {
      otherMarkets++;
      continue;
    }

    totalSelections += result.selections.length;
    const entry = catalogByCode.get(result.marketCode);
    const marketKey = result.marketKey;
    let hasIssue = false;

    // Check: count mismatch
    if (result.selections.length !== raw.selections.length) {
      issues.push({
        type: "count_mismatch",
        rawName: raw.name,
        marketCode: result.marketCode,
        marketKey,
        detail: `raw=${raw.selections.length} normalized=${result.selections.length}`,
      });
      hasIssue = true;
    }

    // Check: UNKNOWN selections
    const unknowns: string[] = [];
    const orphans: string[] = [];
    const codeOccurrences = new Map<string, string[]>();

    for (const sel of result.selections) {
      const code = sel.code as string;
      if (code === "UNKNOWN") {
        unknowns.push(sel.label);
        unknownSelectionCount++;
      }
      if (code !== "UNKNOWN" && isSelectionOrphan(code, entry)) {
        orphans.push(`${sel.label} → ${code}`);
        orphanSelectionCount++;
      }
      if (!codeOccurrences.has(code)) codeOccurrences.set(code, []);
      codeOccurrences.get(code)!.push(sel.label);
    }

    if (unknowns.length > 0) {
      issues.push({
        type: "unknown",
        rawName: raw.name,
        marketCode: result.marketCode,
        marketKey,
        detail: unknowns.map((l) => `"${l}"`).join(", "),
      });
      hasIssue = true;
    }

    if (orphans.length > 0) {
      issues.push({
        type: "orphan",
        rawName: raw.name,
        marketCode: result.marketCode,
        marketKey,
        detail: orphans.join(" | "),
      });
      hasIssue = true;
    }

    // Check: duplicate selection codes (skip legit multi-line/player markets where repeats are expected)
    const hasMultipleParams = (result.parameters?.length ?? 0) > 1;
    const isHandicapMarket = HANDICAP_CODES.has(result.marketCode);
    for (const [code, labels] of codeOccurrences) {
      if (labels.length <= 1) continue;
      if (code === "UNKNOWN") continue;
      if (code === "PLAYER_PAIR" || code === "PLAYER_TRIO") continue; // legit multi-player selection
      if (hasMultipleParams) continue; // multi-line market (handicap, combo): same code × N lines is expected
      if (isHandicapMarket) continue; // handicap markets have multi-line HOME/AWAY/DRAW codes per line
      duplicateSelectionCount += labels.length - 1;
      issues.push({
        type: "duplicate",
        rawName: raw.name,
        marketCode: result.marketCode,
        marketKey,
        detail: `code=${code} × ${labels.length}: [${labels.slice(0, 6).map((l) => `"${l}"`).join(", ")}${labels.length > 6 ? ", ..." : ""}]`,
      });
      hasIssue = true;
    }

    // Check: missing expected
    // Skipped when:
    //  - market has multi-line params (each line covers only a subset of selections)
    //  - catalog has large selection set (>4) — raw bookmakers typically cover a subset
    //  - market has paramValue encoding a teamSide (per-team variants expose only that team's selections)
    //  - entry is player-type (not selection-coded)
    const hasTeamParam =
      result.paramValue === "HOME" ||
      result.paramValue === "AWAY" ||
      result.paramValue?.startsWith("HOME:") ||
      result.paramValue?.startsWith("AWAY:");
    if (
      entry &&
      entry.selections.length > 0 &&
      entry.selections.length <= 4 &&
      entry.parameterType !== "player" &&
      !hasMultipleParams &&
      !hasTeamParam
    ) {
      const receivedCodes = new Set(
        result.selections.map((s) => s.code as string).filter((c) => c !== "UNKNOWN"),
      );
      const expectedCore = new Set(entry.selections);
      const missing = [...expectedCore].filter((c) => !receivedCodes.has(c));
      if (missing.length > 0 && missing.length >= expectedCore.size) {
        // All expected codes are missing — real issue
        issues.push({
          type: "missing_expected",
          rawName: raw.name,
          marketCode: result.marketCode,
          marketKey,
          detail: `missing ${missing.length}/${expectedCore.size}: [${missing.join(", ")}]`,
        });
        hasIssue = true;
      }
    }

    if (hasIssue) marketsWithAnyIssue.add(marketKey);
    if (!hasIssue) marketsOK++;
  }

  // Aggregate issues by marketCode and issue type
  const byCode = new Map<string, Map<string, SelectionIssue[]>>();
  for (const issue of issues) {
    if (!byCode.has(issue.marketCode)) byCode.set(issue.marketCode, new Map());
    const typeMap = byCode.get(issue.marketCode)!;
    if (!typeMap.has(issue.type)) typeMap.set(issue.type, []);
    typeMap.get(issue.type)!.push(issue);
  }

  // Report
  const lines: string[] = [];
  lines.push(`# Betclic selection audit`);
  lines.push(``);
  lines.push(`Sprawdza sensowność selekcji po normalizacji: czy raw selekcje Betclica mapują się na sensowne kody katalogowe (\`YES/NO\`, \`HOME/DRAW/AWAY\`, \`OVER/UNDER\` itd.), czy nie ma duplikatów ani orphanów.`);
  lines.push(``);
  lines.push(`- Mecz: **${args.home} vs ${args.away}**`);
  lines.push(`- Liga: **${args.league}**`);
  lines.push(`- Match ID: **${args.matchId}**`);
  lines.push(``);
  lines.push(`## Podsumowanie`);
  lines.push(``);
  lines.push(`- **Raw dedup markets:** ${rawDeduped.length}`);
  lines.push(`- **OTHER / unrecognized:** ${otherMarkets}`);
  lines.push(`- **Markets with clean selections:** ${marketsOK} / ${totalMarkets - otherMarkets}`);
  lines.push(`- **Markets with selection issues:** ${marketsWithAnyIssue.size} / ${totalMarkets - otherMarkets}`);
  lines.push(`- **Total selections processed:** ${totalSelections}`);
  lines.push(`- **UNKNOWN selections:** ${unknownSelectionCount}`);
  lines.push(`- **Orphan codes (not in catalog):** ${orphanSelectionCount}`);
  lines.push(`- **Duplicate codes within market:** ${duplicateSelectionCount}`);
  lines.push(``);

  const issueTypeLabels: Record<SelectionIssue["type"], string> = {
    unknown: "UNKNOWN selection labels",
    orphan: "Codes not in catalog selections",
    duplicate: "Duplicate codes in one market",
    count_mismatch: "Selection count mismatch raw vs normalized",
    missing_expected: "Missing expected catalog selections",
    unexpected_codes: "Unexpected codes",
  };

  if (issues.length === 0) {
    lines.push(`## Brak problemów — wszystkie selekcje poprawnie znormalizowane.`);
  } else {
    // Group sections by issue type
    for (const type of Object.keys(issueTypeLabels) as Array<SelectionIssue["type"]>) {
      const typeIssues = issues.filter((i) => i.type === type);
      if (typeIssues.length === 0) continue;
      lines.push(`## ${issueTypeLabels[type]} (${typeIssues.length})`);
      lines.push(``);
      lines.push(`| marketCode | marketKey | rawName | detail |`);
      lines.push(`|---|---|---|---|`);
      // Dedup same (marketCode, detail) to avoid repeating per-line O/U duplicates
      const seen = new Set<string>();
      for (const issue of typeIssues) {
        const key = `${issue.marketCode}|${issue.detail}`;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push(`| ${issue.marketCode} | ${issue.marketKey} | ${issue.rawName} | ${issue.detail.replace(/\|/g, "\\|")} |`);
      }
      lines.push(``);
    }

    lines.push(`## Aggregated by marketCode`);
    lines.push(``);
    lines.push(`| marketCode | issue types | issue count |`);
    lines.push(`|---|---|---:|`);
    const sorted = [...byCode.entries()].sort((a, b) => {
      const aCount = [...a[1].values()].reduce((sum, v) => sum + v.length, 0);
      const bCount = [...b[1].values()].reduce((sum, v) => sum + v.length, 0);
      return bCount - aCount;
    });
    for (const [code, typeMap] of sorted) {
      const types = [...typeMap.keys()].join(", ");
      const count = [...typeMap.values()].reduce((sum, v) => sum + v.length, 0);
      lines.push(`| ${code} | ${types} | ${count} |`);
    }
    lines.push(``);
  }

  writeFileSync(args.out, lines.join("\n"), "utf8");
  console.error(`[sel-audit] Wrote report to ${args.out}`);

  console.log(JSON.stringify({
    matchId: args.matchId,
    totalMarkets,
    otherMarkets,
    marketsOK,
    marketsWithIssues: marketsWithAnyIssue.size,
    totalSelections,
    unknownSelections: unknownSelectionCount,
    orphanSelections: orphanSelectionCount,
    duplicateSelections: duplicateSelectionCount,
    totalIssues: issues.length,
  }, null, 2));
}

main().catch((err) => {
  console.error("[sel-audit] FAILED:", err);
  process.exit(1);
});
