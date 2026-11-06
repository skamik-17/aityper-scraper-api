import { chromium } from "/home/skamik/Documents/repositories/personal/aityper-scraper-api/node_modules/playwright/index.mjs";
const url = process.argv[2];
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext();
const page = await ctx.newPage();
const t0 = Date.now(); const ev = [];
const at = (k, x) => ev.push({ t: Date.now() - t0, k, ...x });
page.on("request", (r) => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) at("navreq", { url: r.url() }); });
page.on("framenavigated", (f) => { if (f === page.mainFrame()) at("framenavigated", { url: f.url() }); });
page.on("domcontentloaded", () => at("dcl", { url: page.url() }));
page.on("websocket", (ws) => { at("ws", { url: ws.url() }); let n = 0; ws.on("framereceived", (f) => { const p = String(f.payload); if (n < 50 && p.includes('"sport"')) { n++; if (n === 1) at("firstSportFrame", { len: p.length }); } }); });
let gotoErr = null;
try { const resp = await page.goto(url, { timeout: 30000, waitUntil: "domcontentloaded" }); at("gotoResolved", { status: resp?.status(), respUrl: resp?.url(), pageUrl: page.url() }); }
catch (e) { gotoErr = String(e).slice(0, 200); at("gotoRejected", { err: gotoErr }); }
await page.waitForTimeout(6000);
at("end", { pageUrl: page.url(), title: await page.title().catch(() => null) });
console.log(JSON.stringify({ url, events: ev }, null, 1));
await b.close();
