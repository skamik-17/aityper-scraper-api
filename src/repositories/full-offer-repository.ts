import { createHash } from "node:crypto";
import { getSupabase } from "../config/database.js";
import type { PolishBookmaker } from "../config/index.js";
import type { ScrapedMarket, MarketSelection } from "../types/full-offer.js";
import type { NormalizedMarketType } from "../types/normalization.js";
import { MarketCategory } from "../services/normalization/types.js";
import { getCanonicalTeamName, getNormalizedTeamName } from "../utils/team-matcher.js";
import { calculateBestOdds } from "../utils/market-aggregation.js";
import { RepositoryError } from "../utils/errors.js";
import { fetchAllRows } from "../utils/supabase-pagination.js";
import {
  CANONICAL_MARKET_CODES,
  MARKET_BY_CODE,
} from "../data/market-catalog.js";

export interface OddsInsert {
  match_id: string;
  league_slug: string;
  home_team: string;
  away_team: string;
  bookmaker: PolishBookmaker;
  event_url?: string;
  market_type_id: number;
  market_key: string;
  param_value?: string;
  custom_name?: string;
  raw_market_name?: string;
  selections: MarketSelection[];
  scraped_at: string;
  start_time?: string;
}

export interface MarketComparisonEntry {
  market_key: string;
  normalized_type: string;
  category: string;
  param_value?: string;
  bookmaker: PolishBookmaker;
  market_name: string;
  selections: MarketSelection[];
  event_url?: string;
  scraped_at: string;
}

export interface FullOfferComparison {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  markets: Record<string, {
    type: NormalizedMarketType;
    category: MarketCategory;
    name: string;
    paramValue?: string;
    bookmakerOdds: Record<PolishBookmaker, {
      selections: MarketSelection[];
      eventUrl?: string;
      scrapedAt: string;
      rawMarketName?: string;
    }>;
    bestOdds: Record<string, { bookmaker: PolishBookmaker; odds: number }>;
  }>;
}

function generateMatchId(homeTeam: string, awayTeam: string, leagueSlug: string): string {
  const homeNorm = getNormalizedTeamName(homeTeam, leagueSlug);
  const awayNorm = getNormalizedTeamName(awayTeam, leagueSlug);
  return `${leagueSlug}:${homeNorm}:${awayNorm}`;
}

function isCanonicalMarket(normalizedType: string | undefined): boolean {
  if (!normalizedType) return false;
  return CANONICAL_MARKET_CODES.has(normalizedType);
}

function getMarketTypeId(normalizedType: string): number | null {
  const market = MARKET_BY_CODE.get(normalizedType);
  return market?.numericId ?? null;
}

/**
 * OTHER is the catch-all bucket every raw market a bookmaker's normalizer
 * fails to classify collapses to (normalizedType/marketKey "OTHER", no
 * distinguishing parameter). Used bare as mergeMarketRecord()'s map key,
 * this made ALL of one bookmaker's unrelated unmapped raw markets collide
 * into ONE DB row per (match, bookmaker) — e.g. pzbuk's real 15-selection
 * "Handicap" grid absorbing a full scorer list, O/U thresholds, ODD/EVEN,
 * exact goal counts, asian handicap lines and exact scores under one row,
 * 136 selections deep; forbet's genuine 2-selection tak/nie market polluted
 * with 5 extra selections from an unrelated goals-count market (audit-match
 * Arsenal vs Coventry City, round 4 P-repo-other-collision).
 *
 * Give OTHER a per-raw-market suffix here so each raw market gets its own
 * DB row instead of merging. Prefer the bookmaker's own raw market id
 * (stable, present on ScrapedMarket — see bookmakerMarketId in
 * ../types/full-offer.js — and carried through normalizeMarketsForBookmaker
 * via its `...market` spread); fall back to a hash of the raw market name
 * when no id is available. Both are deterministic across re-scrapes of the
 * SAME raw market, so a re-scrape updates the same row via the upsert's
 * (match_id, bookmaker, market_key, scraped_at) conflict target instead of
 * duplicating it, and pruneStaleOddsRows() (which prunes by match+bookmaker+
 * scraped_at only, never by market_key) keeps cleaning up old scrapes
 * exactly as before.
 *
 * This suffix stays fully opaque to every downstream reader: market-type-
 * grouper.ts groups by normalizedType (not this literal string), and
 * getFullOfferByMatch()/the "odds" table's views resolve category/market
 * code from the market_type_id FK — never by parsing market_key — so OTHER
 * still renders as ONE catch-all API category, just made of several clean
 * per-raw-market rows instead of one polluted merge.
 *
 * Only the literal "OTHER" catch-all is touched; every other (legitimate
 * parameterized-ladder, e.g. PLAYER_SHOTS) marketKey is returned unchanged,
 * so mergeMarketRecord()'s ladder-merge behavior (see its own docstring
 * below) is untouched.
 */
