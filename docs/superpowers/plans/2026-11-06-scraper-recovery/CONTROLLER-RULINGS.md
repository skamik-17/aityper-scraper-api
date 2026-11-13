# Controller rulings — scraper recovery (2026-11-13)

Source: task reviews in workflow wf_3175bae2-047 (journal digest:
/tmp/claude-1000/-home-skamik-Documents-repositories-personal-aityper/3627e2c8-f787-4f71-8a6a-348993c930fc/scratchpad/task-digest.json).
Format: Ruling — why — cost if wrong. "FIX" items go to the final fix wave.

## Plan-mandated review findings

1. fuksiarz T0 (HALF_WITH_MORE_GOALS repair guard, parser.ts:168-191) — FIX: replace the swap with a drop.
   When the label order matches the old buggy template AND odds(rowno) < odds(2. polowa), return no market and warn instead of swapping.
   — Rule 8: on a low-total match (lambda < ~1.5) "equal" really can be the shortest price, so the swap can invert correct data into a fake best DRAW price. The two cases cannot be told apart, so we drop.
   — Cost if wrong: fuksiarz HALF_WITH_MORE_GOALS goes missing on rare low-total matches or during an upstream regression.
2. betcris T1 (30 s first-useful-frame window also used for single-event captures) — FIX: add a separate single-event window of 45 s; keep 30 s for the listing.
   — The reviewer measured headroom of 0.88x on match pages vs 1.13x on the listing, and target_game_missing is final.
   — Cost if wrong: a dead match page takes 15 s longer to fail.
3. superbet T2/T4 (first-half team exact goals: '3+' published as code '3', i.e. "exactly 3") — PARK, owner follow-up.
   — This is pre-existing and plan-mandated. A 3+ price is always <= the fair exact-3 price, so it cannot create false +EV. The correct fix needs a catalog tier (Group D forbids new codes) or dropping a blessed selection.
   — Cost if wrong: the label stays imprecise until the owner decides.
4. forbet T2 (*_OR_BTTS_NO meaning) — ACCEPTED as fixed in round 1: forbet publishes only the YES legs.
   FOLLOW-ON FIX (cross-plan, odds integrity): etoto (etoto-normalizer.ts ~737-748) and superbet (superbet-normalizer.ts ~78-85, ~1671-1680) map the "nie" leg of "X lub obie strzelą" (= NEITHER) to <SIDE>_OR_BTTS_NO. The catalog and lebull define that code as "X OR BTTS-No". recovery/integration revives lebull (betby migration), so the row would mix about 8-9 against about 1.2 (fake +EV ~3.5x, below the 10x detector, and the overround check skips _OR_ codes).
   Ruling: etoto and superbet drop the "nie" leg exactly as forbet does (publish YES only), with tests and a rebless of the affected blessed entries. Verify the semantics against the fixtures before changing.
   — Rule 8.
   — Cost if wrong: etoto/superbet lose the *_OR_BTTS_NO legs (coverage only).
5. fuksiarz T2 (shared grouper: a hyphen-split row is stranded after the spellingKey merge prefers the spaced form) — FIX: the token compatibility check (market-type-grouper.ts ~363/~382) treats '-' as a token separator (or checks against the union of the merged spellings), so "J. Hjerto-Dahl" still joins "Jens Hjerto Dahl". Add the reviewer's two probe cases as tests.
   — This is a coverage regression against Task 1; prices are not wrong.
   — Cost if wrong: names that differ only by a hyphen merge, which practically means the same player.
6. pzbuk T2 (marketGroupsSeen intersection can mark group 1 Popularne as seen) — FIX if contained: mark a group as seen only when its own subscription answered; otherwise PARK as diagnostics-only.
   — Prices are not affected; this is a silent-gap diagnostic.
   — Cost if wrong: a noisier log line.
