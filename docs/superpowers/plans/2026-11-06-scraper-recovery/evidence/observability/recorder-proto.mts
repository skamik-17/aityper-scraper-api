// Prototype of the proposed NavigationRecorder (base-scraper diagnostics).
// Records main-frame document responses, non-2xx fetch/xhr responses and websocket URLs.
import { chromium } from "/home/skamik/Documents/repositories/personal/aityper-scraper-api/node_modules/playwright/index.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function attach(page: any) {
  const d: any = { documents: [], failedRequests: [], websockets: [] };
  page.on("response", (r: any) => {
    const req = r.request();
    const type = req.resourceType();
    if (type === "document" && r.frame() === page.mainFrame()) {
      let first = req; while (first.redirectedFrom()) first = first.redirectedFrom();
      d.documents.push({ requestedUrl: first.url(), finalUrl: r.url(), status: r.status() });
    } else if ((type === "fetch" || type === "xhr") && r.status() >= 400) {
      d.failedRequests.push({ url: r.url(), status: r.status(), resourceType: type });
    }
  });
  page.on("websocket", (ws: any) => { if (d.websockets.length < 5) d.websockets.push(ws.url()); });
  return d;
}

const targets: Array<{ name: string; run: (page: any) => Promise<void> }> = [
  { name: "betters", run: async (p) => { await p.goto("https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485", { waitUntil: "domcontentloaded", timeout: 30000 }); } },
  { name: "totalbet", run: async (p) => {
      await p.goto("https://totalbet.pl", { waitUntil: "domcontentloaded", timeout: 30000 });
      await p.evaluate(async () => { try { await fetch("https://totalbet.pl/rest/market/categories/multi/7124/events"); } catch {} });
    } },
  { name: "pzbuk", run: async (p) => { await p.goto("https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/134-england-premier-league", { waitUntil: "domcontentloaded", timeout: 30000 }); await p.waitForTimeout(6000); } },
];

const browser = await chromium.launch({ headless: true });
const out: any = {};
for (const t of targets) {
  const ctx = await browser.newContext({ userAgent: UA, locale: "pl-PL" });
  const page = await ctx.newPage();
  const d = attach(page);
  let gotoError: string | null = null;
  try { await t.run(page); } catch (e: any) { gotoError = String(e?.message ?? e).split("\n")[0]; }
  d.finalUrl = page.url();
  try { d.title = await page.title(); } catch {}
  d.gotoError = gotoError;
  out[t.name] = d;
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