export function resolveStorageMarketKey(market: ScrapedMarket, computedKey: string): string {
  if (computedKey !== "OTHER") return computedKey;

  // A bookmaker can legitimately publish several raw markets that share one
  // bookmakerMarketId but differ by paramValue (e.g. betcris' "1-15 min.
  // Liczba goli" over/under, one id shared by a 1.0 line and a 0.5 line) —
  // fold paramValue into the id-based suffix too, or the two lines still
  // collide on the same OTHER:id:<id> row (audit-match Arsenal vs Coventry
  // City, round 7: betcris' 0.5 line's Over/Under was silently dropped by
  // mergeMarketRecord even after the id-only suffix, since bookmakerMarketId
  // alone couldn't tell the two lines apart).
  const paramSuffix = market.paramValue ? `:${market.paramValue}` : "";

  // A bookmakerMarketId is also NOT always a 1:1 stand-in for "this specific
  // raw market" — some bookmakers reuse one id across many structurally
  // identical instances distinguished only by their raw name (sts reuses id
  // 1264, "<player> - liczba celnych strzałów (musi wyjść w '11')", once per
  // player, with no separate paramValue field carrying the player identity).
  // Fold a name hash into the id-based suffix too, or every player's OTHER
  // row collides into one (audit-match Arsenal vs Coventry City, round 8:
  // this is what the previous id-only suffix produced once id 1264 started
  // routing to OTHER instead of a real catalog code).
  const nameHash = createHash("sha1")
    .update(market.name || "", "utf8")
    .digest("hex")
    .slice(0, 10);

  if (market.bookmakerMarketId) {
    return `OTHER:id:${market.bookmakerMarketId}:${nameHash}${paramSuffix}`;
  }

  return `OTHER:name:${nameHash}${paramSuffix}`;
}

/**
 * Adds one normalized market's record into a per-marketKey map, MERGING
 * selections instead of letting a marketKey collision silently overwrite the
 * whole prior record. Same-bookmaker raw markets legitimately collide on one
 * marketKey when the catalog packs several thresholds under one
 * parameterized market keyed by something other than the threshold itself
 * (e.g. PLAYER_SHOTS' "2+".."9+" ladder, keyed only by player name) — a
 * plain Map.set() here kept only the last-processed threshold and silently
 * dropped the rest (audit-match Arsenal vs Coventry City, round 8
 * P7-repo-merge-on-marketkey-collision: betcris lost 7 of every 8
 * PLAYER_SHOTS rows this way, reproduced against the live normalizer output).
 * Only selection codes not already present are appended; the first-seen
 * odds for a given code wins, mirroring market-type-grouper.ts's identical
 * collision rule. A genuine intersection (the same code appearing twice)
 * likely means the two raw markets are actually the SAME bet mis-split by
 * the normalizer rather than disjoint thresholds — logged as a misroute
 * signal instead of being silently dropped.
 */
