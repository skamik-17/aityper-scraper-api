#!/usr/bin/env npx tsx
/**
 * Betclic strict normalization audit.
 *
 * Pipeline (per docs instruction):
 *   1. Raw all tabs           - all markets returned across 7 Betclic tabs
 *   2. Raw after parser dedup - deduplicated by parseAllMarketsFromMultipleResponses
 *   3. After normalization    - betclicNormalizer.normalizeMarket(raw, ctx) per raw
 *
 * Computes:
 *   - recognized (marketCode !== OTHER)
 *   - unrecognized (OTHER)
 *   - unique marketKey after normalization
 *   - many raw -> one marketKey collisions (recognized only)
 *
 * Output: writes docs/betclic-normalization-strict-audit.md
 *
 * Usage:
 *   npx tsx scripts/betclic-strict-audit.ts --match <id> --home "<team>" --away "<team>" --league <slug>
 */
import { fetchAllMarketGroups } from "../src/scrapers/bookmakers/betclic/navigation.js";
import {
  parseAllMarketsFromProto,
  parseAllMarketsFromMultipleResponses,
} from "../src/scrapers/bookmakers/betclic/parser.js";
import { betclicNormalizer } from "../src/services/normalization/bookmakers/betclic-normalizer.js";
import type { NormalizationContext, RawBookmakerMarket } from "../src/services/normalization/types.js";
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
  const out = get("--out") ?? resolve(process.cwd(), "../docs/betclic-normalization-strict-audit.md");
  if (!matchId || !home || !away) {
    console.error("Usage: --match <id> --home <team> --away <team> [--league <slug>] [--out <path>]");
    process.exit(1);
  }
  return { matchId, home, away, league, out };
}

interface AuditRow {
  rawName: string;
  rawId?: string | number;
  marketCode: string;
  marketKey: string;
  matchedBy?: string;
}

