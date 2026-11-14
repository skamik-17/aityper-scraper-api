import { describe, expect, it } from "vitest";
import { clientHintBrands, STEALTH_INIT_SCRIPT, stealthUserAgent, userAgentOverride } from "../browser-stealth.js";

describe("browser stealth", () => {
  it("brands for Chrome 143 match the measured headless-shell order", () =>
    expect(clientHintBrands(143)).toEqual([
      { brand: "Google Chrome", version: "143" },
      { brand: "Chromium", version: "143" },
      { brand: "Not A(Brand", version: "24" },
    ]));

  it("brands follow Chromium's GREASE rule for other majors", () => {
    // 142: seed % 6 = 4 -> [2,0,1]; chars 142 % 11 = 10 "_", 143 % 11 = 0 " "; version 142 % 3 = 1 -> "99"
    expect(clientHintBrands(142)).toEqual([
      { brand: "Chromium", version: "142" },
      { brand: "Google Chrome", version: "142" },
      { brand: "Not_A Brand", version: "99" },
    ]);
  });

  it("the stealth UA is a Windows Chrome UA with a reduced version", () =>
    expect(stealthUserAgent("143.0.7499.4")).toBe(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    ));

  it("userAgentOverride is consistent with browser.version()", () =>
    expect(userAgentOverride("143.0.7499.4")).toEqual({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      acceptLanguage: "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
      platform: "Win32",
      userAgentMetadata: {
        brands: clientHintBrands(143),
        fullVersionList: [
          { brand: "Google Chrome", version: "143.0.7499.4" },
          { brand: "Chromium", version: "143.0.7499.4" },
          { brand: "Not A(Brand", version: "24.0.0.0" },
        ],
        fullVersion: "143.0.7499.4",
        platform: "Windows",
        platformVersion: "10.0.0",
        architecture: "x86",
        bitness: "64",
        model: "",
        mobile: false,
        wow64: false,
      },
    }));

  it("the init script is plain JavaScript (no bundler helpers) and never touches webdriver", () => {
    expect(STEALTH_INIT_SCRIPT).not.toMatch(/__name|__defProp|webdriver/);
    expect(() => new Function(STEALTH_INIT_SCRIPT)).not.toThrow();
  });
});