/**
 * Collision-detection key for one selection within mergeMarketRecord(). Uses
 * normalizedName when it actually distinguishes the selection, but falls
 * back to the raw name when normalizedName is the generic "UNKNOWN" bucket
 * every normalizer's default case assigns to selections it can't classify
 * (see e.g. factory.ts's `normalizedName: "UNKNOWN" as NormalizedSelection`
 * fallback, and per-bookmaker OTHER-market normalization).
 *
 * Plain `sel.normalizedName || sel.name` treats "UNKNOWN" as a real,
 * distinguishing code — it's a non-empty string, so `||` never falls
 * through to `sel.name`. That silently collapsed several genuinely
 * different selections inside ONE already-correctly-isolated raw market
 * (e.g. betcris' "1-15 min. Liczba goli" with 2 paramValues x Over/Under =
 * 4 selections, all typed UNKNOWN) down to just one kept row, since every
 * later "UNKNOWN" selection collided with the first (audit-match Arsenal
 * vs Coventry City, round 5: INNE/OTHER BROKEN finding across betcris,
 * lvbet, lebull, superbet, etoto).
 *
 * This only changes the DEDUP KEY, not the stored value — `normalizedName`
 * on the selection object itself stays "UNKNOWN" untouched, so any
 * downstream code keying off normalizedName sees the same value as before.
 */
function selectionCollisionKey(sel: MarketSelection): string {
  if (sel.normalizedName && sel.normalizedName !== "UNKNOWN") {
    return sel.normalizedName;
  }
  return sel.name;
}

export function mergeMarketRecord(
  recordsMap: Map<string, OddsInsert>,
  marketKey: string,
  incoming: OddsInsert
): void {
  const existing = recordsMap.get(marketKey);
  if (!existing) {
    recordsMap.set(marketKey, incoming);
    return;
  }

  const existingCodes = new Set(
    existing.selections.map((sel) => selectionCollisionKey(sel))
  );
  let collidedCode: string | undefined;
  let addedNewSelection = false;
  for (const sel of incoming.selections) {
    const code = selectionCollisionKey(sel);
    if (existingCodes.has(code)) {
      collidedCode = code;
      continue;
    }
    existing.selections.push(sel);
    existingCodes.add(code);
    addedNewSelection = true;
  }

  // A merge that genuinely contributed new selections (e.g. CARDS_TEAM
  // combining a bookmaker's separate "Arsenal - liczba kartek" and
  // "Coventry - liczba kartek" raw markets into one HOME/AWAY row) left
  // raw_market_name pointing at whichever raw market arrived first, silently
  // misattributing the label for every selection that came from the OTHER
  // source market. Concatenate distinct names instead so the displayed label
  // reflects every raw market this row's selections actually came from
  // (audit-match Arsenal vs Coventry City, round 7).
  if (
    addedNewSelection &&
    incoming.raw_market_name &&
    incoming.raw_market_name !== existing.raw_market_name
  ) {
    const existingNames = (existing.raw_market_name ?? "").split(" / ").filter(Boolean);
    if (!existingNames.includes(incoming.raw_market_name)) {
      existing.raw_market_name = [...existingNames, incoming.raw_market_name].join(" / ");
    }
  }

  if (collidedCode) {
    console.warn(
      `[FullOfferRepo] marketKey collision with overlapping selection code "${collidedCode}" for ${incoming.bookmaker} ${marketKey} (${existing.match_id}) — possible misroute, keeping first-seen odds`
    );
  }
}

/**
 * Drops rows from a PREVIOUS scrape of this (match, bookmaker) pair that are
 * older than the scrape just written. Rows are only ever appended, so a
 * market_key that a normalization fix stops producing kept being served
 * forever: the /audit-match run on Arsenal vs Coventry City still showed
 * STS's conditional "gole (musi wyjść w 11)" market under PLAYER_GOALS long
 * after that mapping had moved elsewhere. Only the newest scrape is ever
 * read (see the latest_odds view), so anything older is dead weight.
 * Skipped when the write partially failed, so a bad run cannot wipe good
 * data. Extracted as a shared helper (round 8 REPO-BATCH-STALE-PRUNE) so it
 * also runs from saveBatchFullOfferMarkets — aggregator.ts always calls
 * normalizeAndSaveMatches with { useBatchInsert: true }, so before this the
 * prune was only ever wired into the single-match save path and never
 * actually ran in production. Logs the number of rows actually removed
 * (round 8 P3-prune-stale-snapshots) so a silent RLS/permission failure on
 * the DELETE is visible instead of looking identical to "nothing to prune".
 */
