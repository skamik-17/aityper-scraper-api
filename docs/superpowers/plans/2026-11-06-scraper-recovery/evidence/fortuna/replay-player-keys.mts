// Offline replay of a Fortuna capture (smoke-full-offer.mts --dump) through the
// normalizer and the repository's own mergeMarketRecord, read-only: no network,
// no DB. It is the pre-merge stand-in for fortuna.md Task 7 checks (1)-(4).
//
// Usage (from a worktree root, through the heavy runner):
//   node_modules/.bin/tsx $E/replay-player-keys.mts <capture.json> <league> [--mononym NAME]
//
// Per capture it prints one RESULT line plus details:
//   full          matches with >= 300 raw markets (the full offer); 0 means NOT RUN
//   bare          PLAYER_*/GOALSCORER_* rows on a bare key (PLAYER_RED_CARD exempt)
//   leak          player params containing a token (>= 4 letters) of either context team
//   labelLeak     player params containing a whole Fortuna team label ("Atl. Madryt",
//                 "Real M.", "A Coruňa"), labels read from Fortuna's own raw names
//   sharedTeamToken / sharedNameToken
//                 tokens in leading or inner position (not last) shared by >= 3 distinct
//                 player params of one match; "team" when the token is a segment of a
//                 Fortuna label of that match (a leak), "name" otherwise (a shared given
//                 name, listed for review). Independent of canonical team names.
//   collisions    "marketKey collision with overlapping selection code" lines that
//                 mergeMarketRecord itself logs for this capture
//   warnNoPlayer  "[fortuna] Player market without extractable player" lines
//   mononym       the keys and legs of player params equal to --mononym (default Murillo)
// and a verdict that says NOT RUN instead of PASS when there is nothing to check.
import fs from "fs";
import path from "path";

