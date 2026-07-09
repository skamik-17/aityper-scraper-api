/**
 * Cross-bookmaker match audit — visual capture.
 *
 * Renders each audited market EXACTLY as the frontend does, in isolation,
 * via the dev preview page (/dev/market-preview?market=<base64 JSON>), and
 * screenshots it. The screenshots feed the @match-visual-judge subagents.
 *
 * Capture protocol (v2):
 *  1. PLAYER_DROPDOWN markets (or any market with a "Zawodnicy" trigger) get
 *     their dropdown clicked open before the shot, so the judge can inspect
 *     the player list instead of a collapsed trigger button.
 *  2. Horizontally clipped comparison tables (overflow-hidden wrappers whose
 *     content is wider than the ~28rem card) are un-clipped: the card is
 *     switched to width:max-content and the viewport widened so no column
 *     (e.g. a trailing "4+") is cut off.
 *  3. Deterministic DOM facts are recorded per market in manifest.json under
 *     `domChecks`, letting the orchestrator skip LLM judging for those
 *     dimensions:
 *       - selectionsRenderedCount: number — rendered selection buttons/rows
 *         (param chips, comparison-table cells and UI chrome excluded)
 *       - placeholderLeaks: string[] — visible text nodes matching
 *         /^(base|UNKNOWN|\?)$/ (empty array = clean)
 *       - paramSortOk: boolean | null — numeric parameter chips appear in
 *         ascending numeric order (null = fewer than 2 numeric chips)
 *       - emptyRender: boolean — market container has zero selection elements
 *
 * Usage:
 *   npx tsx scripts/match-audit-visual-capture.ts --prep <prep.json> [--top 60 | --all]
 *     [--refs "GOLE/TOTAL_GOALS,WYNIK_MECZU/DOUBLE_CHANCE"]
 *     [--frontend http://localhost:3000] [--out <dir>]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
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
  viewType?: string | null;
  severity: number;
  market: unknown | null;
}

/** Deterministic DOM facts measured on the rendered preview card. */
interface DomChecks {
  /** Rendered selection buttons/rows (chrome, param chips, table cells excluded). */
  selectionsRenderedCount: number;
  /** Visible text nodes matching /^(base|UNKNOWN|\?)$/ — empty array = clean. */
  placeholderLeaks: string[];
  /** Numeric parameter chips in ascending order; null when < 2 numeric chips. */
  paramSortOk: boolean | null;
  /** True when the market container rendered zero selection elements. */
  emptyRender: boolean;
}

interface CaptureManifestEntry {
  marketRef: string;
  marketKey: string;
  severity: number;
  viewType: string | null;
  file: string | null;
  error: string | null;
  domChecks: DomChecks | null;
  /** True when a player dropdown was clicked open before the screenshot. */
  dropdownExpanded: boolean;
  /** Viewport width actually used for the shot (widened for clipped tables). */
  viewportWidth: number | null;
}

const BASE_VIEWPORT = { width: 860, height: 1000 };
const MAX_VIEWPORT_WIDTH = 3800;
const CARD_SELECTOR = '[data-testid="market-preview-card"]';

/**
 * Click the player-dropdown trigger (if present) and wait for the expanded
 * list to render. Returns true when the dropdown is confirmed open.
 */
async function expandPlayerDropdown(page: Page): Promise<boolean> {
  const card = page.locator(CARD_SELECTOR);
  const trigger = card.locator("button").filter({ hasText: "Zawodnicy" }).first();
  if ((await trigger.count()) === 0) return false;
  try {
    await trigger.click({ timeout: 3000 });
    // The panel renders a search input + the player rows synchronously.
    await card
      .locator('input[placeholder="Szukaj zawodnika..."]')
      .waitFor({ state: "visible", timeout: 5000 });
    // Entry animation is 200ms (animate-in duration-200).
    await page.waitForTimeout(250);
    return true;
  } catch {
    return false;
  }
}