7. lvbet T3 (EXACT_GOALS catch-all folds an out-of-catalog 7+/8+ into 6+) — FIX: drop the out-of-catalog '+' tiers with a warning; never fold a higher '+' tier into a lower one. Pin it with a test (ladder 0..6, 7+ -> no 6+ selection from 7+).
   — Rule 8: the fold would publish P(>=7) as 6+, which is false +EV.
   — Cost if wrong: one missing selection.
8. betclic T2 (fouls regex accepts trailing qualifiers such as "- 1. połowa") — FIX: restrict the capture as the reviewer proposes and add a test pinning OTHER for the "- X - 1. połowa" name.
   — Rule 8: it is a latent wrong-period mapping.
   — Cost if wrong: none, because no such name exists today.
9. lvbet T5 (L1 deferred gate ">= 900 markets") — RULING, no code: L1 becomes "per-player ladder rows present AND N markets >= 850" in the deferred acceptance list.
   — Live data already shows 890 on a correct parse.
   — Cost if wrong: a slightly weaker gate.
10. pzbuk T6 (2-way half handicap ids 61/81 blessed as OTHER) — FIX: follow plan OQ1 and Group C. Set blessed:false on expected entries 15-17 and 132-134 and add an id-81 routing row pinning OTHER. This overrides S7a.
    — The plan's own default is binding; freezing them as blessed blocks the planned coverage follow-up.
    — Cost if wrong: none for prices (OTHER is the safe state).
11. pzbuk T7 (smoke A6 uses a ±8% relative band on decimal odds) — FIX: pass when |1/p - 1/median| <= 0.025 (implied probability) OR p is inside the peer [min, max]; update the constant, the test and the doc string.
    — A relative decimal band fails legitimate long shots, while a swap or a 10x leak is >= 100%.
    — Cost if wrong: a 2.5 pp mispricing slips past the smoke check.
12. betcris T7 (A4 ladder peer check covers only the 5 side-less totals) — FIX: extend A4 to the 10 side-scoped team ladders (HOME_/AWAY_TEAM_TOTAL_FOULS, _OFFSIDES, _THROW_INS, TEAM_TOTAL_SHOTS[_ON_TARGET] HOME:/AWAY:), with a per-side peer comparison that catches a Team1/Team2 swap.
    — A side swap is an integrity defect, and A3 catches it only when the rung sets differ.
    — Cost if wrong: an acceptance script that is slower or stricter.
