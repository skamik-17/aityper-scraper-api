import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDiagnostics } from "../ws-protocol.js";

const capture = vi.hoisted(() => vi.fn());
vi.mock("../navigation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../navigation.js")>()),
  captureWebSocketData: capture,
  navigateToEventPage: vi.fn(async () => true),
}));

const { pzbukScraper } = await import("../index.js");
const { buildEventUrl } = await import("../navigation.js");

describe("pzbuk scrapeMatchDetails (legacy path)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    capture.mockReset();
  });

  it("filters the capture on the event id of an /events/<id>-<slug> URL", async () => {
    capture.mockResolvedValue({ state: null, diagnostics: emptyDiagnostics() });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(pzbukScraper as any, "executeWithBrowser").mockImplementation(
      async (operation: any) => operation({} as Page, {}),
    );
    const url = buildEventUrl("4408475", "Everton FC", "Coventry City", "134", "Premier League");
    expect(url).toMatch(/\/events\/4408475-everton-fc-coventry-city$/);
    await pzbukScraper.scrapeMatchDetails(url);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0].slice(1)).toEqual([true, "4408475"]);
  });
});