/** Run the deterministic DOM checks inside the rendered preview card. */
async function runDomChecks(page: Page): Promise<DomChecks | null> {
  return page.evaluate((cardSelector: string): DomChecks | null => {
    const card = document.querySelector(cardSelector);
    if (!card) return null;

    const isVisible = (el: Element): boolean => {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      return el.getClientRects().length > 0;
    };

    // --- placeholderLeaks: visible text nodes leaking internal placeholders.
    const leaks: string[] = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = (node.textContent ?? "").trim();
      if (!/^(base|UNKNOWN|\?)$/.test(text)) continue;
      const parent = node.parentElement;
      if (parent && isVisible(parent)) leaks.push(text);
    }

    // --- paramSortOk: numeric parameter chips must be ascending.
    // Chips are DIRECT button children of the flex-wrap chip row
    // (ParameterSlider / CombinationView); selection buttons in flex-wrap
    // containers (ScoreGrid "Inne", UnknownMarketView) are wrapped in divs,
    // so the direct-child selector does not catch them.
    const chipButtons = Array.from(
      card.querySelectorAll("div.flex.flex-wrap.gap-1 > button"),
    );
    const numericChipValues = chipButtons
      .filter((b) => isVisible(b))
      .map((b) => (b.textContent ?? "").trim())
      .filter((t) => /^[+-]?\d+([.,]\d+)?$/.test(t))
      .map((t) => parseFloat(t.replace(",", ".")));
    const paramSortOk =
      numericChipValues.length >= 2
        ? numericChipValues.every((v, i, arr) => i === 0 || arr[i - 1] <= v)
        : null;

    // --- selectionsRenderedCount: buttons that represent bet selections.
    const chipSet = new Set(chipButtons);
    let selectionsRenderedCount = 0;
    for (const b of Array.from(card.querySelectorAll("button"))) {
      if (chipSet.has(b)) continue;
      if (b.closest("table")) continue; // comparison-panel odds cells
      const title = b.getAttribute("title") ?? "";
      if (title === "Debug Info") continue;
      if (/porówn/i.test(title)) continue; // "Porównaj kursy" / "Ukryj porównanie"
      const text = (b.textContent ?? "").trim();
      if (!text) continue; // icon-only chrome (help tooltip, search clear, ...)
      if (/^Pokaz (wiecej|mniej)/i.test(text)) continue; // ScoreGrid show-more
      if (b.querySelector('svg[class*="chevron-down"]')) continue; // dropdown triggers
      if (!isVisible(b)) continue;
      selectionsRenderedCount++;
    }

    return {
      selectionsRenderedCount,
      placeholderLeaks: leaks,
      paramSortOk,
      emptyRender: selectionsRenderedCount === 0,
    };
  }, CARD_SELECTOR);
}

/**
 * Max horizontal clipping (scrollWidth − clientWidth) across the card and its
 * overflow-* descendants (comparison-table wrappers, ScoreGrid score rows).
 * Truncated single labels (span.truncate) are intentionally not scanned.
 */
async function measureHorizontalClip(page: Page): Promise<number> {
  return page.evaluate((cardSelector: string): number => {
    const card = document.querySelector(cardSelector);
    if (!card) return 0;
    const candidates: Element[] = [card, ...Array.from(card.querySelectorAll('[class*="overflow-"]'))];
    let max = 0;
    for (const el of candidates) {
      const d = el.scrollWidth - el.clientWidth;
      if (d > max) max = d;
    }
    return max;
  }, CARD_SELECTOR);
}

/**
 * Un-clip horizontally overflowing content: let the preview container/card
 * grow to their content width, then report the document width the viewport
 * must cover so a fullPage shot loses no column.
 */
