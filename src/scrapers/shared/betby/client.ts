/**
 * Betby prematch client: endpoints, the manifest/chunk snapshot, full events and market
 * descriptions, each behind its own TTL cache.
 *
 * Snapshot protocol (observed 2026-11-06): the manifest `…/pl/0` lists the chunk versions;
 * each chunk's `version` names the next chunk, and the last chunk carries
 * `snapshot_complete: true`. The snapshot rotates about every 60 s, and a chunk requested
 * from a stale manifest comes back as `{version: 0}` without `events`. So every chunk is
 * fetched in parallel right after the manifest, the chain is validated, and one retry uses
 * a fresh manifest. A partial snapshot is never returned, because it would silently drop
 * matches.
 *
 * The cached snapshot and descriptions are deep-frozen: every caller within the TTL gets the
 * same object, so an in-place edit (a trimmed team name, merged markets) would leak into the
 * next league's scrape. Frozen, such an edit throws at once, because ES modules run in
 * strict mode.
 */
import { resolveEndpoints } from "./discovery.js";
import { BetbyHttpError, createFetchText, hostAndPath } from "./http.js";
import type {
  BetbyBrandConfig,
  BetbyEndpoints,
  BetbyEnvelope,
  BetbyEvent,
  BetbyManifest,
  BetbyMarketDescriptions,
  BetbySnapshot,
  FetchText,
} from "./types.js";

/** Shorter than the ~60 s rotation, so the leagues of one run reuse one snapshot. */
export const SNAPSHOT_TTL_MS = 45_000;
export const ENDPOINTS_TTL_MS = 21_600_000;
export const DESCRIPTIONS_TTL_MS = 21_600_000;
export const SNAPSHOT_MAX_ATTEMPTS = 2;

export interface BetbyClientDeps {
  fetchText?: FetchText;
  /** Clock for the caches, in ms. */
  now?: () => number;
  warn?: (message: string) => void;
}

/**
 * Caches one async value for `ttlMs`, measured from the start of its load. Callers that
 * arrive while a load is in flight share it. A rejected load is dropped, so the next call
 * retries instead of replaying the error.
 */
class TtlCache<T> {
  private entry: { startedAt: number; value: Promise<T> } | undefined;

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  get(load: () => Promise<T>): Promise<T> {
    const t = this.now();
    if (this.entry !== undefined && t - this.entry.startedAt < this.ttlMs) return this.entry.value;
    const entry = { startedAt: t, value: load() };
    this.entry = entry;
    entry.value.catch(() => {
      if (this.entry === entry) this.entry = undefined;
    });
    return entry.value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVersionList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => Number.isSafeInteger(v) && v > 0);
}

/** The manifest, or null when it lists no chunk versions (it rotated, or is malformed). */
function parseManifest(json: unknown): BetbyManifest | null {
  if (!isRecord(json) || typeof json.version !== "number") return null;
  const { top_events_versions: top, rest_events_versions: rest } = json;
  if (!isVersionList(top) || top.length === 0 || !isVersionList(rest)) return null;
  return { version: json.version, top_events_versions: top, rest_events_versions: rest };
}

/** Why a fetched snapshot is unusable; empty when the chain is intact and complete. */
function chainProblems(versions: number[], chunks: unknown[]): string[] {
  const last = versions.length - 1;
  const problems: string[] = [];
  chunks.forEach((chunk, i) => {
    if (!isRecord(chunk) || !isRecord(chunk.events)) {
      problems.push(`chunk ${versions[i]} rotated`);
    } else if (i < last && chunk.version !== versions[i + 1]) {
      problems.push(`chunk ${versions[i]} points to ${String(chunk.version)}`);
    }
  });
  const tail = chunks[last];
  if (!isRecord(tail) || tail.snapshot_complete !== true) problems.push(`last chunk ${versions[last]} not complete`);
  return problems;
}

/**
 * Freezes a parsed JSON value and every object and array inside it, in place. A subtree that
 * is already frozen is skipped.
 */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Merges the chunks into one snapshot and deep-freezes it, because the cache shares it. */
function mergeChunks(manifestVersion: number, chunks: BetbyEnvelope[]): BetbySnapshot {
  const snapshot: BetbySnapshot = { manifestVersion, events: {}, categories: {}, tournaments: {} };
  for (const chunk of chunks) {
    Object.assign(snapshot.events, chunk.events);
    Object.assign(snapshot.categories, chunk.categories);
    Object.assign(snapshot.tournaments, chunk.tournaments);
  }
  return deepFreeze(snapshot);
}

export class BetbyClient {
  private readonly fetchText: FetchText;
  private readonly warn: (message: string) => void;
  private readonly tag: string;
  private readonly endpointsCache: TtlCache<BetbyEndpoints>;
  private readonly snapshotCache: TtlCache<BetbySnapshot>;
  private readonly descriptionsCache: TtlCache<BetbyMarketDescriptions>;

