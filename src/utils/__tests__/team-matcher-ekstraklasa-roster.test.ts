import { describe, it, expect, beforeEach } from "vitest";
import { matchToCanonical, clearTeamMatchMemo } from "../team-matcher.js";
import { EKSTRAKLASA_TEAMS } from "../../data/index.js";

/**
 * Controller ruling 22 (fortuna): the 2026/27 Ekstraklasa has three Kraków
 * clubs (Wisła Kraków, Cracovia, Wieczysta Kraków) and Wisła Płock. Fortuna's
 * live round of 2026-11-20..23 lists "Radomiak Radom - Wisła Kraków" and
 * "Wieczysta Kraków - Motor Lublin". The roster had neither Kraków club, so
 * "Wisła Kraków" fuzzy-matched Cracovia, "Wisła K." fell to Wisła Płock and
 * Wieczysta passed through unmapped. Each name must map to its own club.
 */
const EK = "ekstraklasa";
const name = (raw: string) => matchToCanonical(raw, EK)?.name ?? null;

describe("team-matcher: Ekstraklasa Kraków / Płock clubs", () => {
  beforeEach(() => clearTeamMatchMemo());

  it.each([
    // Fortuna, betby (betters/lebull) and totalbet spellings seen live.
    ["Wisła Kraków", "Wisla Krakow"],
    ["Wisla Krakow", "Wisla Krakow"],
    ["Wisła K.", "Wisla Krakow"],
    ["Wieczysta Kraków", "Wieczysta Krakow"],
    ["Wieczysta Krakow", "Wieczysta Krakow"],
    ["Wieczysta", "Wieczysta Krakow"],
    ["Wieczysta K.", "Wieczysta Krakow"],
    ["Wisła Płock", "Wisla Plock"],
    ["Wisla Plock", "Wisla Plock"],
    ["W.Płock", "Wisla Plock"],
    ["Wisła P.", "Wisla Plock"],
    ["Cracovia", "Cracovia Krakow"],
    ["Cracovia Kraków", "Cracovia Krakow"],
  ])("%s -> %s", (raw, canonical) => {
    expect(name(raw)).toBe(canonical);
  });

  it("a bare 'Wisła' is ambiguous between Kraków and Płock and resolves to nothing", () => {
    expect(name("Wisła")).toBeNull();
    expect(name("Wisla")).toBeNull();
  });

  it("roster ids are TheSportsDB's (135303 is Wisła Kraków, 135659 Wisła Płock) and unique", () => {
    const byName = Object.fromEntries(EKSTRAKLASA_TEAMS.map((t) => [t.name, t.id]));
    expect(byName["Wisla Krakow"]).toBe("135303");
    expect(byName["Wisla Plock"]).toBe("135659");
    expect(byName["Wieczysta Krakow"]).toBe("152462");
    const ids = EKSTRAKLASA_TEAMS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every other club of the live 2026-11-20..23 fortuna round still resolves as before", () => {
    expect([
      "Zagłębie Lubin", "Górnik Zabrze", "Radomiak Radom", "Jagiellonia Białystok", "GKS Katowice",
      "Lech Poznań", "Raków Częstochowa", "Widzew Łódź", "Legia Warszawa", "Motor Lublin",
      "Pogoń Szczecin", "Śląsk Wrocław", "Piast Gliwice", "Korona Kielce",
    ].map(name)).toEqual([
      "Zaglebie Lubin", "Gornik Zabrze", "Radomiak Radom", "Jagiellonia Bialystok", "GKS Katowice",
      "Lech Poznan", "Rakow Czestochowa", "Widzew Lodz", "Legia Warszawa", "Motor Lublin",
      "Pogon Szczecin", "Slask Wroclaw", "Piast Gliwice", "Korona Kielce",
    ]);
  });
});
