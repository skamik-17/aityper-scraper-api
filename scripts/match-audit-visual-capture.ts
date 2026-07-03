/**
 * Cross-bookmaker match audit — visual capture.
 *
 * Renders each audited market EXACTLY as the frontend does, in isolation,
 * via the dev preview page (/dev/market-preview?market=<base64 JSON>), and
 * screenshots it. The screenshots feed the @match-visual-judge subagents.
 *
 * Usage:
 *   npx tsx scripts/match-audit-visual-capture.ts --prep <prep.json> [--top 60 | --all]
 *     [--refs "GOLE/TOTAL_GOALS,WYNIK_MECZU/DOUBLE_CHANCE"]
 *     [--frontend http://localhost:3000] [--out <dir>]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { chromium, type Browser } from "playwright";
import { safeFileSlug } from "../src/services/audit/visual-types.js";

interface Args {
  prep: string;
  top: number;
  all: boolean;
  refs: string[] | null;
  frontend: string;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    prep: "",
    top: 60,
    all: false,
    refs: null,
    frontend: "http://localhost:3000",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--prep") args.prep = argv[++i];
    else if (a === "--top") args.top = parseInt(argv[++i], 10);
    else if (a === "--all") args.all = true;
    else if (a === "--refs") args.refs = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--frontend") args.frontend = argv[++i];
    else if (a === "--out") args.out = argv[++i];
  }
  return args;
}

interface PrepMarketEntry {
  marketRef: string;
  marketKey: string;
  type: string;
  severity: number;
  market: unknown | null;
}

interface CaptureManifestEntry {
  marketRef: string;
  marketKey: string;
  severity: number;
  file: string | null;
  error: string | null;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.prep || !fs.existsSync(args.prep)) {
    console.error("[visual-capture] --prep <path to prep JSON> is required");
    process.exit(1);
  }

  const prep = JSON.parse(fs.readFileSync(args.prep, "utf8"));
  const matchIdSafe = String(prep.meta.matchId).replace(/[^a-z0-9_-]+/gi, "_");
  const outDir = args.out ?? path.join(path.dirname(args.prep), "visual", matchIdSafe);
  fs.mkdirSync(outDir, { recursive: true });

  // Severity ranking shifts between runs, so ordinal filenames from a previous
  // run would survive as stale artifacts — clear our own outputs first.
  for (const f of fs.readdirSync(outDir)) {
    if (/^\d{3}__.*\.png$/.test(f) || f === "manifest.json") {
      fs.unlinkSync(path.join(outDir, f));
    }
  }

  // Select markets: explicit refs > all > top-N by severity (prep is pre-sorted).
  let entries: PrepMarketEntry[] = prep.markets;
  if (args.refs) {
    const wanted = new Set(args.refs);
    entries = entries.filter((m) => wanted.has(m.marketRef));
  } else if (!args.all) {
    entries = entries.slice(0, args.top);
  }
  entries = entries.filter((m) => m.market !== null);

  const manifest: {
    matchId: string;
    frontendBase: string;
    capturedAt: string;
    markets: CaptureManifestEntry[];
  } = {
    matchId: prep.meta.matchId,
    frontendBase: args.frontend,
    capturedAt: new Date().toISOString(),
    markets: [],
  };

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 860, height: 1000 } });

    // Establish the origin once; per-market data goes through localStorage
    // (large markets exceed Node's ~16KB request-header limit as a URL param).
    await page.goto(`${args.frontend}/dev/market-preview`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    let index = 0;
    for (const entry of entries) {
      index++;
      const slug = safeFileSlug(entry.marketRef);
      const file = `${String(index).padStart(3, "0")}__${slug}.png`;
      try {
        await page.evaluate((json) => {
          window.localStorage.setItem("market-preview-json", json);
        }, JSON.stringify(entry.market));
        await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForSelector('[data-testid="market-preview-card"]', { timeout: 20000 });
        // Expand bookmaker comparison tables so gaps ("—" cells) are visible.
        const toggles = page.locator(
          '[data-testid="market-preview-card"] button[title="Porównaj kursy"]',
        );
        const toggleCount = Math.min(await toggles.count(), 3);
        for (let t = 0; t < toggleCount; t++) {
          await toggles.nth(t).click({ timeout: 2000 }).catch(() => {});
        }
        // Let odds/params settle (client-only render; one frame is enough, keep margin).
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(outDir, file), fullPage: true });
        manifest.markets.push({
          marketRef: entry.marketRef,
          marketKey: entry.marketKey,
          severity: entry.severity,
          file,
          error: null,
        });
        console.error(`[visual-capture] ${index}/${entries.length} ${entry.marketRef} -> ${file}`);
      } catch (err) {
        manifest.markets.push({
          marketRef: entry.marketRef,
          marketKey: entry.marketKey,
          severity: entry.severity,
          file: null,
          error: String(err).slice(0, 300),
        });
        console.error(`[visual-capture] ${index}/${entries.length} ${entry.marketRef} FAILED: ${err}`);
      }
    }
  } finally {
    await browser?.close();
  }

  const manifestPath = path.join(outDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const ok = manifest.markets.filter((m) => m.file).length;
  console.log(
    JSON.stringify({
      manifestPath,
      outDir,
      captured: ok,
      failed: manifest.markets.length - ok,
    }),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[visual-capture] FATAL:", err);
    process.exit(1);
  });
