import { describe, it, expect } from "vitest";
import { getCanonicalTeamName, getNormalizedTeamName, matchToCanonical, normalize } from "../team-matcher.js";
import { NATIONS_LEAGUE_TEAMS } from "../../data/index.js";

const L = "nations-league";

// TheSportsDB league 4490, season 2026-2027, rounds 1, 5 and 6 (54 nations)
const TSDB_54 = [
  "Albania", "Andorra", "Armenia", "Austria", "Azerbaijan", "Belarus", "Belgium", "Bosnia-Herzegovina", "Bulgaria",
  "Croatia", "Cyprus", "Czech Republic", "Denmark", "England", "Estonia", "Faroe Islands", "Finland", "France",
  "Georgia", "Germany", "Gibraltar", "Greece", "Hungary", "Iceland", "Ireland", "Israel", "Italy", "Kazakhstan",
  "Kosovo", "Latvia", "Liechtenstein", "Lithuania", "Luxembourg", "Malta", "Moldova", "Montenegro", "N.Ireland",
  "Netherlands", "North Macedonia", "Norway", "Poland", "Portugal", "Romania", "San Marino", "Scotland", "Serbia",
  "Slovakia", "Slovenia", "Spain", "Sweden", "Switzerland", "Turkey", "Ukraine", "Wales",
];

describe("nations league team matching", () => {
  it("the roster is the 54 TSDB nations", () => {
    expect(NATIONS_LEAGUE_TEAMS.map((t) => t.name).sort()).toEqual([...TSDB_54].sort());
  });

  it("each canonical name self-matches and normalized mirrors normalize()", () => {
    for (const team of NATIONS_LEAGUE_TEAMS) {
      expect(normalize(team.name)).toBe(team.normalized);
      expect(matchToCanonical(team.name, L)?.name).toBe(team.name);
    }
  });

  it.each([
    ["Polska", "Poland"], ["Szwecja", "Sweden"], ["Hiszpania", "Spain"], ["Anglia", "England"],
    ["Niemcy", "Germany"], ["Holandia", "Netherlands"], ["Węgry", "Hungary"], ["Irlandia Północna", "N.Ireland"],
    ["Irlandia Płn.", "N.Ireland"], ["Irlandia", "Ireland"], ["Macedonia Północna", "North Macedonia"],
    ["Macedonia Płn.", "North Macedonia"], ["Bośnia i Hercegowina", "Bosnia-Herzegovina"], ["Czechy", "Czech Republic"],
    ["Wyspy Owcze", "Faroe Islands"], ["Kosowo", "Kosovo"], ["Mołdawia", "Moldova"], ["Czarnogóra", "Montenegro"],
    ["Gruzja", "Georgia"], ["Turcja", "Turkey"], ["Walia", "Wales"], ["Szkocja", "Scotland"], ["Białoruś", "Belarus"],
    ["Luksemburg", "Luxembourg"], ["Litwa", "Lithuania"], ["Łotwa", "Latvia"], ["Estonia", "Estonia"],
    ["San Marino", "San Marino"], ["Gibraltar", "Gibraltar"], ["Liechtenstein", "Liechtenstein"], ["Andora", "Andorra"],
    ["Azerbejdżan", "Azerbaijan"], ["Kazachstan", "Kazakhstan"], ["Cypr", "Cyprus"], ["Grecja", "Greece"],
    ["Słowacja", "Slovakia"], ["Słowenia", "Slovenia"], ["Chorwacja", "Croatia"], ["Serbia", "Serbia"],
    ["Rumunia", "Romania"], ["Bułgaria", "Bulgaria"], ["Ukraina", "Ukraine"], ["Dania", "Denmark"], ["Norwegia", "Norway"],
    ["Finlandia", "Finland"], ["Islandia", "Iceland"], ["Izrael", "Israel"], ["Szwajcaria", "Switzerland"],
    ["Austria", "Austria"], ["Belgia", "Belgium"], ["Francja", "France"], ["Włochy", "Italy"], ["Portugalia", "Portugal"],
    ["Albania", "Albania"], ["Armenia", "Armenia"], ["Malta", "Malta"],
  ])("%s → %s", (raw, canonical) => expect(getCanonicalTeamName(raw, L)).toBe(canonical));

  it("Ireland and Northern Ireland never merge", () => {
    expect(getNormalizedTeamName("Irlandia", L)).not.toBe(getNormalizedTeamName("Irlandia Płn.", L));
    expect(getCanonicalTeamName("Northern Ireland", L)).toBe("N.Ireland");
    expect(getCanonicalTeamName("Republic of Ireland", L)).toBe("Ireland");
  });

  it("the World Cup keeps resolving the same Polish names (shared national alias table)", () => {
    expect(getCanonicalTeamName("Wybrzeże Kości Słoniowej", "world-cup-2026")).toBe("Ivory Coast");
    expect(getCanonicalTeamName("Niemcy", "world-cup-2026")).toBe("Germany");
  });
});
