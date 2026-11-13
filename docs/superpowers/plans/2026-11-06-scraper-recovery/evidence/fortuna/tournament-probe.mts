// Read-only discovery probe for Fortuna's Ekstraklasa tournament id (fortuna-ekstraklasa.md Task 0).
// Usage (from the repo root, one live run at a time):
//   bin/heavy --live node_modules/.bin/tsx docs/superpowers/plans/2026-11-06-scraper-recovery/evidence/fortuna/tournament-probe.mts > <out.txt>
// It opens one Playwright page on BASE_URL (as navigateToBaseSite does), then prints:
//   1. the HTTP status and fixture count of the current (stale) id;
//   2. every distinct "ufo:tour:" id seen in request URLs and JSON responses under
//      api.efortuna.pl/offer/structure/ while the page loads LEAGUE_URLS.ekstraklasa
//      (falling back to the football section and its Poland / Ekstraklasa link);
//   3. per candidate id: HTTP status, fixture count and the first five fixtures;
//   4. the peer listing (totalbet, plain HTTP) for the same competition in the same run.
// It never calls the markets API and writes nothing: all output goes to stdout.
import { chromium, type Page, type Response } from "playwright";

const REPO = new URL("../../../../../../", import.meta.url).pathname;
const { BASE_URL, API_STRUCTURE_URL, LEAGUE_URLS, TOURNAMENT_IDS } = await import(
  `${REPO}src/scrapers/bookmakers/fortuna/constants.ts`
);
const { fetchLeagueEvents } = await import(`${REPO}src/scrapers/bookmakers/totalbet/api-client.ts`);
const { LEAGUES } = await import(`${REPO}src/config/leagues.ts`);

const OLD_ID: string = TOURNAMENT_IDS.ekstraklasa;
const FOOTBALL_URL = `${BASE_URL}/zaklady-bukmacherskie/pilka-nozna`;
const TOUR_RE = /ufo:tour:[0-9a-z-]+/gi;
const NAME_KEYS = ["name", "title", "label", "longName", "shortName", "seoName", "displayName"];

const log = (...a: unknown[]) => console.log(...a);
log(`# tournament-probe ${new Date().toISOString()} old id ${OLD_ID}`);

// id -> names and where it was seen
const seen = new Map<string, { names: Set<string>; sources: Set<string> }>();
const structurePaths = new Map<string, number>();
function note(id: string, source: string, name?: string): void {
  const key = id.toLowerCase();
  const entry = seen.get(key) ?? { names: new Set<string>(), sources: new Set<string>() };
  if (name) entry.names.add(name);
  entry.sources.add(source);
  seen.set(key, entry);
}
function walk(node: unknown, source: string, depth = 0): void {
  if (depth > 40 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, source, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  const ownName = NAME_KEYS.map((k) => obj[k]).find((v) => typeof v === "string") as string | undefined;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      for (const id of value.match(TOUR_RE) ?? []) {
        // The object's own name only describes the id held in its id-like field.
        note(id, source, key === "id" || key === "tournamentId" ? ownName : undefined);
      }
    } else {
      walk(value, source, depth + 1);
    }
  }
}

async function onResponse(res: Response): Promise<void> {
  const url = res.url();
  if (!url.includes("api.efortuna.pl/offer/structure/")) return;
  const path = url.split("?")[0].replace(/^https:\/\/api\.efortuna\.pl/, "");
  structurePaths.set(`${res.status()} ${path}`, (structurePaths.get(`${res.status()} ${path}`) ?? 0) + 1);
  for (const id of url.match(TOUR_RE) ?? []) note(id, "request-url");
  try {
    const ctype = res.headers()["content-type"] ?? "";
    if (!ctype.includes("json")) return;
    walk(await res.json(), `json:${path.slice(0, 120)}`);
  } catch {
    // body not available (redirect, aborted) - the URL was still recorded
  }
}

async function fixturesOf(page: Page, tid: string): Promise<{ status: number; count: number; fixtures: any[]; error?: string }> {
  return page.evaluate(
    async ({ structureUrl, id }) => {
      try {
        const res = await fetch(`${structureUrl}/prematch/tournament/${id}/fixtures`);
        const text = await res.text();
        let body: any = null;
        try { body = JSON.parse(text); } catch { return { status: res.status, count: -1, fixtures: [], error: `non-JSON body: ${text.slice(0, 120)}` }; }
        const fixtures = Array.isArray(body?.fixtures) ? body.fixtures : [];
        return { status: res.status, count: fixtures.length, fixtures };
      } catch (err) {
        return { status: -1, count: -1, fixtures: [], error: String(err) };
      }
    },
    { structureUrl: API_STRUCTURE_URL, id: tid }
  );
}

