/**
 * Test-only Swarm payloads taken from the tracked recordings, shared by the
 * browser-path and Swarm-client tests so both paths see the same data.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SwarmData } from "../../types.js";
import {
  createFakeSwarmPage,
  loadRecording,
  type FakeSwarmPage,
  type RecordedSwarmEvent,
} from "./fake-swarm-page.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const RECORDED_GAME_ID = "31321159";

/** The 20 game ids of the recorded GameList, in listing (ascending key) order */
export const RECORDED_GAME_IDS: readonly number[] = Object.freeze([
  31321159, 31333512, 31333513, 31333514, 31333515, 31340647, 31340648, 31340664, 31340665, 31340666,
  31419243, 31419244, 31419245, 31419246, 31419296, 31419297, 31419298, 31419299, 31419300, 31419348,
]);

/** readFileSync of `__tests__/fixtures/<fileName>` */
export function loadFixtureText(fileName: string): string {
  return readFileSync(join(FIXTURES_DIR, fileName), "utf8");
}

let leagueEvents: RecordedSwarmEvent[] | null = null;
let matchEvents: RecordedSwarmEvent[] | null = null;
const leagueRecording = () => (leagueEvents ??= loadRecording("league-538-frames.json"));
const matchRecording = () => (matchEvents ??= loadRecording("match-31321159-frames.json"));

function recvPayload(events: RecordedSwarmEvent[], ridPrefix: string, minGames: (data: SwarmData) => boolean): string {
  for (const e of events) {
    if (e.kind !== "recv" || !e.payload?.startsWith("{")) continue;
    const msg = JSON.parse(e.payload);
    if (String(msg.rid ?? "").startsWith(ridPrefix) && msg.data?.data?.sport && minGames(msg.data.data)) return e.payload;
  }
  throw new Error(`no recorded ${ridPrefix} reply`);
}

function hasGames(data: SwarmData): boolean {
  for (const sport of Object.values(data.sport ?? {})) {
    for (const region of Object.values(sport.region ?? {})) {
      for (const competition of Object.values(region.competition ?? {})) {
        if (Object.keys(competition.game ?? {}).length > 0) return true;
      }
    }
  }
  return false;
}

let listingPayload: string | null = null;
let gamePayload: string | null = null;

/** data.data of the first GameList reply of the league recording (t=1908, 20 games, P1XP2 only); a fresh copy per call */
export function recordedListing(): SwarmData {
  listingPayload ??= recvPayload(leagueRecording(), "GameList", hasGames);
  return JSON.parse(listingPayload).data.data as SwarmData;
}

/** data.data of the SINGLE_GAME_VIEW reply of the match recording (t=2654, 613 markets), game 31321159 renamed to `gameId`; a fresh copy per call */
export function recordedGame(gameId: number): SwarmData {
  gamePayload ??= recvPayload(matchRecording(), "SINGLE_GAME_VIEW", hasGames);
  return JSON.parse(gamePayload.replaceAll(RECORDED_GAME_ID, String(gameId))).data.data as SwarmData;
}

/** The recorded match frames, with game 31321159 renamed to `id` */
export function retarget(events: RecordedSwarmEvent[], id: number): RecordedSwarmEvent[] {
  return events.map((e) =>
    e.payload ? { ...e, payload: e.payload.replaceAll(RECORDED_GAME_ID, String(id)) } : e
  );
}

/** A browser page for a full-offer scrape: /538 replays the league recording, any other URL the match recording retargeted to its trailing id */
export function browserOfferPage(): FakeSwarmPage {
  return createFakeSwarmPage((url) =>
    url.endsWith("/538")
      ? { events: leagueRecording() }
      : { events: retarget(matchRecording(), Number(url.split("/").pop())) }
  );
}
