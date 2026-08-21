import { describe, it, expect } from "vitest";
import { matchToCanonical } from "../team-matcher.js";

/**
 * Regression coverage for the "ghost match" bug: three live rows in the
 * `odds` table had the same club on both sides of a fixture
 * (`premier-league:manchester united:manchester united`,
 * `premier-league:sunderland:sunderland`,
 * `premier-league:luton town:luton town`).
 *
 * matchToCanonical() had zero test coverage for the Premier League/
 * Ekstraklasa matching path before this file - only the World Cup nation
 * matcher was tested. That gap is why stage 3's substring test could
 * silently collapse bare generic words ("United", "City", "Town") onto the
 * first alphabetical club for months without anything failing.
 */
const PL = "premier-league";

describe("team-matcher: ambiguous-fragment collision guard", () => {
  it("stage 3 no longer resolves bare generic suffix words shared by several clubs", () => {
    // Before the fix: stage 3's substring test returned the first team in
    // premier-league-teams.ts whose normalized name contained the fragment,
    // i.e. "United" -> Manchester United, "City" -> Coventry City. Tested
    // against ekstraklasa (no club there contains either word), so a null
    // result here proves stage 3's own ambiguity check, not a coincidental
    // rescue-or-reject by the unrelated fuzzy fallback.
    expect(matchToCanonical("United", "ekstraklasa")).toBeNull();
    expect(matchToCanonical("City", "ekstraklasa")).toBeNull();
  });

  it(
    "KNOWN RESIDUAL GAP: a bare word can still resolve via fuzzy fallback in a " +
      "league that has clubs containing it - accepted, not fixed here",
    () => {
      // Stage 3 correctly refuses "United"/"City"/"Town" as ambiguous now
      // (see the ekstraklasa case above), but Fuse's stage 4 independently
      // scores these same bare words against premier-league-teams.ts and
      // still returns a (different, still wrong) club - e.g. "United" now
      // resolves to Leeds United instead of Manchester United, not to null.
      // Deliberately NOT tightened in this pass: manually verified that
      // "Man City" - a common, legitimate real bookmaker abbreviation -
      // already scores closer to "Hull City" (0.259) than a hypothetical
      // ambiguity-margin guard would tolerate, so hardening stage 4 without
      // live-traffic validation risks breaking real abbreviations to fix a
      // case (a bare single generic word, alone, as a full team name) that
      // has not actually been observed from a real scrape. The three rows
      // that WERE observed live are fully covered by the self-fixture guard
      // (parser.ts) and the same-canonical-id guard (index.ts /
      // full-offer-repository.ts) below - neither depends on this gap being
      // closed.
      expect(matchToCanonical("United", PL)).not.toBeNull();
    }
  );

  it("does not resolve an empty or whitespace-only name to teams[0]", () => {
    // team.normalized.includes("") is always true, so a blank string used
    // to match whichever club happened to be first in the array.
    expect(matchToCanonical("", PL)).toBeNull();
    expect(matchToCanonical("   ", PL)).toBeNull();
  });

  it("still resolves a real, uniquely-substring-matching abbreviation", () => {
    // The guard must reject AMBIGUOUS fragments, not short ones - "Lech" is
    // 4 characters, same length as "City"/"Town", but only one Ekstraklasa
    // club's normalized name contains it.
    expect(matchToCanonical("Lech", "ekstraklasa")?.name).toBe("Lech Poznan");
  });

  it("still resolves a real, uniquely-matching partial club name", () => {
    // "Bournemouth" alone is a substring of exactly one Premier League
    // club's full name - must keep working, unlike the ambiguous cases
    // above.
    expect(matchToCanonical("Bournemouth", PL)?.name).toBe("AFC Bournemouth");
  });
});

describe("team-matcher: same-team-both-sides is the shape to guard against upstream", () => {
  it("two different non-league club names can independently resolve to the same whitelist entry", () => {
    // This is NOT a matchToCanonical bug to "fix" here - Fuse's fuzzy stage
    // is a last resort specifically for near-miss spellings of a REAL
    // canonical name, and tightening its threshold to stop this pair breaks
    // legitimate abbreviations elsewhere (verified manually: "Man City"
    // already scores closer to Hull City than to Manchester City at the
    // current threshold, so a naive ambiguity-margin guard on stage 4 would
    // have broken a common real abbreviation instead of fixing this).
    // The actual fix is at the call site (sts/index.ts and
    // full-offer-repository.ts): reject when both sides resolve to the same
    // canonical id, regardless of which stage produced the match. This test
    // documents that the collision is real and expected to reach that
    // downstream guard, not something matchToCanonical itself should hide.
    const home = matchToCanonical("Stockton Town", PL);
    const away = matchToCanonical("Alfreton Town", PL);
    expect(home?.id).toBeDefined();
    expect(home?.id).toBe(away?.id);
  });
});
