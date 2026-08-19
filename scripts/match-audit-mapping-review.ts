#!/usr/bin/env npx tsx
/**
 * Cross-bookmaker match audit — raw-name → canonical-code mapping review.
 *
 * The per-market judges only see markets the mechanical detectors already
 * flagged. A whole class of defects survives that filter: a bookmaker market
 * that was routed to the WRONG canonical code but whose odds happen to look
 * plausible (e.g. forbet's "Wydarzy się min. jedno z: remis lub obie drużyny
 * strzelą gola" landing in BTTS). Those only show up when you read the raw
 * bookmaker market name next to the canonical label it was mapped onto.
 *
 * This script emits, per bookmaker, one reviewable line per distinct
 * (rawMarketName, paramValue) → canonical code pair, plus the raw markets from
 * the ground-truth bundle that our pipeline never claimed. A judge reads the
 * file and reports the pairs that do not mean the same thing.
 *
 * Usage:
 *   npx tsx scripts/match-audit-mapping-review.ts --prep <prep.json> [--out <dir>] [--max-unclaimed 120]
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface Args {
  prep: string;
  out?: string;
  maxUnclaimed: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i < argv.length - 1 ? argv[i + 1] : undefined;
  };
  const prep = get("--prep");
  if (!prep) {
    console.error("Usage: --prep <prep.json> [--out <dir>] [--max-unclaimed N]");
    process.exit(1);
  }
  return { prep, out: get("--out"), maxUnclaimed: Number(get("--max-unclaimed") ?? 120) };
}

interface MappingRow {
  rawMarketName: string;
  params: Set<string>;
  type: string;
  label: string;
  category: string;
  selectionCodes: Set<string>;
  sampleOdds: string;
}

function main() {
  const args = parseArgs(process.argv);
  const prepPath = path.resolve(process.cwd(), args.prep);
  const prep = JSON.parse(fs.readFileSync(prepPath, "utf8"));
  const meta = prep.meta;

  // bookmaker -> `${rawMarketName}||${type}` -> row
  const byBookmaker = new Map<string, Map<string, MappingRow>>();

  for (const entry of prep.markets as any[]) {
    const market = entry.market;
    if (!market) continue;
    for (const param of market.parameters ?? []) {
      for (const bm of param.bookmakers ?? []) {
        const raw = bm.rawMarketName ?? "(brak rawMarketName)";
        const key = `${raw}||${market.type}`;
        let rows = byBookmaker.get(bm.bookmaker);
        if (!rows) {
          rows = new Map();
          byBookmaker.set(bm.bookmaker, rows);
        }
        let row = rows.get(key);
        if (!row) {
          row = {
            rawMarketName: raw,
            params: new Set(),
            type: market.type,
            label: market.label,
            category: market.category,
            selectionCodes: new Set(),
            sampleOdds: (bm.selections ?? [])
              .slice(0, 4)
              .map((s: any) => `${s.type}=${s.odds}`)
              .join(", "),
          };
          rows.set(key, row);
        }
        row.params.add(String(param.value ?? ""));
        for (const s of bm.selections ?? []) row.selectionCodes.add(s.type);
      }
    }
  }

  const outDir = args.out
    ? path.resolve(process.cwd(), args.out)
    : path.join(path.dirname(prepPath), "mapping-review");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const unclaimed = (prep.rawUnclaimed ?? {}) as Record<
    string,
    { name: string; paramValue?: string; selections: number }[]
  >;

  const index: any[] = [];
  for (const [bookmaker, rows] of [...byBookmaker.entries()].sort()) {
    const sorted = [...rows.values()].sort((a, b) =>
      a.type === b.type
        ? a.rawMarketName.localeCompare(b.rawMarketName)
        : a.type.localeCompare(b.type),
    );
    const lines: string[] = [
      `MATCH: ${meta.homeTeam} vs ${meta.awayTeam} (${meta.league})`,
      `BOOKMAKER: ${bookmaker}`,
      ``,
      `SEKCJA A — MAPOWANIA (nazwa rynku u bukmachera → kod kanoniczny u nas)`,
      `Format: <kod> | <nasza etykieta PL> | params=[..] | selekcje=[..] | RAW: "<nazwa u bukmachera>" | kursy: <próbka>`,
      ``,
    ];
    for (const r of sorted) {
      const params = [...r.params].filter((p) => p !== "").sort();
      lines.push(
        `${r.type} | ${r.label} | params=[${params.slice(0, 12).join(",")}${params.length > 12 ? ",…" : ""}] | selekcje=[${[...r.selectionCodes].slice(0, 10).join(",")}${r.selectionCodes.size > 10 ? ",…" : ""}] | RAW: "${r.rawMarketName}" | kursy: ${r.sampleOdds}`,
      );
    }

    const missing = unclaimed[bookmaker] ?? [];
    lines.push(
      ``,
      `SEKCJA B — RYNKI Z OFERTY BUKMACHERA, KTÓRYCH NASZ PIPELINE NIE PRZYPISAŁ (${missing.length}; pokazane ${Math.min(missing.length, args.maxUnclaimed)})`,
      `Format: "<nazwa>" [param] (<liczba selekcji>)`,
      ``,
    );
    for (const m of missing.slice(0, args.maxUnclaimed)) {
      lines.push(`"${m.name}"${m.paramValue ? ` [${m.paramValue}]` : ""} (${m.selections})`);
    }

    const file = path.join(outDir, `${bookmaker}.md`);
    fs.writeFileSync(file, lines.join("\n"));
    index.push({ bookmaker, file, mappings: sorted.length, unclaimed: missing.length });
  }

  const indexPath = path.join(outDir, "index.json");
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 1));
  console.log(JSON.stringify({ outDir, indexPath, bookmakers: index }));
}

main();
