import { describe, it, expect } from "vitest";
import { canonicalizePlayerComboSelection, canonicalizePlayerName, toComboPlayerForm } from "../index.js";

// Regression for /audit-match Arsenal vs Coventry City: every bookmaker sells
// the exact same "both named players score" pair, but each quotes the raw
// player list in a different shape. Without a shared reduction to
// "I. Surname" the four bookmakers strand four distinct comparison columns
// for one real-world combo.
describe("canonicalizePlayerComboSelection — cross-bookmaker convergence", () => {
  it("reduces all four raw bookmaker formats for the same pair to one code", () => {
    const superbet = "Tzolis, Christos i Havertz, Kai";
    const betclic = "C. Tzolis & K. Havertz";
    const betcris = "Kai Havertz and Christos Tzolis";
    const lvbet = "Christos Tzolis and Kai Havertz";

    const expected = "C. Tzolis & K. Havertz";
    expect(canonicalizePlayerComboSelection(superbet)).toBe(expected);
    expect(canonicalizePlayerComboSelection(betclic)).toBe(expected);
    expect(canonicalizePlayerComboSelection(betcris)).toBe(expected);
    expect(canonicalizePlayerComboSelection(lvbet)).toBe(expected);
  });
});

describe("toComboPlayerForm", () => {
  // toComboPlayerForm consumes names already in "Firstname Lastname" order —
  // callers run canonicalizePlayerName first (as canonicalizePlayerComboSelection
  // does), which is what turns superbet's "Simms, Ellis Reco" into
  // "Ellis Reco Simms" before the middle name gets dropped here.
  it("drops middle names so all spellings of the same player merge", () => {
    expect(toComboPlayerForm(canonicalizePlayerName("Simms, Ellis Reco"))).toBe("E. Simms");
    expect(toComboPlayerForm("Ellis Reco Simms")).toBe("E. Simms");
    expect(toComboPlayerForm("E. Simms")).toBe("E. Simms");
  });

  it("keeps a particle prefix attached to the surname", () => {
    expect(toComboPlayerForm("Milan van Ewijk")).toBe("M. van Ewijk");
    expect(toComboPlayerForm("Rodrigo De Paul")).toBe("R. De Paul");
  });

  it("passes through names already reduced to a single token", () => {
    expect(toComboPlayerForm("Nedum")).toBe("Nedum");
  });
});
