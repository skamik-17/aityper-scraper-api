#!/usr/bin/env npx tsx
/**
 * Full-offer scraper check behind scripts/test-scrapers.sh (plan 10 Task 12): one
 * scrapeFullOffer per bookmaker, normalized in memory, main markets printed. Read-only:
 * the database URL points at a dead port before anything from src/ is imported.
 *
 * Usage:
 *   npx tsx scripts/scraper-check.ts --bookmaker <bm> [--league <slug>] [--match <text>]
 *   npx tsx scripts/scraper-check.ts --quick [--league <slug>]
 *   npx tsx scripts/scraper-check.ts --compare <team> [--league <slug>]
 *
 * Exit codes: 0 OK; 1 the scrape failed, found no match, or the match has no 1X2
 * (--compare: no bookmaker lists the team); 2 usage error.
 */
import type { PolishBookmaker } from "../src/config/index.js";
import type { MainMarketsSummary } from "../src/services/main-markets-summary.js";
import type { FullMatchOffer, FullOfferScraperResult } from "../src/types/full-offer.js";

const USAGE =
  "Usage: scraper-check.ts --bookmaker <bm> [--league <slug>] [--match <text>] | --quick [--league <slug>] | --compare <team> [--league <slug>]";

/** The bookmakers of the old `quick` and `compare` commands. */
const QUICK: readonly PolishBookmaker[] = ["betclic", "betcris", "fortuna", "lvbet", "sts", "superbet", "fuksiarz"];
const COMPARE: readonly PolishBookmaker[] = ["betclic", "betcris", "fortuna", "lvbet", "sts", "superbet"];

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const NC = "\x1b[0m";

type Mode = { kind: "single"; bookmaker: string; match: string } | { kind: "quick" } | { kind: "compare"; team: string };

function parseArgs(argv: string[]): { mode: Mode; league: string } | null {
  let league = "premier-league";
  let bookmaker: string | undefined;
  let match = "";
  let team: string | undefined;
  let quick = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--quick") {
      quick = true;
      continue;
    }
    if (value === undefined || value.startsWith("--")) return null;
    if (flag === "--league") league = value;
    else if (flag === "--bookmaker") bookmaker = value;
    else if (flag === "--match") match = value;
    else if (flag === "--compare") team = value;
    else return null;
    i++;
  }
  const modes = [quick, bookmaker !== undefined, team !== undefined].filter(Boolean).length;
  if (modes !== 1 || !/^[a-z0-9-]+$/.test(league)) return null;
  if (quick) return { mode: { kind: "quick" }, league };
  if (bookmaker !== undefined) return { mode: { kind: "single", bookmaker, match }, league };
  return { mode: { kind: "compare", team: team! }, league };
}

type Deps = {
  scrapeOnce: (bm: PolishBookmaker, league: string) => Promise<FullOfferScraperResult>;
  isBookmaker: (bm: string) => bm is PolishBookmaker;
  summarize: (bm: PolishBookmaker, match: FullMatchOffer, league: string) => MainMarketsSummary;
};

const matchesTeam = (m: FullMatchOffer, text: string) =>
  m.homeTeam.toLowerCase().includes(text) || m.awayTeam.toLowerCase().includes(text);

async function single(d: Deps, bookmaker: string, league: string, filter: string): Promise<number> {
  if (!d.isBookmaker(bookmaker)) {
    console.error(`Unknown bookmaker: ${bookmaker}`);
    return 2;
  }
  console.log(`\n${CYAN}▸ Scraping full offer...${NC}`);
  const started = Date.now();
  const result = await d.scrapeOnce(bookmaker, league);
  const duration = Date.now() - started;
  if (!result.success || result.matches.length === 0) {
    console.log(`${RED}✗ Listing failed:${NC}`, result.success ? "0 matches" : result.error ?? "scrape failed");
    return 1;
  }
  console.log(`${GREEN}✓ Listing:${NC}`, result.matches.length, "matches", `(${DIM}${duration}ms${NC})`);

  let match = result.matches[0];
  if (filter) {
    const found = result.matches.find((m) => matchesTeam(m, filter.toLowerCase()));
    if (found) match = found;
    else console.log(`${YELLOW}⚠ Match filter not found, using first match${NC}`);
  }
  console.log(`${CYAN}▸ Testing:${NC}`, match.homeTeam, "vs", match.awayTeam);

  const detailStarted = Date.now();
  const s = d.summarize(bookmaker, match, league);
  console.log(`${GREEN}✓ Details:${NC}`, `(${DIM}${Date.now() - detailStarted}ms, ${match.markets.length} markets${NC})`);

  if (s.x12) console.log(`  ${GREEN}✓${NC} 1X2:`, s.x12.home, "/", s.x12.draw, "/", s.x12.away);
  else console.log(`  ${RED}✗${NC} 1X2: brak`);
  if (s.btts) console.log(`  ${GREEN}✓${NC} BTTS: Yes`, s.btts.yes, "/ No", s.btts.no);
  else console.log(`  ${RED}✗${NC} BTTS: brak`);
  if (s.ou25) console.log(`  ${GREEN}✓${NC} O/U 2.5: Over`, s.ou25.over, "/ Under", s.ou25.under, `${DIM}(${s.ouLines.length} lines)${NC}`);
  else if (s.ouLines.length > 0) console.log(`  ${GREEN}✓${NC} O/U:`, s.ouLines.join(", "));
  else console.log(`  ${RED}✗${NC} O/U: brak`);
  if (s.dc) console.log(`  ${GREEN}✓${NC} DC: 1X`, s.dc.homeOrDraw, "/ X2", s.dc.drawOrAway, "/ 12", s.dc.homeOrAway);
  console.log("");
  return s.x12 ? 0 : 1;
}