async function unclipAndMeasureWidth(page: Page): Promise<number> {
  await page.evaluate((cardSelector: string) => {
    const style = document.createElement("style");
    style.setAttribute("data-visual-capture-override", "1");
    // min-width keeps the original ~28rem layout as the lower bound so
    // percent-sized children cannot collapse the card.
    style.textContent = `
      [data-testid="market-preview-container"],
      ${cardSelector} {
        max-width: none !important;
        width: max-content !important;
        min-width: 28rem !important;
      }
    `;
    document.head.appendChild(style);
  }, CARD_SELECTOR);
  await page.waitForTimeout(150); // relayout settle
  return page.evaluate((cardSelector: string): number => {
    const card = document.querySelector(cardSelector);
    const cardWidth = card ? card.getBoundingClientRect().width : 0;
    // p-8 page padding = 32px per side; keep a small extra margin.
    return Math.ceil(Math.max(document.documentElement.scrollWidth, cardWidth + 80));
  }, CARD_SELECTOR);
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
    const page = await browser.newPage({ viewport: BASE_VIEWPORT });
    let currentViewportWidth = BASE_VIEWPORT.width;

    // tsx (esbuild keepNames) injects `__name(...)` helper calls into
    // page.evaluate callbacks that declare inner functions; define a no-op
    // in the page so those callbacks can run. Passed as a string so the
    // init script itself is not transformed.
    await page.addInitScript("window.__name = (fn) => fn;");

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
      const viewType =
        entry.viewType ??
        (entry.market as { viewType?: string } | null)?.viewType ??
        null;
      try {
        // Reset viewport if the previous market widened it.
        if (currentViewportWidth !== BASE_VIEWPORT.width) {
          await page.setViewportSize(BASE_VIEWPORT);
          currentViewportWidth = BASE_VIEWPORT.width;
        }

        await page.evaluate((json) => {
          window.localStorage.setItem("market-preview-json", json);
        }, JSON.stringify(entry.market));
        await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForSelector(CARD_SELECTOR, { timeout: 20000 });

        // Expand bookmaker comparison tables so gaps ("—" cells) are visible.
        const toggles = page.locator(
          `${CARD_SELECTOR} button[title="Porównaj kursy"]`,
        );
        const toggleCount = Math.min(await toggles.count(), 3);
        for (let t = 0; t < toggleCount; t++) {
          await toggles.nth(t).click({ timeout: 2000 }).catch(() => {});
        }

        // Expand the player dropdown so the list (not just the trigger) is
        // visible to the judge. PLAYER_DROPDOWN markets render nothing else.
        const dropdownExpanded = await expandPlayerDropdown(page);

        // Let odds/params settle (client-only render; one frame is enough, keep margin).
        await page.waitForTimeout(250);

        // Deterministic DOM facts — computed after all expansions.
        const domChecks = await runDomChecks(page);

        // Un-clip horizontally overflowing comparison tables / score rows and
        // widen the viewport so the fullPage shot shows every column.
        const clip = await measureHorizontalClip(page);
        if (clip > 8) {
          const neededWidth = await unclipAndMeasureWidth(page);
          const targetWidth = Math.min(
            Math.max(BASE_VIEWPORT.width, neededWidth + 16),
            MAX_VIEWPORT_WIDTH,
          );
          if (targetWidth !== currentViewportWidth) {
            await page.setViewportSize({ width: targetWidth, height: BASE_VIEWPORT.height });
            currentViewportWidth = targetWidth;
            await page.waitForTimeout(150);
          }
        }

        await page.screenshot({ path: path.join(outDir, file), fullPage: true });
        manifest.markets.push({
          marketRef: entry.marketRef,
          marketKey: entry.marketKey,
          severity: entry.severity,
          viewType,
          file,
          error: null,
          domChecks,
          dropdownExpanded,
          viewportWidth: currentViewportWidth,
        });
        console.error(`[visual-capture] ${index}/${entries.length} ${entry.marketRef} -> ${file}`);
      } catch (err) {
        manifest.markets.push({
          marketRef: entry.marketRef,
          marketKey: entry.marketKey,
          severity: entry.severity,
          viewType,
          file: null,
          error: String(err).slice(0, 300),
          domChecks: null,
          dropdownExpanded: false,
          viewportWidth: null,
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
