---
approved: true
approved_at: "2026-09-30T20:05:00Z"
approved_via: auto (Review Mode=Auto)
stage: int-gate
receiptId: interfaces/contrast.json#contrast-round-1
selected_by: llm
---

# Interface gate — approved (Review Mode = Auto)

`review_mode: Auto`, `review_gates: []`. Per the gate:1 mode table, `int-gate`
is **skipped, not parked**: no `visual_review` call, no human ask. The LLM
records the receipt and advances.

## What was accepted

The interface-contrast round-1 receipt, in full: the **on/off** primary value,
implemented by reusing the concept's declared single source
(`components/isolated-worktree-check.tsx`, `ISOLATED_WORKTREE_LABEL`).

## Why the evidence decided it

The contrast surfaced a **false clause in the approved scope map** — the claim
that `strategy-picker` was the only in-repo shape yielding WCAG 2.2 focus
appearance. The coordinator re-read both sources directly before accepting:
`creation-settings.tsx:91` (`ChoiceCards`) carries the identical focus
treatment *plus* `min-h-11` and `cursor-pointer`, and
`isolated-worktree-check.tsx` is a live exported single source for this exact
concept with an existing consumer and an existing running test pin. The map
was therefore **challenged, not edited** (`scope-map-challenge.json`,
`scope-boundary` / `repair-brief`), and the repair was applied to both the spec
and the map.

The choice strengthens under that correction: a **silent off state** makes the
unearned promise structurally impossible — nothing is claimed, so nothing can
be unearned — where a worded radio only makes it unlikely.

## Accepted sacrifices, named

1. The preset editor's control is a bare checkbox, not a grouped fieldset, so
   the off state carries no sentence and the AC 9 unrecognised-value case
   lives in help text alone. A fieldset could have shown "neither option
   selected" as a third visual state; this is the one criterion where a grouped
   control is strictly better.
2. A visible reference cycle: `isolated-worktree-check.tsx`'s help text points
   at Agent Presets, which would then render its own words.

Both are paid deliberately, to buy a control that cannot lie.

## Carried to selection, not closed here

Three `missingInputs` remain open, and closing the first is a human moment:

- **The decision-maker has never been shown that their own phrase "project
  checkout" is the unearned promise.** It is recorded in `state.md` and the
  spec, never confirmed back to them. This is why the selection below carries
  the reason its words changed, rather than presenting a silent re-labelling.
- No first-reader pass distinguishes a checkbox's silent off state from "not
  set up yet"; the contrast rests on structure, not observed comprehension.
- Whether the reference cycle is acceptable to the isolated-worktree module's
  author is unasked.

## Invalid option, recorded rather than dropped

`opt-1` — the decision-maker's literal *"Project checkout" / "Worktree"*
two-option radio — is recorded as **invalid as a reader-facing promise**, not
as unbuildable. Storage, the RPC enum and the form union all carry it. It is
the request's origin, and the reader deserves to see why its words changed
rather than to watch them change without explanation.

---

**Next stage:** selection. `interfaces/contrast.json` is the receipt this gate
approved; the selection stage owns which option is chosen.