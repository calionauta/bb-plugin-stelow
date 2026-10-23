# SCOPE-2 · S4 record — the timeline applies the stage policies

**Scope:** SCOPE-2 of the repair plan, item S4, as corrected by
`2026-10-23-premise-recheck.md`.
**Date:** 2026-10-23
**Branch:** `fix/timeline-stage-skips-2026-10-23` (from `origin/master`).
**Status:** done.

## 1. What was wrong

`skippedStages` knew two ways a stage does not run: the review rung
(`MODE_SKIPS`) and the review gates. The third — `routes.stage_policies` — was
read only by the move path (`workflow-moves.mjs`). So `context` could never be
painted skipped in the timeline: its exclusion lives in a policy
(`context-spike`, `when.review_mode: [Auto]`, `any_of: {quality: [experimental],
exploration_count: [1]}`), and the timeline never asked. The panel offered a
stage `bb stelow advance context` refuses for that same card.

## 2. The fix

`lib/stage-skips.mjs` gains `timelineSkips`, which maps the detail's own
stage-skips block onto `skippedStages` plus the two knobs; `skippedStages` now
appends policy skips with their own reason: *"the card's run policy excludes it
(quality / exploration count)"*. The wording is deliberately distinct from the
review-mode reason — "no approver in this rung" and "this run does not do that
work" are different facts, and collapsing them leaves the timeline unable to
explain a skip.

`card-detail-presentation.ts` calls `timelineSkips` with the object it already
had; no new field crossed a boundary.

**Red proof.** With the policy call removed:
`AssertionError: context is painted skipped for a spike policy`.

## 3. Verification

| Command | Exit |
|---|---|
| `node tests/stage-skips.test.mjs` | 0 |
| `npm run typecheck` | 0 |
| `npm run quality:shape` | 0 (39 inherited lint findings, none new) |
| `npm test` | 0 |

## 4. Two budgets that caught real sloppiness

- **`.d.mts` drift:** the hand-written declaration for `stage-skips.mjs` did not
  learn the two new options, and `typecheck` refused the call. That is SCOPE-8's
  debt surfacing as a compile error instead of a silent `any`.
- **`quality:shape` refused twice:** a 52-line `assembleDetail` (budget 50) and a
  412-line file against a 398 baseline. The fix was to move the assembly next to
  the consumer in `lib/`, not to compress the caller.

## 5. Non-claims

Only `context` has a policy today, so the visible change is one stage on one
configuration. The guard is that the timeline can no longer silently disagree
with the helper when a policy is added later.
