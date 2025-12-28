/**
 * Universal JSON Capture Script
 * Captures ALL JSON responses during page load for analysis
 * Run: npx tsx backend/src/scrapers/bookmakers/capture-all-json.ts <bookmaker>
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOOKMAKER_URLS: Record<string, string> = {
  sts: "https://www.sts.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/1/1/17",
  betclic: "https://www.betclic.pl/pilka-nozna-s1/anglia-premier-league-c3",
  fuksiarz: "https://fuksiarz.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league",
  betfan: "https://betfan.pl/lista-zakladow/pilka-nozna/anglia/premier-league/244",
  forbet: "https://www.iforbet.pl/zaklady-bukmacherskie/155/199",
  etoto: "https://www.etoto.pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league/206",
  totalbet: "https://totalbet.pl/sports/events/Pi%C5%82ka-no%C5%BCna/7124?uncheckAll=true",
  betcris: "https://www.betcris.pl/sports/1/leagues/1",
  betters: "https://betterspl-ssr.boxwebcdn.work/pl/league/1/4485",
  lebull: "https://lebullpl-ssr.boxwebcdn.work/pl/league/1/4485",
  pzbuk: "https://www.pzbuk.pl/zaklady-bukmacherskie/pilka-nozna/anglia-premier-league",
};

interface CapturedResponse {
  url: string;
  status: number;
  contentType: string;
  size: number;
  data: any;
  timestamp: string;
}

async function captureAllJson(bookmaker: string) {
  const url = BOOKMAKER_URLS[bookmaker];
  if (!url) {
    console.error(`Unknown bookmaker: ${bookmaker}`);
    console.log("Available:", Object.keys(BOOKMAKER_URLS).join(", "));
    process.exit(1);
  }

  const outputDir = path.join(__dirname, "captured-json", bookmaker);
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    locale: "pl-PL",
  });
  const page = await context.newPage();

  const capturedResponses: CapturedResponse[] = [];
  const wsMessages: { url: string; message: string; timestamp: string }[] = [];

  // Capture all HTTP responses
  page.on("response", async (response) => {
    const reqUrl = response.url();
    const status = response.status();
    const contentType = response.headers()["content-type"] || "";

    // Skip static assets
    if (reqUrl.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|ico)(\?|$)/i)) {
      return;
    }

    // Capture JSON responses
    if (contentType.includes("json") || contentType.includes("application/javascript")) {
      try {
        const text = await response.text();
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          // Maybe it's JSONP or wrapped JSON
          const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
          if (jsonMatch) {
            try {
              data = JSON.parse(jsonMatch[0]);
            } catch {
              data = { _raw: text.substring(0, 5000) };
            }
          } else {
            return; // Not JSON
          }
        }

        capturedResponses.push({
          url: reqUrl,
          status,
          contentType,
          size: text.length,
          data,
          timestamp: new Date().toISOString(),
        });

        console.log(`[JSON] ${status} ${reqUrl.substring(0, 100)}... (${text.length} bytes)`);
      } catch (e) {
        // Ignore errors
      }
    }
  });

  // Capture WebSocket messages
  page.on("websocket", (ws) => {
    const wsUrl = ws.url();
    console.log(`[WS] Connected: ${wsUrl.substring(0, 80)}...`);

    ws.on("framereceived", (frame) => {
      const payload = frame.payload.toString();
      if (payload.length > 10) {
        wsMessages.push({
          url: wsUrl,
          message: payload,
          timestamp: new Date().toISOString(),
        });
      }
    });
  });

  console.log(`\n=== Capturing JSON for ${bookmaker.toUpperCase()} ===`);
  console.log(`URL: ${url}\n`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Wait for additional network activity
  await page.waitForTimeout(8000);

  // Wait extra time for lazy-loaded content
  await page.waitForTimeout(5000);

  // Scroll to trigger more loading
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(3000);

  await browser.close();

  // Save all captured data
  console.log(`\n=== Saving ${capturedResponses.length} JSON responses ===\n`);

  // Save individual files
  capturedResponses.forEach((resp, i) => {
    const filename = `${i.toString().padStart(3, "0")}_${resp.url.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 80)}.json`;
    fs.writeFileSync(path.join(outputDir, filename), JSON.stringify(resp, null, 2));
  });

  // Save summary
  const summary = {
    bookmaker,
    url,
    capturedAt: new Date().toISOString(),
    totalResponses: capturedResponses.length,
    totalWsMessages: wsMessages.length,
    responses: capturedResponses.map((r) => ({
      url: r.url,
      size: r.size,
      hasMatchData: detectMatchData(r.data),
    })),
  };

  fs.writeFileSync(path.join(outputDir, "_summary.json"), JSON.stringify(summary, null, 2));

  // Save WebSocket messages
  if (wsMessages.length > 0) {
    fs.writeFileSync(path.join(outputDir, "_websocket.json"), JSON.stringify(wsMessages, null, 2));
  }

  // Analyze for match data
  console.log("\n=== ANALYSIS: Responses with potential match/odds data ===\n");

  capturedResponses.forEach((resp, i) => {
    const analysis = detectMatchData(resp.data);
    if (analysis.score > 0) {
      console.log(`[${i}] ${resp.url.substring(0, 100)}`);
      console.log(`    Score: ${analysis.score}, Reasons: ${analysis.reasons.join(", ")}`);
      console.log(`    Size: ${resp.size} bytes`);

      if (analysis.score >= 3) {
        console.log(`    >>> HIGH PRIORITY - likely contains match data <<<`);
        console.log(`    Sample:`, JSON.stringify(resp.data).substring(0, 500));
      }
      console.log();
    }
  });

  // Check WebSocket for match data
  if (wsMessages.length > 0) {
    console.log("\n=== WebSocket Messages with potential match data ===\n");
    const matchWs = wsMessages.filter((m) => {
      const lower = m.message.toLowerCase();
      return lower.includes("odds") || lower.includes("match") || lower.includes("event") ||
             lower.includes("team") || lower.includes("home") || lower.includes("away");
    });

    matchWs.slice(0, 10).forEach((m, i) => {
      console.log(`[WS ${i}] ${m.message.substring(0, 500)}`);
      console.log();
    });

    console.log(`Total WS messages with match data: ${matchWs.length}/${wsMessages.length}`);
  }

  console.log(`\n=== Files saved to: ${outputDir} ===`);
}

function detectMatchData(data: any): { score: number; reasons: string[] } {
  const str = JSON.stringify(data).toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  // Check for team-related fields
  if (str.includes('"home"') || str.includes('"away"') || str.includes('"hometeam"') || str.includes('"awayteam"')) {
    score += 2;
    reasons.push("team fields");
  }

  // Check for odds-related fields
  if (str.includes('"odds"') || str.includes('"price"') || str.includes('"rate"') || str.includes('"decimal"')) {
    score += 2;
    reasons.push("odds fields");
  }

  // Check for event/match fields
  if (str.includes('"event"') || str.includes('"match"') || str.includes('"fixture"')) {
    score += 1;
    reasons.push("event/match fields");
  }

  // Check for market fields
  if (str.includes('"market"') || str.includes('"selection"') || str.includes('"outcome"')) {
    score += 1;
    reasons.push("market fields");
  }

  // Check for Premier League teams (sample)
  const teams = ["liverpool", "arsenal", "chelsea", "manchester", "tottenham", "newcastle", "brighton"];
  for (const team of teams) {
    if (str.includes(team)) {
      score += 3;
      reasons.push(`team name: ${team}`);
      break;
    }
  }

  // Check for 1X2 pattern
  if ((str.includes('"1"') && str.includes('"x"') && str.includes('"2"')) ||
      (str.includes('"1x2"'))) {
    score += 2;
    reasons.push("1X2 pattern");
  }

  return { score, reasons };
}

// Run
const bookmaker = process.argv[2] || "sts";
captureAllJson(bookmaker).catch(console.error);