async function main() {
  const args = parseArgs();
  console.error(`[audit] match=${args.matchId} ${args.home} vs ${args.away} (${args.league})`);

  const responses = await fetchAllMarketGroups(args.matchId);
  console.error(`[audit] Fetched ${responses.length} tab responses`);

  // Raw all tabs: sum markets across every response, no dedup
  let rawAllTabs = 0;
  for (const buf of responses) {
    if (!buf || buf.length === 0) continue;
    try {
      rawAllTabs += parseAllMarketsFromProto(buf).length;
    } catch (e) {
      console.warn(`[audit] Error parsing tab:`, e);
    }
  }

  // Raw after parser dedup
  const rawDeduped = parseAllMarketsFromMultipleResponses(responses);
  console.error(`[audit] rawAllTabs=${rawAllTabs} rawDeduped=${rawDeduped.length}`);

  const ctx: NormalizationContext = {
    homeTeam: args.home,
    awayTeam: args.away,
    leagueName: args.league,
  };

  const rows: AuditRow[] = [];
  let recognized = 0;
  let unrecognized = 0;
  const keyGroups = new Map<string, AuditRow[]>();
  const otherRows: AuditRow[] = [];

  for (const raw of rawDeduped) {
    const rawForNorm: RawBookmakerMarket = {
      bookmakerMarketId: raw.bookmakerMarketId,
      name: raw.name,
      groupName: raw.groupName,
      paramValue: raw.paramValue,
      selections: raw.selections.map((s) => ({ name: s.name, odds: s.odds })),
    };
    const result = betclicNormalizer.normalizeMarket(rawForNorm, ctx);

    const row: AuditRow = {
      rawName: raw.name,
      rawId: raw.bookmakerMarketId,
      marketCode: result?.marketCode ?? "OTHER",
      marketKey: result?.marketKey ?? "OTHER",
      matchedBy: result?.debug?.matchedBy,
    };
    rows.push(row);

    if (!result || result.marketCode === "OTHER") {
      unrecognized++;
      otherRows.push(row);
    } else {
      recognized++;
      const group = keyGroups.get(result.marketKey) ?? [];
      group.push(row);
      keyGroups.set(result.marketKey, group);
    }
  }

  const uniqueMarketKeys = keyGroups.size;
  const collapsed = recognized - uniqueMarketKeys;
  const denom = rawDeduped.length || 1;
  const pct = (n: number) => ((n / denom) * 100).toFixed(1);

  // Collisions: multiple distinct raw names -> one marketKey
  const collisions = [...keyGroups.entries()]
    .filter(([, g]) => {
      const distinctNames = new Set(g.map((r) => r.rawName));
      return distinctNames.size > 1 || g.length > 1;
    })
    .filter(([, g]) => g.length > 1);

  // Build markdown report
  const lines: string[] = [];
  lines.push(`# Betclic normalization strict audit`);
  lines.push(``);
  lines.push(`Metodologia strict: ten raport **nie** bazuje na endpointcie \`normalized-markets\`, tylko na raw flow Betclica i liczy osobno: raw all tabs, parser dedup, normalization, oraz kolizje \`many raw -> one marketKey\`.`);
  lines.push(``);
  lines.push(`- Źródło wyboru meczu: \`npx tsx scripts/find-match-with-most-markets.ts --bookmaker betclic --json\``);
  lines.push(`- Mecz: **${args.home} vs ${args.away}**`);
  lines.push(`- Liga: **${args.league}**`);
  lines.push(`- Match ID: **${args.matchId}**`);
  lines.push(``);
  lines.push(`## Pipeline liczenia`);
  lines.push(``);
  lines.push(`1. **Raw all tabs** - wszystkie markety zwrócone przez 7 zakładek Betclica`);
  lines.push(`2. **Parser dedup** - raw po deduplikacji parsera (\`name:type\`)`);
  lines.push(`3. **Normalization** - wynik \`betclicNormalizer.normalizeMarket(...)\` dla każdego raw marketu po parser dedup`);
  lines.push(`4. **Unique marketKey** - ile unikalnych keyów zostaje po normalizacji`);
  lines.push(``);
  lines.push(`## Podsumowanie liczbowe`);
  lines.push(``);
  lines.push(`- **Raw all tabs:** ${rawAllTabs}`);
  lines.push(`- **Raw after parser dedup (\`name:type\`):** ${rawDeduped.length}`);
  lines.push(`- **Recognized (\`marketCode != OTHER\`):** ${recognized} / ${rawDeduped.length} = **${pct(recognized)}%**`);
  lines.push(`- **Unrecognized (\`OTHER\`):** ${unrecognized} / ${rawDeduped.length} = **${pct(unrecognized)}%**`);
  lines.push(`- **Unique marketKey after normalization:** ${uniqueMarketKeys} / ${rawDeduped.length} = **${pct(uniqueMarketKeys)}%**`);
  lines.push(`- **Recognized raw markets collapsed into existing marketKey:** ${collapsed} / ${rawDeduped.length} = **${pct(collapsed)}%**`);
  lines.push(``);
  lines.push(`## Interpretacja`);
  lines.push(``);
  lines.push(`- Parser już ścina raw listę z **${rawAllTabs}** do **${rawDeduped.length}**.`);
  lines.push(`- Z tych **${rawDeduped.length}** raw marketów tylko **${recognized}** dostaje sensowny kod.`);
  lines.push(`- A nawet wśród rozpoznanych część jest dalej sklejona: **${collapsed}** raw markety nie mają własnego unikalnego \`marketKey\`.`);
  lines.push(``);
  lines.push(`## Many raw -> one marketKey (recognized only)`);
  lines.push(``);
  if (collisions.length === 0) {
    lines.push(`_Brak kolizji — każdy recognized raw market ma własny unikalny marketKey._`);
  } else {
    lines.push(`| marketKey | marketCode | rawCount | distinctRawNames | rawNames |`);
    lines.push(`|---|---:|---:|---:|---|`);
    const sorted = collisions.sort((a, b) => b[1].length - a[1].length);
    for (const [key, group] of sorted) {
      const code = group[0].marketCode;
      const names = [...new Set(group.map((r) => r.rawName))];
      lines.push(`| ${key} | ${code} | ${group.length} | ${names.length} | ${names.join(" • ")} |`);
    }
  }
  lines.push(``);
  lines.push(`## Nierozpoznane raw markety (\`OTHER\`)`);
  lines.push(``);
  if (otherRows.length === 0) {
    lines.push(`_Brak nierozpoznanych marketów._`);
  } else {
    lines.push(`| Raw market name | Raw ID |`);
    lines.push(`|---|---|`);
    const sorted = otherRows.sort((a, b) => a.rawName.localeCompare(b.rawName));
    for (const r of sorted) {
      lines.push(`| ${r.rawName} | ${r.rawId ?? ""} |`);
    }
  }
  lines.push(``);

  const md = lines.join("\n");
  writeFileSync(args.out, md, "utf8");
  console.error(`[audit] Wrote report to ${args.out}`);

  // Print concise summary to stdout
  console.log(JSON.stringify({
    matchId: args.matchId,
    rawAllTabs,
    rawDeduped: rawDeduped.length,
    recognized,
    unrecognized,
    uniqueMarketKeys,
    collapsed,
    collisions: collisions.length,
    otherCount: otherRows.length,
  }, null, 2));
}

main().catch((err) => {
  console.error("[audit] FAILED:", err);
  process.exit(1);
});
