import type { PolishBookmaker } from "./index.js";

export interface LeagueBookmakerConfig {
  id: string | number;
  /** Further competition ids when the bookmaker splits the league (e.g. Betby's Nations League A and B). */
  extraIds?: ReadonlyArray<string | number>;
  url?: string;
  tournamentFilter?: string;
  countryFilter?: string;
}

export interface LeagueConfig {
  slug: string;
  displayName: string;
  displayNamePl: string;
  country: string;
  bookmakers: Partial<Record<PolishBookmaker, LeagueBookmakerConfig>>;
  /**
   * A competition that plays only in windows (international breaks): scheduled runs scrape it only
   * while a cached TheSportsDB fixture kicks off between `tailHours` ago and `leadDays` ahead.
   */
  fixtureWindow?: { leadDays: number; tailHours: number };
}

export const LEAGUES: LeagueConfig[] = [
  {
    slug: "ekstraklasa",
    displayName: "Ekstraklasa",
    displayNamePl: "Ekstraklasa",
    country: "Poland",
    bookmakers: {
      sts: { id: 46, url: "https://www.sts.pl/pl/zaklady-bukmacherskie/pilka-nozna/polska/ekstraklasa" },
      fortuna: { id: "ufo:tour:00-05k" },
      betclic: { id: 221 },
      superbet: { id: 644 },
      lvbet: { id: 37669 },
      fuksiarz: { id: 265 },
      betfan: { id: 294 },
      totalbet: { id: "ae7d4621-313d-4df6-b3be-046b76a32938" },
      forbet: { id: 29994 },
      etoto: { id: 666 },
      betters: { id: "1669818868635406336" },
      lebull: { id: "1669818868635406336" },
      betcris: { id: 1978 },
      pzbuk: { id: "524" },
    },
  },
  {
    slug: "premier-league",
    displayName: "Premier League",
    displayNamePl: "Premier League",
    country: "England",
    bookmakers: {
      sts: { id: 17, url: "https://www.sts.pl/pl/zaklady-bukmacherskie/pilka-nozna/anglia/premier-league" },
      fortuna: { id: "ufo:tour:00-03m" },
      betclic: { id: 3 },
      superbet: { id: 106 },
      lvbet: { id: 37685 },
      fuksiarz: { id: 625 },
      betfan: { id: 244 },
      totalbet: { id: "8793bb6a-4684-44ba-b92e-4d896e6cbfbf" },
      forbet: { id: 199 },
      etoto: { id: 206 },
      betters: { id: "1669818860469096448" },
      lebull: { id: "1669818860469096448" },
      betcris: { id: 538 },
      pzbuk: { id: "134" },
    },
  },
  {
    slug: "laliga",
    displayName: "La Liga",
    displayNamePl: "La Liga",
    country: "Spain",
    bookmakers: {
      sts: { id: 8, url: "https://www.sts.pl/pl/zaklady-bukmacherskie/pilka-nozna/hiszpania/laliga" },
      fortuna: { id: "ufo:tour:00-0h7" },
      betclic: { id: 7 },
      superbet: { id: 98 },
      lvbet: { id: 41533 },
      fuksiarz: { id: 654 },
      betfan: { id: 230 },
      totalbet: { id: "cfb6428c-c437-4923-a370-562871d06316" },
      forbet: { id: 159 },
      etoto: { id: 1165 },
      betters: { id: "1669819032615915520" },
      lebull: { id: "1669819032615915520" },
      betcris: { id: 545 },
      pzbuk: { id: "171" },
    },
  },
  {
    slug: "serie-a",
    displayName: "Serie A",
    displayNamePl: "Serie A",
    country: "Italy",
    bookmakers: {
      sts: { id: 23, url: "https://www.sts.pl/pl/zaklady-bukmacherskie/pilka-nozna/wlochy/serie-a" },
      fortuna: { id: "ufo:tour:00-06t" },
      betclic: { id: 6 },
      superbet: { id: 104 },
      lvbet: { id: 37680 },
      fuksiarz: { id: 635 },
      betfan: { id: 215 },
      totalbet: { id: "0253b9f3-ab3b-4d19-ab4e-87aa8c3adb8e" },
      forbet: { id: 118 },
      etoto: { id: 209 },
      betters: { id: "1669819042829045760" },
      lebull: { id: "1669819042829045760" },
      betcris: { id: 543 },
      pzbuk: { id: "148" },
    },
  },
  {
    slug: "ligue-1",
    displayName: "Ligue 1",
    displayNamePl: "Ligue 1",
    country: "France",
    bookmakers: {
      sts: { id: 16, url: "https://www.sts.pl/pl/zaklady-bukmacherskie/pilka-nozna/francja/ligue-1" },
      fortuna: { id: "ufo:tour:00-0bo" },
      betclic: { id: 4 },
      superbet: { id: 100 },
      lvbet: { id: 37682 },
      fuksiarz: { id: 1152 },
      betfan: { id: 214 },
      totalbet: { id: "f64248fd-8f4a-499f-8092-3408cecf2565" },
      forbet: { id: 165 },
      etoto: { id: 350 },
      betters: { id: "1669818844560101376" },
      lebull: { id: "1669818844560101376" },
      betcris: { id: 548 },
      pzbuk: { id: "395" },
    },
  },
  {
    slug: "world-cup-2026",
    displayName: "World Cup 2026",
    displayNamePl: "Mundial 2026",
    country: "World",
    bookmakers: {
      sts: { id: 16, url: "https://www.sts.pl/pl/zaklady-bukmacherskie/pilka-nozna/miedzynarodowe/kwalifikacje-ms---europa/1/3/11" },
      fortuna: { id: "ufo:tour:00-2h1" },
      betclic: { id: 1 },
      superbet: { id: 1432 },
      lvbet: { id: 37392 },
      fuksiarz: { id: 174616 },
      betfan: { id: 535035 },
      forbet: { id: 73181 },
      etoto: { id: 15850 },
      // betters, lebull: Betby lists only the next (2030) World Cup (tournament
      // 1670073988614852608); mapping it would file 2030 matches under
      // world-cup-2026 — intentionally omitted.
      betcris: { id: 2969 },
      pzbuk: { id: "1810" },
      totalbet: { id: "298d1945-aed7-4b43-ba39-3dbc23a59cd0" },
    },
  },
  {
    // UEFA Nations League 2026/27 (TheSportsDB 4490). Ids from live discovery 2026-11-14.
    slug: "nations-league",
    displayName: "UEFA Nations League",
    displayNamePl: "Liga Narodów UEFA",
    country: "Europe",
    // Plays only in international windows; between them every bookmaker lists 0 matches
    fixtureWindow: { leadDays: 14, tailHours: 3 },
    bookmakers: {
      sts: { id: 12277, url: "https://www.sts.pl/pl/zaklady-bukmacherskie/pilka-nozna/miedzynarodowe/liga-narodow-uefa/1/3/12277" },
      fortuna: { id: "ufo:tour:00-078" },
      betclic: { id: 22676 },
      // Superbet splits the league phase into 14 groups; the scraper reads all of them from TOURNAMENT_IDS
      superbet: { id: 32375 },
      lvbet: { id: 35699 },
      // Fuksiarz splits the league into League A-D categories; its multi endpoint takes a comma list.
      // Never 231641 (season specials whose names look like matches).
      fuksiarz: { id: "178719,178718,178722,231480" },
      betfan: { id: 277 },
      forbet: { id: 29929 },
      etoto: { id: 286 },
      totalbet: { id: "3de58c0b-4015-42f6-88c8-38ae34897b82" },
      betcris: { id: 27844 },
      pzbuk: { id: "1336" },
      // Betby lists League A and League B as two tournaments; Leagues C/D are not offered
      betters: { id: "2707230903544983592", extraIds: ["2707230903544983600"] },
      lebull: { id: "2707230903544983592", extraIds: ["2707230903544983600"] },
    },
  },
];

