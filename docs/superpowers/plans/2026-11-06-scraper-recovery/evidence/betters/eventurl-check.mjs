// Standalone check: do the planned Betby eventUrls render the right match?
import { chromium } from "/home/skamik/Documents/repositories/personal/aityper-scraper-api/node_modules/playwright/index.mjs";
const outDir = process.argv[2];
const targets = [
  ["betters", "https://www.betters.pl/zaklady-sportowe/soccer/england/premier-league/leeds-united-tottenham-hotspur-2725816334213586962"],
  ["lebull", "https://lebull-pl-bb.boxwebcdn.work/event/1/1669818860410376192/1669818860469096448/2725816334213586962"],
];
const browser = await chromium.launch({ headless: true });
for (const [bm, url] of targets) {
  const ctx = await browser.newContext({ locale: "pl-PL", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  let status = null;
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    status = res?.status();
    await page.waitForTimeout(12000);
    // Betby renders inside a shadow root or iframe on some brands; collect text from all frames.
    let text = "";
    for (const f of page.frames()) { try { text += "\n" + (await f.evaluate(() => document.body?.innerText ?? "")); } catch {} }
    const shadow = await page.evaluate(() => {
      const out = [];
      const walk = (root) => { for (const el of root.querySelectorAll("*")) { if (el.shadowRoot) { out.push(el.shadowRoot.textContent || ""); walk(el.shadowRoot); } } };
      walk(document); return out.join("\n");
    });
    text += "\n" + shadow;
    const has = (s) => text.includes(s);
    console.log(JSON.stringify({ bm, url, status, finalUrl: page.url(), frames: page.frames().length, leeds: has("Leeds"), tottenham: has("Tottenham"), notFound: has("Nie znaleziono") || /\b404\b/.test(text), textLen: text.length, sample: text.replace(/\s+/g, " ").slice(0, 300) }));
    await page.screenshot({ path: `${outDir}/eventurl-${bm}.jpg`, type: "jpeg", quality: 45 });
  } catch (e) { console.log(JSON.stringify({ bm, url, status, error: String(e) })); }
  await ctx.close();
}
await browser.close();