const argv = process.argv.slice(2);
const opt = (name: string, def?: string) => {
  const i = argv.indexOf(name);
  if (i < 0) return def;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const mononym = opt("--mononym", "Murillo")!;
const [capturePath, league] = argv;
if (!capturePath || !league) throw new Error("usage: replay-player-keys.mts <capture.json> <league> [--mononym NAME]");
const root = process.cwd();
const capture = JSON.parse(fs.readFileSync(path.resolve(capturePath), "utf8"));
const { normalizeMarketsForBookmaker } = await import(`${root}/src/services/normalization/index.ts`);
const { mergeMarketRecord, resolveStorageMarketKey, getCanonicalMarketCodes } = await import(
  `${root}/src/repositories/full-offer-repository.ts`
);
const canonicalCodes = new Set<string>(getCanonicalMarketCodes());

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const segmentsOf = (label: string) => fold(label).split(/\s+/).flatMap((t) => t.match(/[^.]+\.?/g) ?? []);
const PARTICLES = new Set(["de", "del", "della", "di", "da", "das", "dos", "du", "la", "le", "van", "von", "den", "der", "ten", "ter", "el", "al"]);
const isPlayerType = (t: string) => /^(PLAYER_|GOALSCORER_)/.test(t);

/**
 * Fortuna's own team labels, read from raw names: the team-scoped "Mecz:
 * <label> - liczba ..." shape on typed team markets (player-scoped and
 * unmapped OTHER rows use the same shape with a player name), and the
 * "<label> <player> strzeli pierwszego/ostatniego gola w meczu" prefix.
 */
function fortunaLabels(names: string[], types: string[]): Set<string> {
  const labels = new Set<string>();
  names.forEach((n, i) => {
    const scoped = n.match(/^(?:Mecz|1\.połowa|2\.połowa): ([^, ]+?) (?:-\s|liczba\s)/u);
    if (scoped && types[i] !== "OTHER" && !isPlayerType(types[i])) labels.add(scoped[1].trim());
    const scorer = n.match(/^([^ ]+) [^ ]+ strzeli (?:pierwszego|ostatniego) gola w meczu/u);
    if (scorer && /^GOALSCORER_(FIRST|LAST)$/.test(types[i])) labels.add(scorer[1].trim());
  });
  return labels;
}

const realWarn = console.warn;
const realLog = console.log;
const warns: string[] = [];
const out = { full: 0, bare: [] as string[], leak: [] as string[], labelLeak: [] as string[],
  sharedTeam: [] as string[], sharedName: [] as string[], collisions: [] as string[] };
const mononymRows: Record<string, string[]> = {};
const mononymsPerMatch: string[] = [];

for (const m of capture.matches ?? []) {
  const tag = `${m.homeTeam} vs ${m.awayTeam}`;
  console.log = () => {};
  console.warn = (...a: unknown[]) => { warns.push(a.join(" ")); };
  const norm = normalizeMarketsForBookmaker(JSON.parse(JSON.stringify(m.markets)), "fortuna", m.homeTeam, m.awayTeam, league);
  const recordsMap = new Map();
  for (const x of norm) {
    if (!canonicalCodes.has(String(x.normalizedType))) continue;
    const key = resolveStorageMarketKey(x, x.marketKey || String(x.normalizedType));
    mergeMarketRecord(recordsMap, key, { match_id: tag, bookmaker: "fortuna", market_key: key,
      param_value: x.paramValue, raw_market_name: x.name, selections: [...x.selections] });
  }
  console.log = realLog;
  console.warn = realWarn;
  if (m.markets.length < 300) continue;
  out.full++;

  const names = m.markets.map((r: { name: string }) => String(r.name));
  const types = norm.map((x: { normalizedType: unknown }) => String(x.normalizedType));
  const labels = fortunaLabels(names, types);
  const labelSegs = new Set([...labels].flatMap(segmentsOf));
  const labelSeqs = [...labels].map((l) => segmentsOf(l).join(" "));
  const teamTokens = `${m.homeTeam} ${m.awayTeam}`.split(/[\s.]+/).map(fold).filter((t) => t.length >= 4);
  const tokenParams = new Map<string, Set<string>>();
  const singles = new Set<string>();
  norm.forEach((x: any, j: number) => {
    const type = String(x.normalizedType);
    if (!isPlayerType(type)) return;
    if (!x.paramValue) {
      if (type !== "PLAYER_RED_CARD") out.bare.push(`${tag} | ${type} | ${names[j]}`);
      return;
    }
    const p = String(x.paramValue);
    const words = fold(p).split(/\s+/);
    if (teamTokens.some((t) => words.includes(t))) out.leak.push(`${tag} | ${type}:${p} | ${names[j]}`);
    const seq = ` ${words.join(" ")} `;
    if (labelSeqs.some((l) => seq.includes(` ${l} `))) out.labelLeak.push(`${tag} | ${type}:${p} | ${names[j]}`);
    if (words.length === 1) singles.add(p);
    words.slice(0, -1).forEach((w) => {
      if (PARTICLES.has(w) && !labelSegs.has(w)) return;
      if (!tokenParams.has(w)) tokenParams.set(w, new Set());
      tokenParams.get(w)!.add(p);
    });
    if (p === mononym) (mononymRows[`${tag} | ${x.marketKey}`] ??= []).push(
      ...x.selections.map((s: any) => `${s.normalizedName}@${s.odds}`));
  });
  for (const [w, ps] of tokenParams) {
    if (ps.size < 3) continue;
    const line = `${tag} | ${w}(${ps.size}): ${[...ps].slice(0, 5).join(" | ")}`;
    (labelSegs.has(w) ? out.sharedTeam : out.sharedName).push(line);
  }
  mononymsPerMatch.push(`${tag} | labels=${JSON.stringify([...labels])} | mononyms: ${[...singles].sort().join(", ") || "none"}`);
}

const collisionLines = warns.filter((w) => /marketKey collision with overlapping selection code .* for fortuna /.test(w));
const noPlayer = warns.filter((w) => w.includes("[fortuna] Player market without extractable player"));
const mononymFound = Object.keys(mononymRows).length > 0;
const verdict = out.full === 0
  ? "NOT RUN: no full-offer match (>= 300 raw markets) in the capture"
  : !mononymFound
    ? `PARTIAL: counts checked; mononym '${mononym}' absent, pick one from the 'mononyms' lines and rerun with --mononym`
    : "CHECKED";
console.log("RESULT " + JSON.stringify({
  league, capturedAt: capture.capturedAt ?? null, matches: (capture.matches ?? []).length, full: out.full,
  bare: out.bare.length, leak: out.leak.length, labelLeak: out.labelLeak.length,
  sharedTeamToken: out.sharedTeam.length, sharedNameToken: out.sharedName.length,
  collisions: collisionLines.length, warnNoPlayer: noPlayer.length,
  mononym: mononymFound ? { name: mononym, rows: mononymRows } : { name: mononym, rows: null },
  verdict,
}));
for (const l of out.bare.slice(0, 25)) console.log("  bare        " + l);
for (const l of out.leak.slice(0, 25)) console.log("  leak        " + l);
for (const l of out.labelLeak.slice(0, 25)) console.log("  labelLeak   " + l);
for (const l of out.sharedTeam) console.log("  sharedTeam  " + l);
for (const l of out.sharedName) console.log("  sharedName  " + l);
for (const l of collisionLines.slice(0, 25)) console.log("  collision   " + l);
for (const l of noPlayer.slice(0, 25)) console.log("  warn        " + l);
for (const l of mononymsPerMatch) console.log("  match       " + l);
