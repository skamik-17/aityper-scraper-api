import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseDbTimestamp } from "../db-timestamp.js";

// The defensive offset-less case only differs from `new Date(ts)` on a non-UTC host.
// Pin the host timezone of the 2026-11-06 evidence so the test means the same everywhere.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Europe/Warsaw";
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("parseDbTimestamp (Review Focus 3)", () => {
  it("parses the real PostgREST timestamptz shape (db-probe §3)", () => {
    expect(parseDbTimestamp("2026-11-06T16:02:49.048+00:00").toISOString()).toBe("2026-11-06T16:02:49.048Z");
    expect(parseDbTimestamp("2026-11-06T17:02:49.048+01:00").toISOString()).toBe("2026-11-06T16:02:49.048Z");
    expect(parseDbTimestamp("2026-11-06T16:02:49.048Z").toISOString()).toBe("2026-11-06T16:02:49.048Z");
  });

  it("defensively treats offset-less input as UTC (host is Europe/Warsaw)", () => {
    // Plain `new Date()` reads this as local time: 15:00:00.350Z on this host.
    expect(new Date("2026-11-06T16:00:00.35").toISOString()).toBe("2026-11-06T15:00:00.350Z");
    expect(parseDbTimestamp("2026-11-06T16:00:00.35").toISOString()).toBe("2026-11-06T16:00:00.350Z");
  });
});
