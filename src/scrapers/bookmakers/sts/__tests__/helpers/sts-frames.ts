/**
 * Recorded STS WebSocket frames and small capture helpers shared by the STS
 * tests. Paths are relative to `__tests__/fixtures/`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordStsFrame } from "../../navigation.js";
import type { WSCaptureResult } from "../../types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

/** The four Premier League fixtures of the trimmed 2026-11-07 WebSocket capture, in listing order */
export const WS_IDS = ["f2921896", "f2921905", "f2921906", "f2921911"] as const;

/** Frames a transport would see for one league run: the i_pl frame, then each fixture's frames in order */
export interface StsReplayInput {
  ipl: string;
  byFixture: Record<string, readonly string[]>;
}

export function readStsFixture(rel: string): string {
  return readFileSync(join(FIXTURES, rel), "utf8");
}

export function emptyCapture(): WSCaptureResult {
  return { initialData: "", fixtureData: new Map() };
}

export function wsIplFrame(): string {
  return readStsFixture("ws-2026-11-07/i_pl.snapshot.txt");
}

export function wsSnapshotFrame(id: string): string {
  return readStsFixture(`ws-2026-11-07/f_${id}_pl.snapshot.txt`);
}

/** A fresh input: the trimmed i_pl snapshot plus one snapshot per WS_IDS entry */
export function wsInput(): StsReplayInput {
  return { ipl: wsIplFrame(), byFixture: Object.fromEntries(WS_IDS.map((id) => [id, [wsSnapshotFrame(id)]])) };
}

/**
 * The same i_pl frame (header line kept) with B.S["1"].C reduced to category "1",
 * its tournaments to "17" (Premier League) and that tournament's fixtures to `ids`.
 * The market association map P is unchanged.
 */
export function restrictIplFrame(frame: string, ids: readonly string[]): string {
  const newline = frame.indexOf("\n");
  const body = JSON.parse(frame.slice(newline + 1));
  const sport = body.B.S["1"];
  const category = sport.C["1"];
  const tournament = category.T["17"];
  tournament.FX = Object.fromEntries(Object.entries(tournament.FX).filter(([id]) => ids.includes(id)));
  category.T = { "17": tournament };
  sport.C = { "1": category };
  return `${frame.slice(0, newline)}\n${JSON.stringify(body)}`;
}

/** emptyCapture() with every frame recorded in order */
export function captureFrom(frames: readonly string[]): WSCaptureResult {
  const capture = emptyCapture();
  for (const frame of frames) recordStsFrame(capture, frame);
  return capture;
}

/** Runs `run` while recording console.log/warn/error lines (first argument) in call order */
export async function captureLines<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const record = (...args: unknown[]) => {
    lines.push(String(args[0]));
  };
  console.log = record;
  console.warn = record;
  console.error = record;
  try {
    const value = await run();
    return { value, lines };
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
}
