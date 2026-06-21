#!/usr/bin/env npx tsx
/**
 * Betclic visual capture for the audit pipeline.
 *
 * Run by the /audit-betclic orchestrator (NOT by the visual judge). Uses
 * Playwright to screenshot each Betclic market group as rendered on the live
 * site, plus a whole-page screenshot of our frontend match page (Task 3).
 * Writes PNGs + manifest.json that the orchestrator hands to the visual judge.
 *
 * Usage (from backend/):
 *   npx tsx scripts/betclic-visual-capture.ts \
 *     --match <betclicMatchId> --league <slug> --home "<home>" --away "<away>" \
 *     [--prep <prepJsonPath>] [--front-url http://localhost:3000] \
 *     [--backend-url http://localhost:3001] [--out <dir>]
 */
import { chromium, type Browser, type Page } from "playwright";
import { buildEventUrl } from "../src/scrapers/bookmakers/betclic/navigation.js";
import {
  groupMarketsByGroupName,
  matchTileFile,
  safeFileSlug,
  type VisualCaptureManifest,
  type BetclicGroupCapture,
  type FrontSectionCapture,
} from "../src/services/audit/visual-types.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const VIEWPORT = { width: 1440, height: 2200 };
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function getArg(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(flag);
  if (i < 0 || i === argv.length - 1) return undefined;
  return argv[i + 1];
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: VIEWPORT, userAgent: UA, locale: "pl-PL" });
  return context.newPage();
}

/**
 * Capture every rendered market tile on the Betclic match page. Betclic renders a
 * FLAT list of `.marketBox` tiles (one per market, with title + all selections),
 * so we screenshot each tile and return its visible title for later matching.
 * Returns the captured tiles plus an optional full-page fallback filename used
 * when no tiles could be enumerated.
 */
async function captureBetclicTiles(
  page: Page,
  url: string,
  outDir: string,
): Promise<{ tiles: { title: string; file: string }[]; fallbackFile: string | null }> {
  console.error(`[visual-capture] Betclic: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Best-effort cookie banner dismissal. Betclic uses a Commanders Act CMP with a
  // two-step flow; the accept-all button reads "Zaakceptuj wszystko" (substring
  // "akceptuj wszystk" also matches the "Akceptuj wszystkie" variant). Two passes
  // clear both layers if present.
  const consentSelectors = [
    "#popin_tc_privacy_button_2",
    "#popin_tc_privacy_button",
    'button:has-text("Akceptuj wszystk")',
    'button:has-text("Zaakceptuj")',
    'button:has-text("POTWIERDŹ")',
    'button:has-text("Zgadzam")',
  ];
  for (let pass = 0; pass < 2; pass++) {
    for (const sel of consentSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(500);
        break;
      }
    }
  }
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Betclic splits markets across category tabs (Top, Wynik, Gole, Strzelcy,
  // Dokładny wynik, ...). The default "Top" tab shows only a subset, so we iterate
  // every tab and capture the tiles in each, de-duplicating by title. The market
  // tabs live under the <sports-category-filters> element — scoping to it excludes
  // the page's top navigation (Live, Misje, Produkty), whose .tab_item links would
  // otherwise navigate away from the match.
  const tabCount = await page.locator("sports-category-filters .tab_item").count();
  console.error(`[visual-capture] found ${tabCount} market tabs`);

  const tiles: { title: string; file: string }[] = [];
  const seenTitles = new Set<string>();
  let idx = 0;

  // Enumerate + screenshot all market tiles currently visible, skipping ones we
  // already captured under another tab.
  const enumerateCurrent = async (): Promise<void> => {
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 700) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(800);
    const boxes = await page.locator(".marketBox, .market.is-betbuilder").all();
    for (const box of boxes) {
      try {
        const titleLoc = box
          .locator('[class*="title" i], [class*="label" i], [class*="name" i]')
          .first();
        const raw = (await titleLoc.count()) ? (await titleLoc.textContent()) ?? "" : "";
        const title = raw.trim().replace(/\s+/g, " ");
        if (!title || seenTitles.has(title)) continue;
        seenTitles.add(title);
        const file = `betclic__${safeFileSlug(title)}__${idx++}.png`;
        await box.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(100);
        await box.screenshot({ path: join(outDir, file) });
        tiles.push({ title, file });
      } catch {
        // Skip a tile that detached/failed; coverage degrades gracefully.
      }
    }
  };

  // Tabs that are not normalized betting markets (combo builder, stats widgets).
  const SKIP_TABS = new Set(["mycombi", "statystyki"]);
  const tabLabels = await page.evaluate(() =>
    [...document.querySelectorAll("sports-category-filters .tab_item")].map((e) =>
      (e.textContent ?? "").trim(),
    ),
  );

  await enumerateCurrent();
  for (let t = 0; t < tabCount; t++) {
    if (SKIP_TABS.has((tabLabels[t] ?? "").toLowerCase())) {
      console.error(`[visual-capture] tab[${t}] "${tabLabels[t]}": skipped (non-market)`);
      continue;
    }
    try {
      // DOM-click the tab inside the <sports-category-filters> web component. A
      // Playwright mouse click does not reliably switch these custom-element tabs.
      await page.evaluate((i) => {
        const el = document.querySelectorAll<HTMLElement>("sports-category-filters .tab_item")[i];
        if (!el) return;
        el.scrollIntoView({ block: "center", inline: "center" });
        el.click();
      }, t);
      await page.waitForTimeout(900);
      const before = tiles.length;
      await enumerateCurrent();
      console.error(`[visual-capture] tab[${t}] "${tabLabels[t]}": +${tiles.length - before} tiles`);
    } catch {
      // Skip an unclickable tab.
    }
  }
  console.error(`[visual-capture] captured ${tiles.length} unique market tiles`);

  // Fallback: no tiles enumerated -> one full-page screenshot so the judge still
  // has visuals to work from.
  if (tiles.length === 0) {
    const fallbackFile = "betclic__fullpage.png";
    await page.screenshot({ path: join(outDir, fallbackFile), fullPage: true }).catch(() => {});
    console.error(`[visual-capture] no tiles found; wrote full-page fallback`);
    return { tiles, fallbackFile };
  }
  return { tiles, fallbackFile: null };
}

function normTeam(s: string): string {
  return s
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Resolve our internal matchId from the backend odds API by matching team names. */
async function resolveFrontMatchId(
  backendUrl: string,
  league: string,
  home: string,
  away: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${backendUrl}/api/odds?league=${encodeURIComponent(league)}`);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { matches?: Array<{ matchId: string; homeTeam: string; awayTeam: string }> };
    };
    const matches = json.data?.matches ?? [];
    const h = normTeam(home);
    const a = normTeam(away);
    const found = matches.find((m) => normTeam(m.homeTeam) === h && normTeam(m.awayTeam) === a);
    return found?.matchId ?? null;
  } catch {
    return null;
  }
}

