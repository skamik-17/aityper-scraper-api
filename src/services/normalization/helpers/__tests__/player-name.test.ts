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

  it("handles multi-part last names", () => {
    expect(canonicalizePlayerName("Da Costa, Nuno")).toBe("Nuno Da Costa");
  });

  // The canonical name is the MERGE KEY for every PLAYER_* market, so an accent
  // splits one footballer into two dropdown rows with half the odds each. The
  // /audit-match run on Arsenal vs Coventry City found "Viktor Gyökeres"
  // (fuksiarz) beside "Viktor Gyokeres" (betcris/lvbet/superbet/betfan). Most
  // bookmakers send ASCII — and the project's canonical team names are ASCII
  // too ("Zaglebie Lubin") — so accents fold into the base letter.
  it("folds diacritics so the same player merges across bookmakers", () => {
    expect(canonicalizePlayerName("Hernández, Cucho")).toBe("Cucho Hernandez");
    expect(canonicalizePlayerName("Viktor Gyökeres")).toBe("Viktor Gyokeres");
    expect(canonicalizePlayerName("Gyökeres, Viktor")).toBe("Viktor Gyokeres");
    expect(canonicalizePlayerName("Aurèle Amenda")).toBe("Aurele Amenda");
    expect(canonicalizePlayerName("Gabriel Magalhães")).toBe("Gabriel Magalhaes");
    expect(canonicalizePlayerName("Kowalczyk, Michał")).toBe("Michal Kowalczyk");
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

describe("canonicalizePlayerName — apostrophe variants", () => {
  it("normalizes backtick and other apostrophe-like glyphs to a standard apostrophe", () => {
    expect(canonicalizePlayerName("Kante, N`Golo")).toBe("N'Golo Kante");
    expect(canonicalizePlayerName("N´Golo Kante")).toBe("N'Golo Kante");
    expect(canonicalizePlayerName("N'Golo Kante")).toBe("N'Golo Kante");
  });
});
