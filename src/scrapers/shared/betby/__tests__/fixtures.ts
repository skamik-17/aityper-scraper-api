// Loaders for the Betby evidence captured on 2026-11-06 and copied under
// __tests__/fixtures/<bookmaker>/ (see docs/superpowers/plans/2026-11-06-scraper-recovery/).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BetbyBookmaker } from "../types.js";

export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export function fixturePath(bm: BetbyBookmaker, file: string): string {
  return join(FIXTURES_DIR, bm, file);
}

export function loadText(bm: BetbyBookmaker, file: string): string {
  return readFileSync(fixturePath(bm, file), "utf8");
}

// Defaults to `any` so tests can drill into raw evidence without restating its shape.
export function loadJson<T = any>(bm: BetbyBookmaker, file: string): T {
  return JSON.parse(loadText(bm, file)) as T;
}
