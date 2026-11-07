/**
 * Best-effort runtime discovery of Betby endpoints with a pinned fallback.
 *
 * - betters (direct Betby): `share/bootstrap` -> `bettech_brand_id` + `bettech_script`;
 *   the renderer script embeds the `https://api-h-….sptpub.com` API origin.
 *   `bootstrap.sb_host` is stale for betters and is ignored.
 * - lebull (sbteam proxy): `share/bootstrap` -> `sb_host`; `${sb_host}assets/public/config.json`
 *   -> `betbyApiUrl` + `betbyBrandId`. `sb_host` is also the host of the lebull deep links,
 *   so it is returned as `sbHost` for the drift check.
 */
import type { BetbyBrandConfig, BetbyDiscoveredEndpoints, BetbyEndpoints, FetchText } from "./types.js";

export const BETTERS_BOOTSTRAP_URL = "https://www.betters.pl/share/bootstrap";
export const LEBULL_BOOTSTRAP_URL = "https://www.lebull.pl/share/bootstrap";

const API_ORIGIN_RE = /https:\/\/api-h-[a-z0-9-]+\.sptpub\.com/;
const DIGITS_RE = /^\d+$/;

function asRecord(json: unknown, source: string): Record<string, unknown> {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new Error(`${source}: not a JSON object`);
  }
  return json as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, key: string, source: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value === "") throw new Error(`${source}: missing ${key}`);
  return value;
}

/** A digit string (Betby ids exceed 2^53, so they must stay strings). */
function requireId(obj: Record<string, unknown>, key: string, source: string): string {
  const value = requireString(obj, key, source);
  if (!DIGITS_RE.test(value)) throw new Error(`${source}: invalid ${key} ${value}`);
  return value;
}

function requireHttpsUrl(obj: Record<string, unknown>, key: string, source: string): string {
  const value = requireString(obj, key, source);
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    protocol = "";
  }
  if (protocol !== "https:") throw new Error(`${source}: invalid ${key} ${value}`);
  return value;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function parseBettersBootstrap(json: unknown): { brandId: string; rendererUrl: string } {
  const source = "betters bootstrap";
  const obj = asRecord(json, source);
  return {
    brandId: requireId(obj, "bettech_brand_id", source),
    rendererUrl: requireHttpsUrl(obj, "bettech_script", source),
  };
}

export function extractApiOriginFromRenderer(js: string): string {
  const match = API_ORIGIN_RE.exec(js);
  if (!match) throw new Error("betters renderer: no https://api-h-….sptpub.com origin found");
  return match[0];
}

export function parseLebullBootstrap(json: unknown): { sbHost: string } {
  const sbHost = requireHttpsUrl(asRecord(json, "lebull bootstrap"), "sb_host", "lebull bootstrap");
  return { sbHost: sbHost.endsWith("/") ? sbHost : `${sbHost}/` };
}

export function parseLebullSbConfig(json: unknown): BetbyEndpoints {
  const source = "lebull sb-config";
  const obj = asRecord(json, source);
  const apiUrl = requireHttpsUrl(obj, "betbyApiUrl", source).replace(/\/+$/, "");
  return {
    prematchBase: `${apiUrl}/v5`,
    descriptionsBase: `${apiUrl}/v4`,
    brandId: requireId(obj, "betbyBrandId", source),
  };
}

export async function discoverBettersEndpoints(fetchText: FetchText): Promise<BetbyEndpoints> {
  const { brandId, rendererUrl } = parseBettersBootstrap(JSON.parse(await fetchText(BETTERS_BOOTSTRAP_URL)));
  const origin = extractApiOriginFromRenderer(await fetchText(rendererUrl));
  return { prematchBase: `${origin}/api/v4`, descriptionsBase: `${origin}/api/v3`, brandId };
}

export async function discoverLebullEndpoints(fetchText: FetchText): Promise<BetbyDiscoveredEndpoints> {
  const { sbHost } = parseLebullBootstrap(JSON.parse(await fetchText(LEBULL_BOOTSTRAP_URL)));
  const endpoints = parseLebullSbConfig(JSON.parse(await fetchText(`${sbHost}assets/public/config.json`)));
  return { ...endpoints, sbHost };
}

/**
 * prematchBase, plus the brand id when it drifted, plus descriptionsBase when it drifted on
 * its own (both bases share one origin, so a host change already shows in prematchBase).
 */
function describeEndpoints(e: BetbyEndpoints, show: { descriptions: boolean; brand: boolean }): string {
  let text = e.prematchBase;
  if (show.descriptions) text += ` (descriptions ${e.descriptionsBase})`;
  if (show.brand) text += ` (brand ${e.brandId})`;
  return text;
}

/**
 * Discover the brand's endpoints; on any failure use the pinned ones and warn.
 * When discovery succeeds but differs from the pinned endpoints, the discovered
 * ones win and one `endpoint drift` line is logged so the pin can be updated.
 * The same line also reports a discovered `sbHost` that no longer matches the
 * brand's fixed `deepLinkHost` (odds still flow, but the deep links would break).
 */
export async function resolveEndpoints(
  brand: BetbyBrandConfig,
  fetchText: FetchText,
  warn: (message: string) => void = (message) => console.warn(message),
): Promise<{ endpoints: BetbyEndpoints; source: "discovered" | "pinned" }> {
  const tag = `[Betby/${brand.logTag}]`;
  const pinned = brand.pinned;

  let discovered: BetbyDiscoveredEndpoints;
  try {
    discovered = await brand.discover(fetchText);
  } catch (err) {
    warn(`${tag} endpoint discovery failed: ${errorMessage(err)}; using pinned ${pinned.prematchBase}`);
    return { endpoints: pinned, source: "pinned" };
  }

  // Only the API endpoints leave this function; sbHost is used for the drift check alone.
  const endpoints: BetbyEndpoints = {
    prematchBase: discovered.prematchBase,
    descriptionsBase: discovered.descriptionsBase,
    brandId: discovered.brandId,
  };

  const drift: string[] = [];
  const show = {
    descriptions: endpoints.descriptionsBase !== pinned.descriptionsBase && endpoints.prematchBase === pinned.prematchBase,
    brand: endpoints.brandId !== pinned.brandId,
  };
  if (endpoints.prematchBase !== pinned.prematchBase || show.descriptions || show.brand) {
    drift.push(`discovered ${describeEndpoints(endpoints, show)} != pinned ${describeEndpoints(pinned, show)}`);
  }
  const { sbHost } = discovered;
  if (brand.deepLinkHost !== undefined && sbHost !== undefined && sbHost !== brand.deepLinkHost) {
    drift.push(`sb_host ${sbHost} != deep-link host ${brand.deepLinkHost}`);
  }
  if (drift.length > 0) warn(`${tag} endpoint drift: ${drift.join("; ")}`);
  return { endpoints, source: "discovered" };
}
