/**
 * Opt-in stealth for browser sessions (plan 08 Task 6): a user agent and client hints that
 * agree with the real Chromium version (the default context claims Chrome/120 while
 * sending "HeadlessChrome";v="143" client hints), plus JS shims for the properties the
 * headless shell leaves empty. navigator.webdriver is already false (launch arg).
 */
import type { UserAgentOverrideParams } from "./browser-page-setup.js";

export type { UserAgentOverrideParams } from "./browser-page-setup.js";

export interface ClientHintBrand {
  brand: string;
  version: string;
}

// Chromium's GREASE brand rule (components/embedder_support/user_agent_utils.cc), seeded with the major version
const GREASE_CHARS = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"];
const GREASE_VERSIONS = ["8", "99", "24"];
const BRAND_ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

/** The sec-ch-ua brand list Chrome `major` sends, with "Google Chrome" as the brand. */
export function clientHintBrands(major: number): ClientHintBrand[] {
  const grease: ClientHintBrand = {
    brand: `Not${GREASE_CHARS[major % 11]}A${GREASE_CHARS[(major + 1) % 11]}Brand`,
    version: GREASE_VERSIONS[major % 3],
  };
  const order = BRAND_ORDERS[major % 6];
  const list: ClientHintBrand[] = new Array(3);
  list[order[0]] = grease;
  list[order[1]] = { brand: "Chromium", version: String(major) };
  list[order[2]] = { brand: "Google Chrome", version: String(major) };
  return list;
}

const majorOf = (fullVersion: string): number => {
  const major = Number.parseInt(fullVersion.split(".")[0], 10);
  if (!Number.isInteger(major) || major <= 0) throw new RangeError(`not a Chromium version: ${fullVersion}`);
  return major;
};

/** Windows desktop Chrome UA with the reduced version Chrome itself sends. */
export function stealthUserAgent(fullVersion: string): string {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorOf(fullVersion)}.0.0.0 Safari/537.36`;
}

/** Network.setUserAgentOverride parameters consistent with `fullVersion` (browser.version()). */
export function userAgentOverride(fullVersion: string): UserAgentOverrideParams {
  const brands = clientHintBrands(majorOf(fullVersion));
  return {
    userAgent: stealthUserAgent(fullVersion),
    acceptLanguage: "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
    platform: "Win32",
    userAgentMetadata: {
      brands,
      fullVersionList: brands.map((b) => ({
        brand: b.brand,
        version: b.brand === "Google Chrome" || b.brand === "Chromium" ? fullVersion : `${b.version}.0.0.0`,
      })),
      fullVersion,
      platform: "Windows",
      platformVersion: "10.0.0",
      architecture: "x86",
      bitness: "64",
      model: "",
      mobile: false,
      wow64: false,
    },
  };
}

/**
 * Runs in every frame before page scripts (context.addInitScript). Plain JavaScript on
 * purpose: a function's toString() under tsx would carry bundler helpers.
 * Shapes follow desktop Chrome 143: five PDF viewer plugins sharing two PDF mime types.
 */
export const STEALTH_INIT_SCRIPT = String.raw`(() => {
  const onProto = (proto, prop, value) => {
    try { Object.defineProperty(proto, prop, { get: () => value, configurable: true, enumerable: true }); } catch (e) {}
  };
  const own = (obj, props) => {
    for (const [k, v] of Object.entries(props)) Object.defineProperty(obj, k, { value: v, enumerable: !/^(item|namedItem|refresh)$/.test(k), configurable: true });
    return obj;
  };
  try {
    if (typeof window.chrome !== "object" || window.chrome === null) {
      Object.defineProperty(window, "chrome", {
        value: { app: { isInstalled: false }, runtime: {}, csi: function csi() {}, loadTimes: function loadTimes() {} },
        configurable: true, enumerable: true, writable: true,
      });
    }
    const mimeDefs = [["application/pdf", "pdf"], ["text/pdf", "pdf"]];
    const pluginNames = ["PDF Viewer", "Chrome PDF Viewer", "Chromium PDF Viewer", "Microsoft Edge PDF Viewer", "WebKit built-in PDF"];
    const mimes = mimeDefs.map(([type, suffixes]) => own(Object.create(MimeType.prototype), { type, suffixes, description: "Portable Document Format" }));
    const plugins = pluginNames.map((name) => {
      const p = own(Object.create(Plugin.prototype), { name, filename: "internal-pdf-viewer", description: "Portable Document Format", length: mimes.length });
      mimes.forEach((m, i) => Object.defineProperty(p, i, { value: m, enumerable: true, configurable: true }));
      own(p, { item: (i) => mimes[i] ?? null, namedItem: (n) => mimes.find((m) => m.type === n) ?? null });
      return p;
    });
    mimes.forEach((m) => Object.defineProperty(m, "enabledPlugin", { value: plugins[0], configurable: true }));
    const list = (proto, items, key) => {
      const arr = Object.create(proto);
      items.forEach((it, i) => Object.defineProperty(arr, i, { value: it, enumerable: true, configurable: true }));
      items.forEach((it) => Object.defineProperty(arr, it[key], { value: it, configurable: true }));
      return own(arr, { length: items.length, item: (i) => items[i] ?? null, namedItem: (n) => items.find((x) => x[key] === n) ?? null, refresh: () => {} });
    };
    onProto(Navigator.prototype, "plugins", list(PluginArray.prototype, plugins, "name"));
    onProto(Navigator.prototype, "mimeTypes", list(MimeTypeArray.prototype, mimes, "type"));
    onProto(Navigator.prototype, "pdfViewerEnabled", true);
    onProto(Navigator.prototype, "languages", Object.freeze(["pl-PL", "pl", "en-US", "en"]));
  } catch (e) {}
})();`;