/** Whole-page screenshot of our frontend match page (renders all categories on load). */
async function captureFrontend(
  page: Page,
  frontUrl: string,
  league: string,
  ourMatchId: string,
  outDir: string,
): Promise<FrontSectionCapture[]> {
  const url = `${frontUrl}/leagues/${league}/match/${encodeURIComponent(ourMatchId)}`;
  console.error(`[visual-capture] frontend: ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);
  // Scroll through to trigger any lazy rendering, then return to top.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
  const file = "front__all.png";
  await page.screenshot({ path: join(outDir, file), fullPage: true });
  console.error(`[visual-capture] wrote ${file}`);
  return [{ category: "all", file }];
}

async function main() {
  const matchId = getArg("--match");
  if (!matchId) {
    console.error(
      "Usage: --match <id> [--league <slug>] [--home <h>] [--away <a>] [--prep <path>] [--front-url <url>] [--backend-url <url>] [--out <dir>]",
    );
    process.exit(1);
  }
  const league = getArg("--league") ?? "unknown";
  const home = getArg("--home") ?? "";
  const away = getArg("--away") ?? "";
  // Prefer the SEO URL the orchestrator already resolved (eventUrls.betclic); the
  // built fallback may use a wrong league slug for tournaments. The simple
  // /zaklady/m<id> URL does NOT render the full offer, so it is not used.
  const url = getArg("--url") ?? buildEventUrl(matchId, league, home, away);
  const frontUrl = getArg("--front-url") ?? "http://localhost:3000";
  const backendUrl = getArg("--backend-url") ?? "http://localhost:3001";
  const prepPath = getArg("--prep") ?? resolve(process.cwd(), `../docs/betclic-audit/.tmp/${matchId}.json`);
  const date = new Date().toISOString().slice(0, 10);
  const outDir = getArg("--out") ?? resolve(process.cwd(), `../docs/betclic-audit/screenshots/${date}__${matchId}`);
  mkdirSync(outDir, { recursive: true });

  const prep = JSON.parse(readFileSync(prepPath, "utf8")) as {
    markets: { raw: { name: string; groupName: string } }[];
  };
  const groupMap = groupMarketsByGroupName(
    prep.markets.map((m) => ({ name: m.raw.name, groupName: m.raw.groupName })),
  );

  const browser = await chromium.launch({ headless: true });
  let betclicGroups: BetclicGroupCapture[] = [];
  let frontSections: FrontSectionCapture[] = [];
  let frontMatchId: string | null = null;
  let frontendAvailable = false;
  try {
    const bPage = await newPage(browser);
    const { tiles, fallbackFile } = await captureBetclicTiles(bPage, url, outDir);
    // Map each prep market to its captured tile by visible title (or the full-page
    // fallback when no tiles were enumerated).
    betclicGroups = [...groupMap].map(([groupName, names]) => ({
      groupName,
      markets: names.map((name) => ({
        name,
        file: tiles.length > 0 ? matchTileFile(name, tiles) : fallbackFile,
      })),
    }));
    const matched = betclicGroups.flatMap((g) => g.markets).filter((m) => m.file).length;
    const total = betclicGroups.reduce((n, g) => n + g.markets.length, 0);
    console.error(`[visual-capture] matched ${matched}/${total} markets to tiles`);

    // Frontend whole-page capture (best-effort; degrades to "unavailable").
    frontMatchId = home && away ? await resolveFrontMatchId(backendUrl, league, home, away) : null;
    if (frontMatchId) {
      try {
        const fPage = await newPage(browser);
        frontSections = await captureFrontend(fPage, frontUrl, league, frontMatchId, outDir);
        frontendAvailable = true;
      } catch (e) {
        console.error(`[visual-capture] frontend capture failed:`, e);
      }
    } else {
      console.error(`[visual-capture] could not resolve our matchId; skipping frontend`);
    }
  } finally {
    await browser.close();
  }

  const manifest: VisualCaptureManifest = {
    matchId,
    frontMatchId,
    capturedAt: new Date().toISOString(),
    frontendAvailable,
    betclicGroups,
    frontSections,
  };
  const manifestPath = join(outDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(
    JSON.stringify(
      { manifestPath, outDir, betclicGroups: betclicGroups.length, frontendAvailable, league },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error("[visual-capture] FAILED:", e);
  process.exit(1);
});