const leaguesBySlug = new Map<string, LeagueConfig>(
  LEAGUES.map((league) => [league.slug, league])
);

export function getLeagueConfig(slug: string): LeagueConfig | undefined {
  return leaguesBySlug.get(slug);
}

export function getBookmakerLeagueId(
  slug: string,
  bookmaker: PolishBookmaker
): string | number | undefined {
  const league = leaguesBySlug.get(slug);
  return league?.bookmakers[bookmaker]?.id;
}

export function getBookmakerLeagueConfig(
  slug: string,
  bookmaker: PolishBookmaker
): LeagueBookmakerConfig | undefined {
  const league = leaguesBySlug.get(slug);
  return league?.bookmakers[bookmaker];
}

export function isLeagueSupported(slug: string, bookmaker: PolishBookmaker): boolean {
  const league = leaguesBySlug.get(slug);
  return league?.bookmakers[bookmaker] !== undefined;
}

export function getSupportedLeagues(bookmaker: PolishBookmaker): string[] {
  return LEAGUES
    .filter((league) => league.bookmakers[bookmaker] !== undefined)
    .map((league) => league.slug);
}

export function getAllLeagueSlugs(): string[] {
  return LEAGUES.map((league) => league.slug);
}

export type LeagueSlug = typeof LEAGUES[number]["slug"];
