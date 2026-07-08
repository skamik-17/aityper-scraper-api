import { describe, it, expect } from "vitest";
import { canonicalizePlayerName } from "../index.js";

describe("canonicalizePlayerName", () => {
  it('converts "Lastname, Firstname" to "Firstname Lastname"', () => {
    expect(canonicalizePlayerName("Jashari, Ardon")).toBe("Ardon Jashari");
    expect(canonicalizePlayerName("Rodriguez, James")).toBe("James Rodriguez");
  });

  it("passes through names already in natural order", () => {
    expect(canonicalizePlayerName("Ardon Jashari")).toBe("Ardon Jashari");
    expect(canonicalizePlayerName("Luis Suarez")).toBe("Luis Suarez");
  });

  it("handles multi-part last names and diacritics", () => {
    expect(canonicalizePlayerName("Da Costa, Nuno")).toBe("Nuno Da Costa");
    expect(canonicalizePlayerName("Hernández, Cucho")).toBe("Cucho Hernández");
  });

  it("collapses excess whitespace", () => {
    expect(canonicalizePlayerName("  Jashari,   Ardon  ")).toBe("Ardon Jashari");
    expect(canonicalizePlayerName("Ardon   Jashari")).toBe("Ardon Jashari");
  });

  it("leaves non-name strings untouched (codes, scores, yes/no)", () => {
    expect(canonicalizePlayerName("HOME_OR_DRAW")).toBe("HOME_OR_DRAW");
    expect(canonicalizePlayerName("1:0")).toBe("1:0");
    expect(canonicalizePlayerName("1+")).toBe("1+");
    expect(canonicalizePlayerName("YES")).toBe("YES");
  });

  it("does not swap comma lists that are not a single name", () => {
    // Multiple commas — ambiguous, leave as-is
    expect(canonicalizePlayerName("A, B, C")).toBe("A, B, C");
  });
});
