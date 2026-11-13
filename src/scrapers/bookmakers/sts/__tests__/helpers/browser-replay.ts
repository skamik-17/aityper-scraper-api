/**
 * Drives the STS browser path over recorded frames, without a browser.
 * The calling test file must mock `../navigation.js` (navigateAndCaptureLeagueData
 * and navigateAndCaptureMatchData as vi.fn()) and pass the mocked module in.
 */
import { vi, type Mock } from "vitest";
import type { Page } from "playwright";
import { PlaywrightScraper } from "../../../../base/playwright-base.js";
import type { FullOfferScraperResult } from "../../../../../types/full-offer.js";
import { STSScraper } from "../../index.js";
import { captureFrom, captureLines, type StsReplayInput } from "./sts-frames.js";

export type MockedNav = { navigateAndCaptureLeagueData: Mock; navigateAndCaptureMatchData: Mock };

type FullOfferLogic = (page: Page, league: string) => Promise<FullOfferScraperResult>;

export async function runBrowserPath(
  nav: MockedNav,
  input: StsReplayInput,
  league = "premier-league",
): Promise<{ value: FullOfferScraperResult; lines: string[] }> {
  nav.navigateAndCaptureLeagueData.mockResolvedValue(captureFrom([input.ipl]));
  nav.navigateAndCaptureMatchData.mockImplementation(async (_page: unknown, url: string) => {
    const id = url.split("/").pop()!;
    return captureFrom([input.ipl, ...(input.byFixture[id] ?? [])]);
  });
  // Bypasses the browser and observability's page recorder
  const exec = vi
    .spyOn(PlaywrightScraper.prototype as any, "executeFullOfferScrape")
    .mockImplementation(((l: string, _valid: unknown, logic: FullOfferLogic) => logic({} as Page, l)) as any);
  const delay = vi.spyOn(PlaywrightScraper.prototype as any, "delay").mockResolvedValue(undefined);
  try {
    return await captureLines(() => new STSScraper().scrapeFullOffer(league));
  } finally {
    exec.mockRestore();
    delay.mockRestore();
  }
}