  /** Does no I/O: endpoints are resolved by the first request. */
  constructor(
    private readonly brand: BetbyBrandConfig,
    deps: BetbyClientDeps = {},
  ) {
    this.fetchText = deps.fetchText ?? createFetchText();
    this.warn = deps.warn ?? ((message) => console.warn(message));
    this.tag = `[Betby/${brand.logTag}]`;
    const now = deps.now ?? (() => Date.now());
    this.endpointsCache = new TtlCache(ENDPOINTS_TTL_MS, now);
    this.snapshotCache = new TtlCache(SNAPSHOT_TTL_MS, now);
    this.descriptionsCache = new TtlCache(DESCRIPTIONS_TTL_MS, now);
  }

  /** Discovered endpoints, or the pinned ones when discovery fails (resolveEndpoints warns). */
  getEndpoints(): Promise<BetbyEndpoints> {
    return this.endpointsCache.get(async () => (await resolveEndpoints(this.brand, this.fetchText, this.warn)).endpoints);
  }

  /** Every chunk of one manifest, merged; throws rather than return a partial snapshot. */
  fetchSnapshot(): Promise<BetbySnapshot> {
    return this.snapshotCache.get(() => this.loadSnapshot());
  }

  /**
   * The full event payload, or null when Betby has none for this id. HTTP errors other
   * than 404, and bodies that are not JSON, propagate.
   */
  async fetchEvent(eventId: string): Promise<BetbyEvent | null> {
    const { prematchBase, brandId } = await this.getEndpoints();
    let body: unknown;
    try {
      body = await this.fetchJson(`${prematchBase}/prematch/brand/${brandId}/event/pl/${eventId}`);
    } catch (err) {
      // Never observed live, but it means the same as the empty envelope below.
      if (err instanceof BetbyHttpError && err.status === 404) return null;
      throw err;
    }
    // An unknown, live or withdrawn id answers HTTP 200 with an envelope that has no `events`.
    if (!isRecord(body) || !isRecord(body.events) || !Object.hasOwn(body.events, eventId)) return null;
    return (body.events[eventId] as BetbyEvent | null) ?? null;
  }

  fetchDescriptions(): Promise<BetbyMarketDescriptions> {
    return this.descriptionsCache.get(async () => {
      const { descriptionsBase, brandId } = await this.getEndpoints();
      const url = `${descriptionsBase}/descriptions/brand/${brandId}/markets/pl`;
      const json = await this.fetchJson(url);
      // Checked before caching: a bad body would otherwise stay cached for 6 h.
      if (!isRecord(json)) {
        throw new Error(`Betby ${this.brand.bookmaker}: market descriptions from ${hostAndPath(url)} are not a JSON object`);
      }
      return deepFreeze(json as BetbyMarketDescriptions);
    });
  }

  private async loadSnapshot(): Promise<BetbySnapshot> {
    const { prematchBase, brandId } = await this.getEndpoints();
    const versionUrl = (version: number) => `${prematchBase}/prematch/brand/${brandId}/pl/${version}`;

    let problems: string[] = [];
    for (let attempt = 1; attempt <= SNAPSHOT_MAX_ATTEMPTS; attempt++) {
      const json = await this.fetchJson(versionUrl(0));
      const manifest = parseManifest(json);
      if (manifest === null) {
        const version = isRecord(json) && json.version !== undefined ? String(json.version) : "?";
        problems = [`manifest ${version} lists no chunk versions`];
      } else {
        // All at once, right after the manifest, so the chunks are read before it rotates.
        const versions = [...manifest.top_events_versions, ...manifest.rest_events_versions];
        const chunks = await Promise.all(versions.map((version) => this.fetchJson(versionUrl(version))));
        problems = chainProblems(versions, chunks);
        if (problems.length === 0) return mergeChunks(manifest.version, chunks as BetbyEnvelope[]);
      }
      if (attempt < SNAPSHOT_MAX_ATTEMPTS) {
        this.warn(
          `${this.tag} snapshot attempt ${attempt}/${SNAPSHOT_MAX_ATTEMPTS} incomplete (${problems.join("; ")}); retrying with a fresh manifest`,
        );
      }
    }
    throw new Error(
      `Betby ${this.brand.bookmaker}: snapshot incomplete after ${SNAPSHOT_MAX_ATTEMPTS} attempts (${problems.join("; ")})`,
    );
  }

  private async fetchJson(url: string): Promise<unknown> {
    const text = await this.fetchText(url);
    try {
      return JSON.parse(text) as unknown;
    } catch (err) {
      throw new Error(`Betby invalid JSON from ${hostAndPath(url)}: ${(err as Error).message}`, { cause: err });
    }
  }
}
