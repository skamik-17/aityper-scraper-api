import { describe, it, expect, vi } from "vitest";
vi.mock("../navigation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../navigation.js")>()),
  navigateAndCaptureLeagueData: vi.fn(), navigateAndCaptureMatchData: vi.fn(),
}));
import * as nav from "../navigation.js";
import { parseWebSocketJson, parseFixtures, parseAllMarkets } from "../parser.js";
import type { FullOfferScraperResult } from "../../../../types/full-offer.js";
import { runBrowserPath, type MockedNav } from "./helpers/browser-replay.js";
import { runWsPath } from "./helpers/fake-sts-server.js";
import { readStsFixture, restrictIplFrame, wsInput, wsSnapshotFrame, type StsReplayInput } from "./helpers/sts-frames.js";

/**
 * README §6 parity gate (1): the browser path and the WebSocket path fed the
 * same recorded frames produce deep-equal offers (ignoring scrapedAt) and the
 * same [STS/FullOffer] log lines, which the recovery scripts parse.
 */
const NOV6 = (): StsReplayInput => ({                       // browser-captured 2026-11-06 frames, snapshot then delta
  ipl: restrictIplFrame(readStsFixture("i_pl.trimmed.txt"), ["f2921896", "f2921898"]),
  byFixture: {
    f2921896: [readStsFixture("f_f2921896_pl.leeds-tottenham.snapshot.txt"), readStsFixture("f_f2921896_pl.leeds-tottenham.delta.txt")],
    f2921898: [readStsFixture("f_f2921898_pl.arsenal-hull.snapshot.txt")],
  },
});
const comparable = (r: FullOfferScraperResult) => r.matches.map(({ scrapedAt: _s, ...m }) => m);
const fullOffer = (lines: string[]) => lines.filter((l) => l.startsWith("[STS/FullOffer]"));

describe("sts transport parity", () => {
  it.each([{ name: "WS capture 2026-11-07, 4 fixtures", input: wsInput }, { name: "browser capture 2026-11-06", input: NOV6 }])(
    "$name: both transports produce deep-equal offers and the same [STS/FullOffer] lines", async ({ input }) => {
      const b = await runBrowserPath(nav as unknown as MockedNav, input());
      const w = await runWsPath(input());
      expect([b.value.success, w.value.success]).toEqual([true, true]);
      expect([b.value.error, w.value.error]).toEqual([undefined, undefined]);
      expect(w.value.matches).toHaveLength(Object.keys(input().byFixture).length);
      expect(comparable(w.value)).toEqual(comparable(b.value));
      expect(fullOffer(w.lines)).toEqual(fullOffer(b.lines));
    });

  it("recovery replay inputs: WS-path markets are exactly what replay-2026-11.test.ts normalizes", async () => {
    const { value } = await runWsPath(NOV6());
    const ipl = parseWebSocketJson(readStsFixture("i_pl.trimmed.txt"))!;
    for (const [id, file] of [["f2921898", "f_f2921898_pl.arsenal-hull.snapshot.txt"], ["f2921896", "f_f2921896_pl.leeds-tottenham.snapshot.txt"]] as const) {
      const fixture = parseFixtures(ipl, "premier-league").find((f) => f.id === id)!;     // replay-2026-11.test.ts call shape
      expect(value.matches.find((m) => m.matchId === id)!.markets).toEqual(parseAllMarkets(fixture, parseWebSocketJson(readStsFixture(file)), ipl));
    }
  });

  it("negative control: a different snapshot for the same fixture is detected", async () => {
    const other = NOV6(); other.byFixture.f2921896 = [wsSnapshotFrame("f2921896")];
    const b = await runBrowserPath(nav as unknown as MockedNav, NOV6());
    const w = await runWsPath(other);
    expect(comparable(w.value)).not.toEqual(comparable(b.value));
  });
});
