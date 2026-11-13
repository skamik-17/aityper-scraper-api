/**
 * Swarm site id and socket URL, read from the `partnerConfigs` line of the
 * betcris page and cached in memory. An unusable page never blocks a scrape:
 * the fallback constants are used and cached for a shorter time.
 */
import type { HttpClient } from "../../shared/http/http-client.js";
import { SWARM_TRANSPORT } from "./constants.js";

export interface SwarmPartnerConfig {
  siteId: string;
  socketUrl: string;
}

export interface ResolvedSwarmConfig extends SwarmPartnerConfig {
  source: "page" | "fallback";
}

export interface SwarmPartnerConfigCache {
  get(signal?: AbortSignal): Promise<ResolvedSwarmConfig>;
  invalidate(): void;
}

const PARTNER_CONFIGS_LINE = /partnerConfigs\s*=\s*(\{.*\})\s*;?\s*$/m;

/** The site id and socket URL of the page's `partnerConfigs`, or null when absent or unusable */
export function parsePartnerConfigs(html: string): SwarmPartnerConfig | null {
  const match = PARTNER_CONFIGS_LINE.exec(html);
  if (!match) return null;
  let config: any;
  try {
    config = JSON.parse(match[1]);
  } catch {
    return null;
  }
  const socketUrl = config?.swarmUrl;
  const partnerId = config?.springConfig?.partnerId;
  if (typeof socketUrl !== "string" || !/^wss:\/\//.test(socketUrl)) return null;
  if (partnerId === undefined || partnerId === null) return null;
  const siteId = String(partnerId);
  if (!/^\d+$/.test(siteId)) return null;
  return { siteId, socketUrl };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createSwarmPartnerConfigCache(http: HttpClient): SwarmPartnerConfigCache {
  let cached: { value: ResolvedSwarmConfig; expiresAt: number } | null = null;
  let inflight: Promise<ResolvedSwarmConfig> | null = null;
  // Bumped by invalidate(), so a load that started before it cannot repopulate the cache.
  let generation = 0;

  const fallback = (reason: string): { value: ResolvedSwarmConfig; ttlMs: number } => {
    console.warn(
      `[Betcris/Swarm] partnerConfigs unusable (${reason}); using fallback site_id=${SWARM_TRANSPORT.FALLBACK_SITE_ID} socket=${SWARM_TRANSPORT.FALLBACK_SOCKET_URL}`
    );
    return {
      value: {
        siteId: SWARM_TRANSPORT.FALLBACK_SITE_ID,
        socketUrl: SWARM_TRANSPORT.FALLBACK_SOCKET_URL,
        source: "fallback",
      },
      ttlMs: SWARM_TRANSPORT.PARTNER_CONFIG_FAILURE_TTL_MS,
    };
  };

  const load = async (signal?: AbortSignal): Promise<{ value: ResolvedSwarmConfig; ttlMs: number }> => {
    let html: string;
    try {
      html = await http.getText(SWARM_TRANSPORT.PARTNER_CONFIG_URL, {
        timeoutMs: SWARM_TRANSPORT.PARTNER_CONFIG_TIMEOUT_MS,
        signal,
      });
    } catch (error) {
      // The caller's own abort says nothing about the page: not cached, rethrown.
      if (signal?.aborted) throw error;
      return fallback(errorText(error));
    }
    const parsed = parsePartnerConfigs(html);
    if (!parsed) return fallback(`no usable partnerConfigs in ${SWARM_TRANSPORT.PARTNER_CONFIG_URL}`);
    return { value: { ...parsed, source: "page" }, ttlMs: SWARM_TRANSPORT.PARTNER_CONFIG_TTL_MS };
  };

  return {
    get(signal?: AbortSignal): Promise<ResolvedSwarmConfig> {
      if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.value);
      if (inflight) return inflight;
      const gen = generation;
      const p = load(signal).then(
        ({ value, ttlMs }) => {
          if (gen === generation) {
            cached = { value, expiresAt: Date.now() + ttlMs };
            inflight = null;
          }
          return value;
        },
        (error) => {
          if (gen === generation) inflight = null;
          throw error;
        }
      );
      inflight = p;
      return p;
    },
    invalidate(): void {
      generation++;
      cached = null;
      inflight = null;
    },
  };
}
