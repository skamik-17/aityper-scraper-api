import { describe, expect, it } from "vitest";
import { differences, newestCycleRunIds, parseRunIds } from "../../../scripts/compare-odds-models.js";

describe("compare-odds-models script", () => {
  it("--run may repeat", () => expect(parseRunIds(["--run", "a", "--run", "b", "--other"])).toEqual(["a", "b"]));

  it("the newest cycle is every run id started within 10 minutes of the newest", () => {
    expect(
      newestCycleRunIds([
        { run_id: "pl-2", started_at: "2026-11-07T11:00:00.300Z" },
        { run_id: "pl-2", started_at: "2026-11-07T11:00:00.300Z" },
        { run_id: "ll-2", started_at: "2026-11-07T11:00:00.350Z" },
        { run_id: null, started_at: "2026-11-07T11:01:00.000Z" },
        { run_id: "pl-1", started_at: "2026-11-07T10:00:00.300Z" },
      ]),
    ).toEqual(["pl-2", "ll-2"]);
    expect(newestCycleRunIds([])).toEqual([]);
  });

  it("only one-sided and differing rows count as differences", () =>
    expect(differences({ run_id: "x", pairs: 3, legacy_rows: 9, model_rows: 9, only_legacy: 1, only_model: 0, differing: 2, samples: [] })).toBe(3));
});
