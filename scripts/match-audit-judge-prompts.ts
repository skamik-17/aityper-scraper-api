#!/usr/bin/env npx tsx
/**
 * Cross-bookmaker match audit — judge prompt generator.
 *
 * Turns the prep JSON into one self-contained prompt file per selected market
 * (the 6 blocks @match-market-judge expects), so the orchestrator dispatches a
 * judge with a one-line prompt pointing at the file instead of inlining tens of
 * thousands of tokens per market.
 *
 * Usage:
 *   npx tsx scripts/match-audit-judge-prompts.ts --prep <prep.json> [--top 60 | --all] [--out <dir>]
 *     [--outliers <odds-outliers.json>]   attach the odds-consistency findings
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface Args {
  prep: string;
  top: number;
  all: boolean;
  out?: string;
  outliers?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i < argv.length - 1 ? argv[i + 1] : undefined;
  };
  const prep = get("--prep");
  if (!prep) {
    console.error("Usage: --prep <prep.json> [--top N | --all] [--out <dir>]");
    process.exit(1);
  }
  return {
    prep,
    top: Number(get("--top") ?? 60),
    all: argv.includes("--all"),
    out: get("--out"),
    outliers: get("--outliers"),
  };
}

const MAX_BOOKMAKERS_PER_PARAM = 12;
const MAX_PARAMS = 8;
const MAX_RAW_SELECTIONS = 6;
const MAX_RAW_MARKETS = 4;
const MAX_RAW_MARKET_SELECTIONS = 14;

/** Keep the market JSON judge-sized: cap params (keeping "base" + extremes). */
function trimMarket(market: any): any {
  if (!market) return null;
  const params = market.parameters ?? [];
  let kept = params;
  let omitted = 0;
  if (params.length > MAX_PARAMS) {
    const base = params.filter((p: any) => p.value === "" || p.value === "base");
    const rest = params.filter((p: any) => !(p.value === "" || p.value === "base"));
    const head = rest.slice(0, Math.ceil((MAX_PARAMS - base.length) / 2));
    const tail = rest.slice(-Math.floor((MAX_PARAMS - base.length) / 2));
    kept = [...base, ...head, ...tail];
    omitted = params.length - kept.length;
  }
  return {
    ...market,
    parameters: kept.map((p: any) => ({
      ...p,
      bookmakers: (p.bookmakers ?? []).slice(0, MAX_BOOKMAKERS_PER_PARAM),
    })),
    ...(omitted > 0 ? { _omittedParameters: omitted } : {}),
  };
}

function trimRawSelections(raw: any): any {
  if (!raw) return null;
  const out: Record<string, any[]> = {};
  for (const [bm, sels] of Object.entries(raw as Record<string, any[]>)) {
    out[bm] = (sels ?? []).slice(0, MAX_RAW_SELECTIONS);
  }
  return out;
}

function trimRawOffer(raw: any): any {
  if (!raw) return null;
  const out: Record<string, any[]> = {};
  for (const [bm, markets] of Object.entries(raw as Record<string, any[]>)) {
    out[bm] = (markets ?? []).slice(0, MAX_RAW_MARKETS).map((m) => ({
      name: m.name,
      groupName: m.groupName,
      // Bookmakers reuse one name for several products — the id disambiguates.
      bookmakerMarketId: m.bookmakerMarketId,
      paramValue: m.paramValue,
      selections: (m.selections ?? []).slice(0, MAX_RAW_MARKET_SELECTIONS),
      ...((m.selections ?? []).length > MAX_RAW_MARKET_SELECTIONS
        ? { _omittedSelections: m.selections.length - MAX_RAW_MARKET_SELECTIONS }
        : {}),
    }));
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const prepPath = path.resolve(process.cwd(), args.prep);
  const prep = JSON.parse(fs.readFileSync(prepPath, "utf8"));
  const meta = prep.meta;

  // Odds-consistency findings from scripts/odds-outliers.ts, indexed by market.
  // They tell the judge WHICH quote is out of line and by how much, so it can
  // spend its attention on the number instead of re-deriving the comparison.
  const outliersByRef = new Map<string, any[]>();
  if (args.outliers) {
    const outPath = path.resolve(process.cwd(), args.outliers);
    if (!fs.existsSync(outPath)) {
      console.error(`[judge-prompts] --outliers file not found: ${outPath}`);
      process.exit(1);
    }
    const report = JSON.parse(fs.readFileSync(outPath, "utf8"));
    for (const match of report.matches ?? []) {
      for (const finding of match.findings ?? []) {
        const list = outliersByRef.get(finding.marketRef) ?? [];
        list.push(finding);
        outliersByRef.set(finding.marketRef, list);
      }
    }
  }

  const selected = (prep.markets as any[])
    .filter((m) => m.severity > 0 && !m.staleSkip && m.market)
    .slice(0, args.all ? undefined : args.top);

  const outDir = args.out
    ? path.resolve(process.cwd(), args.out)
    : path.join(path.dirname(prepPath), "prompts");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const index: any[] = [];
  selected.forEach((entry, i) => {
    const n = String(i + 1).padStart(3, "0");
    const slug = entry.marketRef.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    const file = path.join(outDir, `${n}__${slug}.md`);
    const rawOffer = trimRawOffer(entry.rawOffer);

    const blocks = [
      `MATCH: ${meta.homeTeam} vs ${meta.awayTeam} (${meta.league})`,
      ``,
      `MARKET REF: ${entry.marketRef}   (marketKey: ${entry.marketKey}, severity ${entry.severity})`,
      ``,
      `MARKET (nasze API, źródło prawdy):`,
      JSON.stringify(trimMarket(entry.market), null, 1),
      ``,
      `CATALOG ENTRY for ${entry.type}:`,
      JSON.stringify(entry.catalogEntry),
      `RELATED CODES: ${JSON.stringify(entry.relatedCodes)}`,
      ``,
      `RAW SELECTIONS (z DB, per bukmacher; API je gubi):`,
      JSON.stringify(trimRawSelections(entry.rawSelections), null, 1),
      ``,
      `MECHANICAL FLAGS:`,
      JSON.stringify(entry.flags, null, 1),
    ];
    const oddsFindings = (outliersByRef.get(entry.marketRef) ?? [])
      .sort((a, b) => (b.deviation ?? 0) - (a.deviation ?? 0))
      .slice(0, 12)
      .map((f) => ({
        kind: f.kind,
        severity: f.severity,
        param: f.param,
        selection: f.selection,
        bookmaker: f.bookmaker,
        odds: f.odds,
        reference: f.reference,
        detail: f.detail,
      }));
    if (oddsFindings.length > 0) {
      blocks.push(
        ``,
        `NIESPÓJNOŚCI KURSÓW (scripts/odds-outliers.ts — mediana peerów, monotoniczność drabinki, integralność, suma najlepszych kursów):`,
        JSON.stringify(oddsFindings, null, 1),
      );
    }
    if (rawOffer) {
      blocks.push(
        ``,
        `RAW BOOKMAKER OFFER (ground truth, prosto ze strony bukmachera, capture ${prep.summary?.rawCoverage?.capturedAt ?? "?"}):`,
        JSON.stringify(rawOffer, null, 1),
      );
    }
    fs.writeFileSync(file, blocks.join("\n"));
    index.push({
      n,
      file,
      marketRef: entry.marketRef,
      marketKey: entry.marketKey,
      type: entry.type,
      severity: entry.severity,
    });
  });

  const indexPath = path.join(outDir, "index.json");
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 1));
  console.log(JSON.stringify({ outDir, indexPath, count: index.length }));
}

main();
