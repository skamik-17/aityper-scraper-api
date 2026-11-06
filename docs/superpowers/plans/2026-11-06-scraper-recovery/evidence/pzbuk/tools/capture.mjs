// Fresh read-only capture of PZBuk WS frames: one league page + one event page.
// Mirrors navigation.ts single-event timing (2s wait, cookie, expansion at ~3s,
// stabilization MIN_CAPTURE_MS=8000 / STREAM_SILENCE_MS=2500 / WS_MAX_WAIT=25000).
import { chromium } from "/home/skamik/Documents/repositories/personal/aityper-scraper-api/node_modules/playwright/index.mjs";
import fs from "node:fs";

const OUT = process.argv[2];
const LEAGUE_URL = "https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/134-england-premier-league";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--window-size=1920,1080"] });
const context = await browser.newContext({ userAgent: UA, locale: "pl-PL", viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();

let phase = "league";
const frames = { league: [], event: [] };
const sockets = [];
let lastRecv = Date.now();

page.on("websocket", (ws) => {
  const rec = { phase, url: ws.url(), openedAt: Date.now(), closedAt: null };
  sockets.push(rec);
  ws.on("close", () => { rec.closedAt = Date.now(); });
  const push = (dir) => (f) => {
    const p = f.payload;
    const isBuf = Buffer.isBuffer(p);
    const buf = isBuf ? p : Buffer.from(String(p), "utf8");
    frames[phase].push({ dir, t: Date.now(), url: ws.url(), binary: isBuf, byteLength: buf.length, b64: buf.toString("base64") });
    if (dir === "recv") lastRecv = Date.now();
  };
  ws.on("framereceived", push("recv"));
  ws.on("framesent", push("sent"));
});

const resp = await page.goto(LEAGUE_URL, { timeout: 30000, waitUntil: "domcontentloaded" });
const leagueMeta = { status: resp?.status(), finalUrl: page.url(), title: await page.title().catch(() => "") };
await page.waitForTimeout(6000);
console.log(`[league] status=${leagueMeta.status} final=${leagueMeta.finalUrl} frames=${frames.league.length}`);

// Pick the first fixture from the decoded league frames to build the event URL
let leagueState = null;
for (const f of frames.league) {
  if (f.dir !== "recv") continue;
  try {
    const env = JSON.parse(Buffer.from(f.b64, "base64").toString("utf8"));
    for (const m of Array.isArray(env?.payload) ? env.payload : []) {
      if (m?.type === "INITIAL_STATE" && m.payload?.events?.length > 1) leagueState = m.payload;
    }
  } catch { /* ignore */ }
}
if (!leagueState) { console.log("no league state"); fs.writeFileSync(`${OUT}/capture.json`, JSON.stringify({ leagueMeta, sockets, frames })); await browser.close(); process.exit(1); }

// Choose a fixture that starts soonest and is not live
const fixtures = leagueState.events.filter((e) => e.type === "Fixture" && !e.isSuspended && !e.isLive).sort((a, b) => String(a.startingOn).localeCompare(String(b.startingOn)));
const ev = fixtures[Number(process.argv[3] || 0)];
const parts = Object.values(ev.primaryParticipants);
const home = parts.find((p) => p.venueRole === "Home").name.trim();
const away = parts.find((p) => p.venueRole === "Away").name.trim();
const slug = `${home}-${away}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ls = ev.leagueName?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
const eventUrl = `https://www.pzbuk.pl/pl/sportsbook/sport/1-pilka-nozna/leagues/${ev.leagueId}-${ls}/events/${ev.id}-${slug}`;
console.log(`[event] ${home} - ${away} -> ${eventUrl}`);

phase = "event";
const t1 = Date.now();
const er = await page.goto(eventUrl, { timeout: 30000, waitUntil: "domcontentloaded" });
const eventMeta = { status: er?.status(), finalUrl: page.url(), eventId: ev.id, home, away, startingOn: ev.startingOn };
await page.waitForTimeout(2000);
const accept = page.locator("#onetrust-accept-btn-handler").first();
eventMeta.cookieButton = await accept.isVisible({ timeout: 1000 }).catch(() => false);
if (eventMeta.cookieButton) await accept.click().catch(() => {});
while (Date.now() - t1 < 3000) await page.waitForTimeout(100);
const headers = page.locator('[class*="content-box__HeaderContainer"]');
eventMeta.headerCount = await headers.count().catch(() => 0);
let clicked = 0;
for (let i = 0; i < eventMeta.headerCount; i++) {
  const h = headers.nth(i);
  if (await h.isVisible({ timeout: 300 }).catch(() => false)) { await h.click({ timeout: 3000 }).catch(() => {}); clicked++; await page.waitForTimeout(60); }
}
let shown = 0;
for (let i = 0; i < 40; i++) {
  const sm = page.getByText("Pokaż więcej").first();
  if (!(await sm.isVisible({ timeout: 300 }).catch(() => false))) break;
  await sm.click({ timeout: 3000 }).catch(() => {}); shown++; await page.waitForTimeout(60);
}
eventMeta.headersClicked = clicked; eventMeta.showMoreClicked = shown;
while (Date.now() - t1 < 25000) {
  if (Date.now() - t1 >= 8000 && Date.now() - lastRecv >= 2500) break;
  await page.waitForTimeout(300);
}
eventMeta.elapsedMs = Date.now() - t1;
eventMeta.groupHeaderTexts = await headers.allInnerTexts().catch(() => []);
console.log(JSON.stringify(eventMeta));
fs.writeFileSync(`${OUT}/capture.json`, JSON.stringify({ capturedAt: new Date().toISOString(), leagueMeta, eventMeta, sockets, frames }));
await page.screenshot({ path: `${OUT}/event.png` }).catch(() => {});
await browser.close();