async function pruneStaleOddsRows(
  supabase: ReturnType<typeof getSupabase>,
  matchId: string,
  bookmaker: PolishBookmaker,
  scrapedAt: string
): Promise<void> {
  const { count, error: pruneError } = await (supabase as any)
    .from("odds")
    .delete({ count: "exact" })
    .eq("match_id", matchId)
    .eq("bookmaker", bookmaker)
    .lt("scraped_at", scrapedAt);

  if (pruneError) {
    console.error(`[FullOfferRepo] Stale-row prune error for ${bookmaker}/${matchId}:`, pruneError);
  } else if (count) {
    console.log(`[FullOfferRepo] Pruned ${count} stale row(s) for ${bookmaker}/${matchId}`);
  }
}

export async function saveFullOfferMarkets(
  homeTeam: string,
  awayTeam: string,
  bookmaker: PolishBookmaker,
  markets: ScrapedMarket[],
  leagueSlug: string = "ekstraklasa",
  eventUrl?: string,
  startTime?: string
): Promise<{ inserted: number; filtered: number; errors: number }> {
  const supabase = getSupabase();
  const result = { inserted: 0, filtered: 0, errors: 0 };

  if (markets.length === 0) {
    return result;
  }

  const matchId = generateMatchId(homeTeam, awayTeam, leagueSlug);
  const canonicalHome = getCanonicalTeamName(homeTeam, leagueSlug);
  const canonicalAway = getCanonicalTeamName(awayTeam, leagueSlug);
  const scrapedAt = new Date().toISOString();

  const recordsMap = new Map<string, OddsInsert>();
  
  for (const market of markets) {
    if (!isCanonicalMarket(market.normalizedType)) {
      result.filtered++;
      continue;
    }

    const marketTypeId = getMarketTypeId(market.normalizedType!);
    if (!marketTypeId) {
      result.filtered++;
      continue;
    }

    const marketKey = resolveStorageMarketKey(market, market.marketKey || market.normalizedType!);

    mergeMarketRecord(recordsMap, marketKey, {
      match_id: matchId,
      league_slug: leagueSlug,
      home_team: canonicalHome,
      away_team: canonicalAway,
      bookmaker,
      event_url: eventUrl,
      market_type_id: marketTypeId,
      market_key: marketKey,
      param_value: market.paramValue,
      custom_name: market.customLabel,
      raw_market_name: market.name,
      selections: [...market.selections],
      scraped_at: scrapedAt,
      start_time: startTime,
    });
  }
  
  const records = Array.from(recordsMap.values());

  if (records.length === 0) {
    return result;
  }

  const BATCH_SIZE = 100;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { error } = await (supabase as any)
      .from("odds")
      .upsert(batch, {
        onConflict: "match_id,bookmaker,market_key,scraped_at",
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`[FullOfferRepo] Batch insert error:`, error);
      result.errors += batch.length;
    } else {
      result.inserted += batch.length;
    }
  }

  // See pruneStaleOddsRows() for why this runs and what it drops.
  if (result.errors === 0 && result.inserted > 0) {
    await pruneStaleOddsRows(supabase, matchId, bookmaker, scrapedAt);
  }

  return result;
}

