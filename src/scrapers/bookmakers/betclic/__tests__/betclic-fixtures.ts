/**
 * Shared fixtures for betclic transport tests: recorded gRPC-web-text group
 * responses (Arsenal vs Hull) and a builder for per-group fetch results.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeGrpcWebTextFrame } from "../navigation.js";
import type { BetclicGroupName, BetclicGroupResult } from "../match-groups.js";

export const b64 = (file: string): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", file), "utf8");

export const TOP_B64 = b64("arsenal-hull_TOP.grpc-web-text.b64");
export const HANDICAP_B64 = b64("arsenal-hull_HANDICAP.grpc-web-text.b64");
export const TOP_MSG: Buffer = decodeGrpcWebTextFrame(TOP_B64).message;
export const HANDICAP_MSG: Buffer = decodeGrpcWebTextFrame(HANDICAP_B64).message;

export const ORDER: BetclicGroupName[] = ["TOP", "WYNIK", "STRZELCY", "GOLE", "METODA_GOLA", "HANDICAP", "STATYSTYKI"];

/**
 * Seven group results in MARKET_GROUP_FILTERS order. A string override becomes
 * a failed group with that error; defaults are TOP, HANDICAP and the TOP echo
 * for every other group.
 */
export function groupResults(over: Partial<Record<BetclicGroupName, Buffer | string>> = {}): BetclicGroupResult[] {
  return ORDER.map((group) => {
    const value = group in over ? over[group]! : group === "TOP" ? TOP_MSG : group === "HANDICAP" ? HANDICAP_MSG : Buffer.from(TOP_MSG);
    return typeof value === "string" ? { group, response: null, error: value } : { group, response: value, error: null };
  });
}