async function quick(d: Deps, league: string): Promise<number> {
  console.log("Testing", QUICK.length, "main scrapers...\n");
  for (const bm of QUICK) {
    const started = Date.now();
    const r = await d.scrapeOnce(bm, league);
    const duration = Date.now() - started;
    if (r.success && r.matches.length > 0) console.log(`${GREEN}✓${NC}`, bm.padEnd(12), r.matches.length, "matches", `${DIM}(${duration}ms)${NC}`);
    else console.log(`${RED}✗${NC}`, bm.padEnd(12), (r.error ?? "0 matches").substring(0, 50));
  }
  console.log("");
  return 0;
}

async function compare(d: Deps, team: string, league: string): Promise<number> {
  const filter = team.toLowerCase();
  const rows: Array<{ name: string; match: string; s: MainMarketsSummary }> = [];
  for (const bm of COMPARE) {
    const r = await d.scrapeOnce(bm, league);
    const m = r.success ? r.matches.find((x) => matchesTeam(x, filter)) : undefined;
    if (m) rows.push({ name: bm, match: `${m.homeTeam} vs ${m.awayTeam}`, s: d.summarize(bm, m, league) });
  }
  if (rows.length === 0) {
    console.log(`${RED}Nie znaleziono meczu${NC}`);
    return 1;
  }
  console.log(`${CYAN}Mecz:${NC}`, rows[0].match, "\n");

  const table = (title: string, heads: string[], cells: (s: MainMarketsSummary) => number[] | undefined) => {
    console.log(`${BOLD}${title}:${NC}`);
    console.log("Bookmaker".padEnd(12), ...heads.map((h) => h.padStart(6)));
    console.log("-".repeat(12 + 7 * heads.length));
    for (const r of rows) {
      const c = cells(r.s);
      if (c) console.log(r.name.padEnd(12), ...c.map((v) => String(v).padStart(6)));
    }
    console.log("");
  };
  table("1X2", ["1", "X", "2"], (s) => (s.x12 ? [s.x12.home, s.x12.draw, s.x12.away] : undefined));
  table("BTTS", ["Yes", "No"], (s) => (s.btts ? [s.btts.yes, s.btts.no] : undefined));
  table("O/U 2.5", ["Over", "Under"], (s) => (s.ou25 ? [s.ou25.over, s.ou25.under] : undefined));
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error(USAGE);
    return 2;
  }

  // Never reach the shared DB, whatever checkout this runs from.
  process.env.SUPABASE_URL = "http://127.0.0.1:9";
  process.env.SUPABASE_SERVICE_KEY = "scraper-check-no-db";
  const smoke = await import("./smoke-bookmaker.js");
  const { closeAllBrowsers } = await import("../src/scrapers/aggregator.js");
  const { normalizeMarketsForBookmaker } = await import("../src/services/normalization/index.js");
  const { summarizeMainMarkets } = await import("../src/services/main-markets-summary.js");

  const deps: Deps = {
    scrapeOnce: smoke.scrapeOnce,
    isBookmaker: smoke.isBookmaker,
    summarize: (bm, match, league) =>
      summarizeMainMarkets(normalizeMarketsForBookmaker(match.markets, bm, match.homeTeam, match.awayTeam, league)),
  };
  try {
    if (args.mode.kind === "single") return await single(deps, args.mode.bookmaker, args.league, args.mode.match);
    if (args.mode.kind === "quick") return await quick(deps, args.league);
    return await compare(deps, args.mode.team, args.league);
  } finally {
    // A failed close never changes the exit code of a finished check
    await closeAllBrowsers().catch((error: unknown) => console.error("scraper-check: closing browsers failed:", error));
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error("scraper-check failed:", error);
    process.exit(1);
  },
);
