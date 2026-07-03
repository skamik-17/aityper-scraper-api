/**
 * Cross-bookmaker match audit — data prep.
 *
 * Fetches the normalized-markets API response (the frontend's source of
 * truth), enriches it with raw selection names from the DB, runs the
 * mechanical analysis (match-audit-core), and writes a prep JSON consumed by
 * the /audit-match orchestrator.
 *
 * Usage:
 *   npx tsx scripts/match-audit-prep.ts --home Algeria --away Austria --league world-cup-2026
 *   npx tsx scripts/match-audit-prep.ts --pick-richest [--league world-cup-2026]
 *
 * Options:
 *   --backend <url>   Backend base URL (default http://localhost:3001)
 *   --out <dir>       Output dir (default docs/match-audit/.tmp, repo-root relative)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getSupabase } from "../src/config/database.js";
import { getFullOfferByMatch } from "../src/repositories/full-offer-repository.js";
import { getMarketByCode } from "../src/data/market-catalog.js";
import { getRelatedCodes } from "../src/services/audit/family-codes.js";
import {
  analyzeMatchResponse,
  type CatalogLookup,
  type NormalizedMarketsData,
  type ApiMarket,
} from "../src/services/audit/match-audit-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

interface Args {
  home?: string;
  away?: string;
  league?: string;
  backend: string;
  out: string;
  pickRichest: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    backend: "http://localhost:3001",
    out: path.join(REPO_ROOT, "docs", "match-audit", ".tmp"),
    pickRichest: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--home") args.home = argv[++i];
    else if (a === "--away") args.away = argv[++i];
    else if (a === "--league") args.league = argv[++i];
    else if (a === "--backend") args.backend = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--pick-richest") args.pickRichest = true;
  }
  return args;
}

/** Pick the match with the most rows in market_comparison (optionally per league). */
async function pickRichestMatch(league?: string): Promise<{ home: string; away: string; league: string } | null> {
  const sb = getSupabase();
  let query = (sb as any)
    .from("market_comparison")
    .select("match_id, home_team, away_team, league_slug")
    .limit(10000);
  if (league) query = query.eq("league_slug", league);
  const { data, error } = await query;
  if (error || !data || data.length === 0) return null;

  const counts = new Map<string, { home: string; away: string; league: string; rows: number }>();
  for (const r of data as any[]) {
    const e = counts.get(r.match_id) ?? {
      home: r.home_team,
      away: r.away_team,
      league: r.league_slug,
      rows: 0,
    };
    e.rows++;
    counts.set(r.match_id, e);
  }
  const best = [...counts.values()].sort((a, b) => b.rows - a.rows)[0];
  return best ? { home: best.home, away: best.away, league: best.league } : null;
}

const catalogLookup: CatalogLookup = (code) => {
  const entry = getMarketByCode(code);
  if (!entry) return undefined;
  return {
    selections: entry.selections ?? [],
    viewType: String(entry.viewType),
    hasParameter: Boolean(entry.hasParameter),
    labelPl: entry.labels?.pl ?? code,
  };
};

async function main() {
  const args = parseArgs(process.argv);

  let { home, away, league } = args;
  if (args.pickRichest && (!home || !away)) {
    const picked = await pickRichestMatch(league);
    if (!picked) {
      console.error("[match-audit-prep] --pick-richest found no matches in market_comparison");
      process.exit(1);
    }
    home = picked.home;
    away = picked.away;
    league = picked.league;
  }
  if (!home || !away || !league) {
    console.error(
      "[match-audit-prep] Missing args. Use --home <t> --away <t> --league <slug>, or --pick-richest.",
    );
    process.exit(1);
  }

  // 1. Fetch the API response — the exact bytes the frontend consumes.
  const url = `${args.backend}/api/matches/${encodeURIComponent(home)}/${encodeURIComponent(away)}/normalized-markets?league=${encodeURIComponent(league)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[match-audit-prep] API ${res.status} for ${url}`);
    process.exit(1);
  }
  const body = (await res.json()) as { success: boolean; data: NormalizedMarketsData };
  if (!body.success || !body.data) {
    console.error(`[match-audit-prep] API returned success=false for ${url}`);
    process.exit(1);
  }
  const data = body.data;

  // 2. Enrich with raw selection names from the DB (the API drops them).
  //    marketKey -> bookmaker -> [{name, normalizedName, odds}]
  const rawSelections: Record<string, Record<string, { name: string; normalizedName?: string; odds: number }[]>> = {};
  let matchId = `${league}:${home.toLowerCase()}:${away.toLowerCase()}`;
  try {
    const fullOffer = await getFullOfferByMatch(home, away, league);
    if (fullOffer) {
      matchId = fullOffer.matchId;
      for (const [marketKey, market] of Object.entries(fullOffer.markets)) {
        rawSelections[marketKey] = {};
        for (const [bookmaker, bmData] of Object.entries(market.bookmakerOdds)) {
          rawSelections[marketKey][bookmaker] = (bmData.selections ?? []).map((s: any) => ({
            name: s.name ?? "",
            normalizedName: s.normalizedName,
            odds: s.odds,
          }));
        }
      }
    }
  } catch (err) {
    console.error(`[match-audit-prep] DB enrichment failed (continuing without): ${err}`);
  }

  // 3. Mechanical analysis.
  const analysis = analyzeMatchResponse(data, catalogLookup);

  // 4. Assemble prep JSON: analysis entries + full market JSON (for judges and
  //    for the visual capture step, which base64-encodes each market).
  const marketByRef = new Map<string, ApiMarket>();
  for (const cat of data.categories) {
    for (const m of cat.markets) marketByRef.set(`${cat.name}/${m.marketKey}`, m);
  }

  const prep = {
    meta: {
      schemaVersion: 1,
      matchId,
      homeTeam: data.match.homeTeam,
      awayTeam: data.match.awayTeam,
      league,
      apiUrl: url,
      frontendUrl: `http://localhost:3000/leagues/${league}/match/${encodeURIComponent(matchId)}`,
      fetchedAt: new Date().toISOString(),
      apiStats: data.stats,
    },
    summary: analysis.summary,
    markets: analysis.markets.map((entry) => ({
      ...entry,
      catalogEntry: catalogLookup(entry.type) ?? null,
      relatedCodes: getRelatedCodes(entry.type).slice(0, 25),
      market: marketByRef.get(entry.marketRef) ?? null,
      rawSelections: rawSelections[entry.marketKey] ?? null,
    })),
  };

  fs.mkdirSync(args.out, { recursive: true });
  const outputPath = path.join(args.out, `${matchId.replace(/[^a-z0-9_-]+/gi, "_")}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(prep, null, 1));

  console.log(
    JSON.stringify({
      outputPath,
      matchId,
      homeTeam: data.match.homeTeam,
      awayTeam: data.match.awayTeam,
      league,
      totalMarkets: analysis.summary.totalMarkets,
      totalFlagged: analysis.summary.totalFlagged,
      flagTotals: analysis.summary.flagTotals,
      bookmakers: data.stats.bookmakersWithOdds,
    }),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[match-audit-prep] FATAL:", err);
    process.exit(1);
  });