export async function getFullOfferByMatch(
  homeTeam: string,
  awayTeam: string,
  leagueSlug: string = "ekstraklasa"
): Promise<FullOfferComparison | null> {
  const supabase = getSupabase();
  const matchId = generateMatchId(homeTeam, awayTeam, leagueSlug);
  const canonicalHome = getCanonicalTeamName(homeTeam, leagueSlug);
  const canonicalAway = getCanonicalTeamName(awayTeam, leagueSlug);

  const { data, error } = await fetchAllRows<any>((from, to) =>
    supabase
      .from("market_comparison")
      .select("*")
      .eq("match_id", matchId)
      .order("category")
      .order("market_key")
      .range(from, to) as any,
  );

  if (error) {
    console.error("[FullOfferRepo] getFullOfferByMatch error:", error);
    throw new RepositoryError("Failed to get full offer", "getFullOfferByMatch", error);
  }

  if (data.length === 0) {
    return null; // No data is not an error
  }

  const marketGroups = new Map<string, {
    type: NormalizedMarketType;
    category: MarketCategory;
    name: string;
    paramValue?: string;
    bookmakerOdds: Record<PolishBookmaker, {
      selections: MarketSelection[];
      eventUrl?: string;
      scrapedAt: string;
      rawMarketName?: string;
    }>;
  }>();

  for (const row of data as any[]) {
    const marketKey = row.market_key;
    if (!marketKey) continue;

    if (!marketGroups.has(marketKey)) {
      marketGroups.set(marketKey, {
        type: row.market_code as NormalizedMarketType,
        category: row.category as MarketCategory,
        name: row.market_name_pl || row.market_name,
        paramValue: row.param_value ?? undefined,
        bookmakerOdds: {} as Record<PolishBookmaker, {
          selections: MarketSelection[];
          eventUrl?: string;
          scrapedAt: string;
          rawMarketName?: string;
        }>,
      });
    }

    const group = marketGroups.get(marketKey)!;
    group.bookmakerOdds[row.bookmaker as PolishBookmaker] = {
      selections: row.selections as MarketSelection[],
      eventUrl: row.event_url ?? undefined,
      scrapedAt: row.scraped_at,
      rawMarketName: row.raw_market_name ?? undefined,
    };
  }

  const markets: FullOfferComparison["markets"] = {};
  for (const [marketKey, group] of Array.from(marketGroups.entries())) {
    markets[marketKey] = {
      ...group,
      bestOdds: calculateBestOdds(group.bookmakerOdds),
    };
  }

  return {
    matchId,
    homeTeam: canonicalHome,
    awayTeam: canonicalAway,
    markets,
  };
}

export async function getMarketsByType(
  homeTeam: string,
  awayTeam: string,
  marketType: NormalizedMarketType,
  leagueSlug: string = "ekstraklasa"
): Promise<MarketComparisonEntry[]> {
  const supabase = getSupabase();
  const matchId = generateMatchId(homeTeam, awayTeam, leagueSlug);

  const { data, error } = await supabase
    .from("market_comparison")
    .select("*")
    .eq("match_id", matchId)
    .eq("market_code", marketType)
    .order("market_key");

  if (error) {
    console.error("[FullOfferRepo] getMarketsByType error:", error);
    throw new RepositoryError("Failed to get markets by type", "getMarketsByType", error);
  }

  return ((data || []) as any[]).map((row) => ({
    market_key: row.market_key,
    normalized_type: row.market_code,
    category: row.category,
    param_value: row.param_value ?? undefined,
    bookmaker: row.bookmaker as PolishBookmaker,
    market_name: row.market_name_pl || row.market_name,
    selections: row.selections as MarketSelection[],
    event_url: row.event_url ?? undefined,
    scraped_at: row.scraped_at,
  }));
}

export async function deleteOldFullOfferData(
  olderThanHours: number = 24
): Promise<number> {
  const supabase = getSupabase();
  const cutoffDate = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

  const { count, error } = await (supabase as any)
    .from("odds")
    .delete({ count: "exact" })
    .lt("scraped_at", cutoffDate.toISOString());

  if (error) {
    console.error("[FullOfferRepo] deleteOldFullOfferData error:", error);
    throw new RepositoryError("Failed to delete old data", "deleteOldFullOfferData", error);
  }

  return count || 0;
}

export async function getMarketCounts(
  homeTeam: string,
  awayTeam: string,
  leagueSlug: string = "ekstraklasa"
): Promise<Record<PolishBookmaker, number>> {
  const supabase = getSupabase();
  const matchId = generateMatchId(homeTeam, awayTeam, leagueSlug);

  const { data, error } = await fetchAllRows<{ bookmaker: string }>((from, to) =>
    supabase
      .from("latest_odds")
      .select("bookmaker")
      .eq("match_id", matchId)
      .order("bookmaker")
      .range(from, to) as any,
  );

  if (error) {
    console.error("[FullOfferRepo] getMarketCounts error:", error);
    throw new RepositoryError("Failed to get market counts", "getMarketCounts", error);
  }

  const counts: Record<string, number> = {};
  for (const row of (data || []) as any[]) {
    counts[row.bookmaker] = (counts[row.bookmaker] || 0) + 1;
  }

  return counts as Record<PolishBookmaker, number>;
}

