import type { PolishBookmaker } from "./index.js";

export interface LeagueBookmakerConfig {
  id: string | number;
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
}

export const LEAGUES: LeagueConfig[] = [
  {
    slug: "ekstraklasa",
    displayName: "Ekstraklasa",
    displayNamePl: "Ekstraklasa",
    country: "Poland",
    bookmakers: {
      sts: { id: 46, url: "https://www.sts.pl/pl/zaklady-bukmacherskie/pilka-nozna/polska/ekstraklasa" },
      fortuna: { id: "ufo:tour:00-0b9" },
      betclic: { id: 221 },
      superbet: { id: 644 },
      lvbet: { id: 37669 },
      fuksiarz: { id: 265 },
      betfan: { id: 294 },
      totalbet: { id: 7023 },
      forbet: { id: 29994 },
      etoto: { id: 666 },
      betters: { id: 4440 },
      lebull: { id: 4847 },
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
      totalbet: { id: 7124 },
      forbet: { id: 199 },
      etoto: { id: 206 },
      betters: { id: 4485 },
      lebull: { id: 4485 },
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
      totalbet: { id: 7110 },
      forbet: { id: 159 },
      etoto: { id: 1165 },
      betters: { id: 4486 },
      lebull: { id: 4486 },
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
      totalbet: { id: 7151 },
      forbet: { id: 118 },
      etoto: { id: 209 },
      betters: { id: 4484 },
      lebull: { id: 4484 },
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
      totalbet: { id: 7219 },
      forbet: { id: 165 },
      etoto: { id: 350 },
      betters: { id: 4610 },
      lebull: { id: 4610 },
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
      // Filled in incrementally by later scraper tasks.
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
