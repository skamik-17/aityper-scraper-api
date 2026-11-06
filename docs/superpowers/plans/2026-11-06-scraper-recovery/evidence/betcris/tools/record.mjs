// Usage: node record.mjs <betcris url> <out.json> [windowMs]  (records every Swarm WS frame with time offsets)
// Record every Swarm WS frame (received + sent) for one page load, with time offsets.
import { chromium } from "/home/skamik/Documents/repositories/personal/aityper-scraper-api/node_modules/playwright/index.mjs";
import fs from "node:fs";
const [url, outFile, windowMs = "12000"] = process.argv.slice(2);
const ARGS = ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu","--disable-blink-features=AutomationControlled"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const b = await chromium.launch({ headless: true, args: ARGS });
const ctx = await b.newContext({ userAgent: UA, locale: "pl-PL", viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
const t0 = Date.now();
const rec = { url, recordedAt: new Date().toISOString(), events: [] };
page.on("websocket", (ws) => {
  rec.events.push({ t: Date.now() - t0, kind: "open", wsUrl: ws.url() });
  ws.on("framesent", (f) => rec.events.push({ t: Date.now() - t0, kind: "sent", payload: f.payload.toString() }));
  ws.on("framereceived", (f) => rec.events.push({ t: Date.now() - t0, kind: "recv", payload: f.payload.toString() }));
  ws.on("close", () => rec.events.push({ t: Date.now() - t0, kind: "close" }));
});
rec.events.push({ t: 0, kind: "goto" });
await page.goto(url, { timeout: 30000, waitUntil: "domcontentloaded" });
rec.events.push({ t: Date.now() - t0, kind: "domcontentloaded" });
await new Promise((r) => setTimeout(r, Number(windowMs)));
rec.title = await page.title();
await b.close();
fs.writeFileSync(outFile, JSON.stringify(rec));
console.log(outFile, rec.events.length, "events", fs.statSync(outFile).size, "bytes");