export async function getAvailableBookmakers(
  homeTeam: string,
  awayTeam: string,
  leagueSlug: string = "ekstraklasa"
): Promise<PolishBookmaker[]> {
  const counts = await getMarketCounts(homeTeam, awayTeam, leagueSlug);
  return Object.keys(counts) as PolishBookmaker[];
}

export function getCanonicalMarketCodes(): string[] {
  return Array.from(CANONICAL_MARKET_CODES);
}

export function getMarketDefinition(code: string) {
  return MARKET_BY_CODE.get(code);
}

export interface BatchSaveResult {
  inserted: number;
  filtered: number;
  errors: number;
  matchesProcessed: number;
}

export async function saveBatchFullOfferMarkets(
  matches: Array<{
    homeTeam: string;
    awayTeam: string;
    markets: ScrapedMarket[];
    eventUrl?: string;
    startTime?: string;
  }>,
  bookmaker: PolishBookmaker,
  leagueSlug: string = "ekstraklasa"
): Promise<BatchSaveResult> {
  const supabase = getSupabase();
  const result: BatchSaveResult = { inserted: 0, filtered: 0, errors: 0, matchesProcessed: 0 };

  if (matches.length === 0) {
    return result;
  }

  const scrapedAt = new Date().toISOString();
  const allRecords: OddsInsert[] = [];
  // matchId -> bookmaker is constant across this whole call, so a per-match
  // set of ids visited is enough to know which (match, bookmaker) pairs to
  // prune after the write succeeds (see pruneStaleOddsRows()).
  const matchIdsWritten = new Set<string>();

  for (const match of matches) {
    const matchId = generateMatchId(match.homeTeam, match.awayTeam, leagueSlug);
    const canonicalHome = getCanonicalTeamName(match.homeTeam, leagueSlug);
    const canonicalAway = getCanonicalTeamName(match.awayTeam, leagueSlug);

    const recordsMap = new Map<string, OddsInsert>();

    for (const market of match.markets) {
      if (!isCanonicalMarket(market.normalizedType)) {
        result.filtered++;
        continue;
      }

      const marketTypeId = getMarketTypeId(market.normalizedType!);
      if (!marketTypeId) {
        result.filtered++;
        continue;
      }

      const marketKey = resolveStorageMarketKey(market, market.marketKey || market.normalizedType!);

      mergeMarketRecord(recordsMap, marketKey, {
        match_id: matchId,
        league_slug: leagueSlug,
        home_team: canonicalHome,
        away_team: canonicalAway,
        bookmaker,
        event_url: match.eventUrl,
        market_type_id: marketTypeId,
        market_key: marketKey,
        param_value: market.paramValue,
        custom_name: market.customLabel,
        raw_market_name: market.name,
        selections: [...market.selections],
        scraped_at: scrapedAt,
        start_time: match.startTime,
      });
    }

    allRecords.push(...recordsMap.values());
    matchIdsWritten.add(matchId);
    result.matchesProcessed++;
  }

  if (allRecords.length === 0) {
    return result;
  }

  const BATCH_SIZE = 500;
  for (let i = 0; i < allRecords.length; i += BATCH_SIZE) {
    const batch = allRecords.slice(i, i + BATCH_SIZE);

    const { error } = await (supabase as any)
      .from("odds")
      .upsert(batch, {
        onConflict: "match_id,bookmaker,market_key,scraped_at",
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`[FullOfferRepo] Batch insert error (batch ${Math.floor(i / BATCH_SIZE) + 1}):`, error);
      result.errors += batch.length;
    } else {
      result.inserted += batch.length;
    }
  }

  // See pruneStaleOddsRows() for why this runs and what it drops. This is
  // the ONLY place the prune actually executes in production: aggregator.ts
  // always calls normalizeAndSaveMatches with { useBatchInsert: true }, so
  // saveFullOfferMarkets's own copy of this call never runs (round 8
  // REPO-BATCH-STALE-PRUNE).
  if (result.errors === 0 && result.inserted > 0) {
    for (const matchId of matchIdsWritten) {
      await pruneStaleOddsRows(supabase, matchId, bookmaker, scrapedAt);
    }
  }

  return result;
}
