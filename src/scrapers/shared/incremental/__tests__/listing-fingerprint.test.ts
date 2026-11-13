import { describe, expect, it } from "vitest";
import { listingFingerprint } from "../listing-fingerprint.js";

const P = [["1:0", 2.75], ["1:1", 3.3], ["1:2", 2.55], ["count", 491]] as const;

describe("listingFingerprint", () => {
  it("is a pinned 16-hex sha1 prefix", () => expect(listingFingerprint(P)).toBe("41f59ecfdb96fa22"));
  it("ignores part order", () => expect(listingFingerprint([P[3], P[2], P[0], P[1]])).toBe("41f59ecfdb96fa22"));
  it("changes with one price", () => expect(listingFingerprint([P[0], P[1], ["1:2", 2.6], P[3]])).toBe("4dab8becf9018ad7"));
  it("is null without parts", () => expect(listingFingerprint([])).toBeNull());
  it("rejects duplicate keys", () =>
    expect(() => listingFingerprint([P[0], ["1:0", 2.8]])).toThrow("duplicate fingerprint key 1:0"));
});

describe("listingFingerprintOrNull", () => {
  it("is the fingerprint, or null with one warning on a duplicate key", async () => {
    const { listingFingerprintOrNull } = await import("../listing-fingerprint.js");
    const { vi } = await import("vitest");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(listingFingerprintOrNull(P, "[x] e1")).toBe("41f59ecfdb96fa22");
    expect(listingFingerprintOrNull([P[0], ["1:0", 2.8]], "[x] e1")).toBeNull();
    expect(warn.mock.calls.flat()).toEqual(["[x] e1: no listing fingerprint (duplicate fingerprint key 1:0)"]);
    warn.mockRestore();
  });
});