13. observability T6 (an empty bookmaker's streak alert can be lost for the whole streak) — FIX: fire the streak alert at the first run where consecutiveFailures >= threshold and it has not fired yet for this streak (state reset on recovery), so a collapse-suppressed threshold run is retried on the next run.
    — Ops alerting must not go silent for a whole outage.
    — Cost if wrong: one late duplicate-looking alert.
14. observability T6 (ALERT_CONSECUTIVE_FAILURES NaN) — FIX: use the value only when it parses to a positive integer; otherwise fall back to 3 and warn once at startup.
    — A malformed env value silently disables all alerting.
    — Cost if wrong: none.

## Loops cut off by the usage limit (2026-11-07), adjudicated 2026-11-13

15. observability T6 — COMPLETE, no gaps. The review approved the task; its 3 cannotVerify items are a deferred live check (Task 11), a mutation table the reviewer checked by reading, and tsc excluding __tests__. No checker run.
    — Cost if wrong: a test-typing slip that only CI-less tsc would catch.
16. betcris T7 — COMPLETE. The only spec issue is the conflict between the dispatch note "no code -> no commit" and plan Step 4 "commit the evidence". The docs-only evidence commit 280df51 stays, because the plan mandates it and the dispatch note only meant to prevent empty commits. The cannotVerify items are deferred live checks (A2, A3/A4, A1 re-run after the merge).
    — Cost if wrong: one docs commit.
17. Resume incident: resuming wf_3175bae2-047 re-ran completed agents. The re-run "merge foundations" merged recovery/betby (T1-T7) into integration as 0d33bec before the betby T7 review; tests passed (1819/1819, tsc clean). No duplicate commits; the workflow was stopped and replaced by scraper-recovery-continue (wf_a262cc54-337).
18. observability T11 (A10 fixed market floors depend on the fixture calendar) — keep the fixed floors and add a timing rule (run 1-3 days before a round) plus a relative fallback (markets_saved vs same-hour dry-smoke marketsNormalized per saver) to the deferred acceptance list. No code.
    — A false regression on off-calendar days would send the owner chasing nothing.
    — Cost if wrong: the accounting check is weaker on off days.
19. fortuna T5 (commit 354ed31) was committed on 2026-11-07 just before the usage limit and never got a task review. It is reviewed as a task gate inside the fortuna final review.
20. fortuna-ekstraklasa.md (follow-up written by the T7 review: Fortuna lists no Ekstraklasa, stale tournament id) — implement it in the fortuna fix wave via a read-only live probe; change nothing if no verifiable id is found.
    — Ekstraklasa is a supported league and the fix is data-only.
    — Cost if wrong: a wrong id yields an empty Ekstraklasa listing, which fails closed (same as today).

## Final review: ruling objections and residuals (2026-11-13)

21. Ruling 4 objection (cross-cutting): after the Betby migration no normalizer emits the catalog's "X or BTTS-No"; etoto and superbet agree with each other (NEITHER), so what is left is a label/semantics mismatch, not a cross-bookmaker price mix. KEEP THE DROP.
    — The card label tells the user "X or not both score" (fair ~1.25) next to a NEITHER price (~2.0), which is a misleading price display (Rule 8).
    — Owner follow-up: fix the catalog wording (README item 34) plus sync, then restore the NO legs for etoto, superbet and forbet.
    — Cost if wrong: 3 legs per bookmaker missing until then.
12-bis. Ruling 5 objection (fuksiarz): accepted. The first option ("-" as a separator) was not applied, because it would let "D. Lewin" fit "Dominic Calvert-Lewin". The union-of-spellings variant was already in ef98d8e, and the Calvert-Lewin probe is now pinned by a test.
8-bis. Ruling 8 objection (betclic): refinement accepted. The regex excludes parentheses and a spaced " - ", so "Saint-Etienne" still maps. The same rule now covers the offsides and tackles resolvers.
11-bis. Ruling 11 objection (pzbuk A6): accepted. The peer [min, max] OR-clause was removed, because one swapped peer widened the range enough to pass a PZBuk swap. A6 is now the 0.025 implied-probability band only (d7951cf, merged as a65fddd/ddd21a9).
22. Residuals ACCEPTED or DEFERRED (no code):
    - fortuna: the shared team matcher maps "Wisła Kraków" to Cracovia and "Wisła K." to Wisła Płock; Wieczysta Kraków is missing from the canonical-teams roster. No effect today (ENABLED_LEAGUES = premier-league only); owner/data follow-up before enabling Ekstraklasa.
    - observability: 13/14 scrapers report an empty listing as success:false, so the run is scrape_failed, not empty. Per-bookmaker streak alerts fire, but the league collapse alert can only trigger for pzbuk. Follow-up: classify "no matches listed" as empty.
    - observability: the streak-alert state lives in memory and re-alerts after a restart (the accepted cost of ruling 13).
    - fuksiarz: template-order HWMG with a missing or zero "równo" price passes through (owner question).
    - betfan: a team-prefixed title with an unresolved team under the whole-match ids publishes on the whole-match code (latent, no evidence).
    - betclic: FIRST_OFFSIDE 2-way/3-way pool (owner); unanchored FOUL_RACE/MOST_SHOTS patterns (latent).
    - lvbet: RESULT_OR_HALF_TIME_TOTAL catalog template copy says AND, the label says OR (catalog copy, Group D).
    - totalbet: the period of slug-keyed line markets comes from the slug alone (by design; cheap follow-up).
    - test files: ~40 pre-existing type errors in 12 test files (tsconfig excludes tests).
    - sts: whether STS PLAYER_SHOTS is the same bet as the peers' (owner), and the Group E force-bless of #318/#521 (owner).