function describeFixture(f: any): string {
  const teams = Array.isArray(f?.participants) ? f.participants.map((p: any) => `${p?.type ?? "?"}:${p?.name}`).join(" | ") : f?.name;
  const start = typeof f?.startDatetime === "number" ? new Date(f.startDatetime).toISOString() : String(f?.startDatetime);
  return `${start}  ${teams}  (tournamentId ${f?.tournamentId ?? "?"}, ${f?.id ?? "?"})`;
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    "--disable-blink-features=AutomationControlled", "--window-size=1920,1080"],
});
try {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "pl-PL",
  });
  const page = await context.newPage();
  const pending: Promise<void>[] = [];
  page.on("response", (res) => { pending.push(onResponse(res)); });

  const base = await page.goto(BASE_URL, { timeout: 30000, waitUntil: "domcontentloaded" });
  log(`base ${BASE_URL} -> HTTP ${base?.status()} ${page.url()}`);

  // 1. The stale id.
  const old = await fixturesOf(page, OLD_ID);
  log(`\n## 1. old id ${OLD_ID}: HTTP ${old.status}, fixtures ${old.count}${old.error ? `, error ${old.error}` : ""}`);
  for (const f of old.fixtures.slice(0, 5)) log(`  ${describeFixture(f)}`);

  // 2. Ids the league page (or the football section) asks for.
  const leagueUrl: string = LEAGUE_URLS.ekstraklasa;
  const lp = await page.goto(leagueUrl, { timeout: 45000, waitUntil: "domcontentloaded" }).catch((e) => { log(`league page error ${e}`); return null; });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  log(`\n## 2. league page ${leagueUrl} -> HTTP ${lp?.status() ?? "none"} ${page.url()}`);
  await Promise.allSettled(pending.splice(0));
  const hasEkstraklasaName = () => [...seen.values()].some((e) => [...e.names].some((n) => /ekstraklasa/i.test(n)));
  if (!lp || (lp.status() ?? 0) >= 400 || !hasEkstraklasaName()) {
    const fp = await page.goto(FOOTBALL_URL, { timeout: 45000, waitUntil: "domcontentloaded" }).catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    log(`fallback football section ${FOOTBALL_URL} -> HTTP ${fp?.status() ?? "none"} ${page.url()}`);
    const links: { href: string; text: string }[] = await page.$$eval("a[href]", (as) =>
      as.map((a) => ({ href: (a as HTMLAnchorElement).href, text: (a.textContent ?? "").trim().replace(/\s+/g, " ") }))
    );
    const poland = links.filter((l) => /ekstraklasa|polska/i.test(l.href) || /ekstraklasa|polska/i.test(l.text));
    for (const l of poland.slice(0, 20)) log(`  link ${l.text} -> ${l.href}`);
    const target = poland.find((l) => /ekstraklasa/i.test(l.href) || /ekstraklasa/i.test(l.text));
    if (target) {
      const tp = await page.goto(target.href, { timeout: 45000, waitUntil: "domcontentloaded" }).catch(() => null);
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      log(`followed ${target.href} -> HTTP ${tp?.status() ?? "none"} ${page.url()}`);
    }
    await Promise.allSettled(pending.splice(0));
  }
  log(`structure endpoints seen:`);
  for (const [p, n] of [...structurePaths].sort()) log(`  ${n}x ${p}`);
  log(`tournament ids seen: ${seen.size}`);
  for (const [id, e] of [...seen].sort()) {
    log(`  ${id}  names=${JSON.stringify([...e.names])}  sources=${[...e.sources].slice(0, 3).join(", ")}`);
  }

  // 3. Candidate ids' fixtures: ids named like a Polish competition or requested by the
  // page itself, plus the old id side by side. With no such id, the first 40 seen.
  const polish = /ekstraklasa|polsk|poland|polska/i;
  let candidates = [...seen].filter(([id, e]) => id === OLD_ID || e.sources.has("request-url") || [...e.names].some((n) => polish.test(n))).map(([id]) => id);
  if (candidates.length <= 1) candidates = [...seen.keys()].slice(0, 40);
  log(`\n## 3. candidates (${candidates.length})`);
  for (const id of candidates.sort()) {
    const r = await fixturesOf(page, id);
    log(`candidate ${id}: HTTP ${r.status}, fixtures ${r.count}${r.error ? `, error ${r.error}` : ""}  names=${JSON.stringify([...(seen.get(id)?.names ?? [])])}`);
    for (const f of r.fixtures.slice(0, 5)) log(`  ${describeFixture(f)}`);
    const tids = [...new Set(r.fixtures.map((f: any) => f?.tournamentId))];
    if (r.count > 0) log(`  fixture tournamentIds ${JSON.stringify(tids)}`);
  }
} finally {
  await browser.close();
}

// 4. Peer listing in the same run (totalbet dealer API, plain HTTP, list endpoint only).
const ekstraklasa = (LEAGUES as any[]).find((l) => l.slug === "ekstraklasa");
const totalbetId = String(ekstraklasa?.bookmakers?.totalbet?.id ?? "");
const peer = await fetchLeagueEvents(totalbetId);
log(`\n## 4. peer totalbet ${totalbetId}: events ${peer.events.length}${peer.error ? `, error ${peer.error}` : ""}`);
for (const ev of [...peer.events].sort((a: any, b: any) => String(a.start_at).localeCompare(String(b.start_at)))) {
  log(`  ${ev.start_at}  ${ev.participants.map((p: any) => p.name).join(" | ")}`);
}
log(`\n# done ${new Date().toISOString()}`);
