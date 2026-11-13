import { groupCoverage, isCoverageComplete, describeCoverage } from "../offer-coverage.js";
import { listingEvents, offerState } from "./helpers/direct-fixture.js";

const off = offerState();
const ev = off.events[0];
const has = (g: number) => (m: (typeof off.markets)[number]) => m.marketType.marketGroupIds!.includes(g);

describe("pzbuk group coverage", () => {
  it("counts every declared group of the recorded event as complete", () => {
    const c = groupCoverage(ev, off.markets);
    expect(c).toEqual({ declared: [1, 7], complete: [1, 7], declaredMarkets: 52, countedMarkets: 52, uniqueMarkets: 45 });
    expect([isCoverageComplete(c), describeCoverage(c)]).toEqual([true, "groups 2/2, markets counted 52/52"]);
  });
  it("counts a market listed in two declared groups once per group", () =>
    expect(off.markets.filter((m) => has(1)(m) && has(7)(m))).toHaveLength(7)); // 45 unique + 7 = 52 counted
  it("ignores marketGroupIds the event does not declare", () => {
    expect(off.markets.filter(has(28))).toHaveLength(3); // group 28 trimmed from the declaration
    expect(groupCoverage(ev, off.markets).countedMarkets).toBe(52);
  });
  it("is incomplete when one group delivers fewer markets than declared", () => {
    const c = groupCoverage(ev, off.markets.filter((m) => String(m.id) !== "459164851")); // a group-7-only market
    expect([c.complete, isCoverageComplete(c), describeCoverage(c)]).toEqual([[1], false, "groups 1/2, markets counted 51/52"]);
  });
  it("is never complete for an event without declared groups, and reports an absent event", () => {
    const none = groupCoverage({ ...ev, marketGroups: undefined }, off.markets);
    expect([none.declared, isCoverageComplete(none), describeCoverage(none)]).toEqual([[], false, "groups 0/0, markets counted 0/0"]);
    expect(describeCoverage(groupCoverage(listingEvents()[1], []))).toBe("groups 0/10, markets counted 0/235"); // 4408509 Leeds
  });
});
