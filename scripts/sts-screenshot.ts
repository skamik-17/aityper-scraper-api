#!/usr/bin/env npx tsx
/**
 * STS Screenshot Script
 * 
 * Takes a screenshot of a STS match page, optionally scrolling to a specific market.
 * 
 * Usage:
 *   npx tsx scripts/sts-screenshot.ts <match_url> [market_name]
 * 
 * Examples:
 *   npx tsx scripts/sts-screenshot.ts https://www.sts.pl/kursy/osasuna-real-oviedo/f1283317
 *   npx tsx scripts/sts-screenshot.ts https://www.sts.pl/kursy/osasuna-real-oviedo/f1283317 "Obie strzelą"
 */

import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const args = process.argv.slice(2);
const MATCH_URL = args[0];
const MARKET_NAME = args[1];

if (!MATCH_URL) {
  console.log("Usage: npx tsx scripts/sts-screenshot.ts <match_url> [market_name]");
  console.log("Example: npx tsx scripts/sts-screenshot.ts https://www.sts.pl/kursy/osasuna-real-oviedo/f1283317 \"Obie strzelą\"");
  process.exit(1);
}

async function main() {
  console.log(`\n📸 STS Screenshot Tool`);
  console.log(`${"=".repeat(60)}`);
  console.log(`URL: ${MATCH_URL}`);
  if (MARKET_NAME) {
    console.log(`Market: "${MARKET_NAME}"`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 4000 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    console.log(`\n🌐 Navigating to page...`);
    await page.goto(MATCH_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    
    console.log(`⏳ Waiting for page to load...`);
    await page.waitForTimeout(3000);
    
    console.log(`🍪 Closing cookie popup if present...`);
    try {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      
      const cookieSelectors = [
        "button:has-text('Akceptuj wszystkie')",
        "button:has-text('Akceptuję')",
        "button:has-text('Zgadzam się')",
        "button:has-text('OK')",
        "[data-testid='cookie-accept']",
      ];
      
      for (const selector of cookieSelectors) {
        try {
          const btn = page.locator(selector).first();
          if (await btn.isVisible({ timeout: 500 })) {
            await btn.click();
            console.log(`   ✅ Cookie popup closed via: ${selector}`);
            await page.waitForTimeout(500);
            break;
          }
        } catch {}
      }
    } catch {
      console.log(`   ℹ️  Cookie handling skipped`);
    }
    
    await page.waitForTimeout(2000);

    if (MARKET_NAME) {
      console.log(`🔍 Searching for market: "${MARKET_NAME}"`);
      
      const marketElement = await page.locator(`text="${MARKET_NAME}"`).first();
      const isVisible = await marketElement.isVisible().catch(() => false);
      
      if (isVisible) {
        console.log(`✅ Found market, scrolling into view...`);
        await marketElement.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        
        const box = await marketElement.boundingBox();
        if (box) {
          await page.evaluate((y) => window.scrollTo(0, y - 200), box.y);
        }
      } else {
        console.log(`⚠️  Market "${MARKET_NAME}" not found directly, trying partial match...`);
        
        const partialMatch = await page.locator(`text=/${MARKET_NAME}/i`).first();
        const partialVisible = await partialMatch.isVisible().catch(() => false);
        
        if (partialVisible) {
          console.log(`✅ Found partial match, scrolling into view...`);
          await partialMatch.scrollIntoViewIfNeeded();
          await page.waitForTimeout(500);
        } else {
          console.log(`❌ Market not found on page`);
        }
      }
    }

    await page.waitForTimeout(1000);

    const screenshotsDir = path.join(process.cwd(), "screenshots");
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const marketSlug = MARKET_NAME ? `-${MARKET_NAME.replace(/[^a-z0-9]/gi, "_")}` : "";
    const filename = `sts-${timestamp}${marketSlug}.png`;
    const filepath = path.join(screenshotsDir, filename);

    console.log(`\n📷 Taking full page screenshot...`);
    await page.screenshot({ 
      path: filepath, 
      fullPage: true,
    });

    console.log(`✅ Screenshot saved: ${filepath}`);

    if (MARKET_NAME) {
      console.log(`\n📊 Extracting market data...`);
      
      const marketData = await page.evaluate((marketName) => {
        const results: { selection: string; odds: string }[] = [];
        
        const allElements = document.querySelectorAll("*");
        let marketSection: Element | null = null;
        
        for (const el of allElements) {
          if (el.textContent?.includes(marketName) && el.children.length > 0) {
            marketSection = el.closest("[class*='market']") || el.closest("[class*='bet']") || el.parentElement;
            break;
          }
        }
        
        if (marketSection) {
          const buttons = marketSection.querySelectorAll("button, [class*='odds'], [class*='selection']");
          for (const btn of buttons) {
            const text = btn.textContent?.trim() || "";
            const oddsMatch = text.match(/(\d+[.,]\d+)/);
            if (oddsMatch) {
              const selectionText = text.replace(oddsMatch[0], "").trim();
              if (selectionText) {
                results.push({
                  selection: selectionText,
                  odds: oddsMatch[0],
                });
              }
            }
          }
        }
        
        return results;
      }, MARKET_NAME);

      if (marketData.length > 0) {
        console.log(`\n| Selekcja | Kurs |`);
        console.log(`|----------|------|`);
        for (const item of marketData) {
          console.log(`| ${item.selection} | ${item.odds} |`);
        }
      } else {
        console.log(`⚠️  Could not extract market data automatically`);
        console.log(`   Check the screenshot manually: ${filepath}`);
      }
    }

  } catch (error) {
    console.error(`\n❌ Error:`, error);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
