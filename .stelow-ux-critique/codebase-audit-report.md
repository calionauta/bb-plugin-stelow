# Codebase UX Audit — Acceptance-tests radio-card group + frozen-acceptance row

**Scope:** `components/creation/creation-settings.tsx` (new 4th knob: `RED_FIRST_OPTIONS` + `CollapsibleChoiceCards` "Acceptance tests" mounted in `WorkflowSettings`), `components/detail/frozen-acceptance-row.tsx` (read-only mirror row), `components/detail/build-detail-hero.tsx` lines ~100–125 (mount point in `BuildHeroBelow`). Codebase mode — no browser run; rendered contrast, focus visibility, and screen-reader announcements marked `[needs browser]` where source alone cannot confirm.
**Interface type / audience:** Configure surface (creation prefs: Decide pattern) + Monitor mirror (frozen row beside the human receipt). Audience: board users from first-timer (Jordan) to keyboard/screen-reader user (Morgan).

## 1. 🎯 Executive Summary

The change reuses the existing `ChoiceCards`/`CollapsibleChoiceCards` renderer for the 4th knob instead of inventing a second option widget, and mounts the frozen row beside — never inside — the human receipt, which is the right one-row-per-fact composition. Naming, hint placement, `groupName` derivation, and sanitize-vocabulary handling all follow the Quality/Supervision/Exploration pattern exactly.

**Accessibility:** 3/4 — Real radio inputs with wrapping labels, `min-h-11` targets, and `focus-within`/`focus-visible` rings throughout; one real gap is the `labelHidden` fieldset rendering with no accessible group name when expanded.
**Design Quality:** 3/4 — Pattern consistency is excellent and AI-slop count is zero; deductions are for added cognitive load (a fifth paragraph clause + fourth decision point in one prefs block) and domain-jargon microcopy ("red proof, freeze and baseline") that the other three hints avoid.
**Overall:** 6/8 — Good; address the unnamed-fieldset and frozen-row semantics before public release. No finding blocks the UI change.

## 2. 🚨 Critical Issues (Blocking)

None found. No P0/WCAG-A failure was identified from source: every new radio is a native `<input type="radio">` inside a wrapping `<label>` with visible text (`creation-settings.tsx:154`), keyboard operation is native, the frozen row renders `null` (not a misleading empty state) when there is no freeze (`frozen-acceptance-row.tsx:57`), and no destructive action was added. The strongest candidate (unnamed expanded fieldset, §3.1) degrades group announcement but does not prevent task completion, so it is P1, not P0.

## 3. 🤔 Important Issues (Refinement)

- **Expanded knob group has no accessible name** `[accessibility]` (P1 Major)
  - **What:** `ChoiceCards` with `labelHidden` renders `<fieldset>` with no `<legend>` (`creation-settings.tsx:146-147`: `{labelHidden ? null : <legend>…}`). All four knobs mount via `CollapsibleChoiceCards`, which always passes `labelHidden` (`creation-settings.tsx:210`) — so every expanded knob, including the new "Acceptance tests" group, is a legend-less fieldset whose only nearby text is an unassociated `<p>` hint. (Pre-existing pattern, but the 4th card doubles the exposure and this audit scopes the new card.)
  - **Flagged by:** ARIA Labels & Roles (#2) + Form Labels & Errors (#7) in the a11y checklist; Nielsen #4 (Consistency and Standards — the collapsed `<button>` has a well-formed `aria-label`, the expanded group does not).
  - **Recommendation:** Render an `sr-only` legend instead of `null` when `labelHidden` (keeps the no-double-announcement intent while giving the group a programmatic name), or add `aria-label={label}` to the `<fieldset>`. Associate the hint with `aria-describedby`.

- **Frozen-row caption is a `<p>`, not a group label** `[accessibility]` (P2 Minor)
  - **What:** `FrozenAcceptanceRow` captions the badge list with `<p className={TEXT_META}>` (`frozen-acceptance-row.tsx:61-64`) and a bare `<ul className="flex flex-wrap gap-1.5">` with no `aria-label`. Heading/landmark scanners (Morgan) find "Card status" and the human receipt but not this mirror; the `freeze_sha … unpinned` fragment is also terse jargon for Jordan.
  - **Flagged by:** Semantic HTML (#5); Nielsen #6 (Recognition Rather Than Recall — the freeze identity is visible, good — but not navigable).
  - **Recommendation:** Wrap in a labelled group (`<section aria-label="Frozen technical acceptance">` or `aria-label` on the `<ul>`), and expand "unpinned" to "not pinned to a commit yet" for first-timers.

- **Stale banner uses `role="note"`, may never be announced** `[accessibility]` (P2 Minor)
  - **What:** `FrozenStaleBanner` renders the checkout-moved warning with `role="note"` (`frozen-acceptance-row.tsx:37-40`). `note` is a DPUB-ARIA role with uneven AT support; a dynamically appearing staleness warning is exactly what `role="status"` (polite live region) exists for. Nielsen #1 (Visibility of System Status) and #9 (Help Users Recognize, Diagnose, Recover) both apply: the recovery path ("Re-run verify to re-freeze") is present in text — good — but its announcement is unreliable.
  - **Flagged by:** ARIA Labels & Roles (#2); Nielsen #1/#9.
  - **Recommendation:** Change to `role="status"`. Keep the `title` detail as visible text or drop it (title-only content is mouse-only).

- **Badge detail lives in mouse-only `title` tooltips** `[design]` (P2 Minor)
  - **What:** Each badge `<li>` carries the `red_proof` evidence only in `title=` (`frozen-acceptance-row.tsx:77`); Taylor (touch) and keyboard users never see which proof pinned the badge. The visible badge itself is fine — glyph + text label means color is never the only signal (forced-colors-safe by construction).
  - **Flagged by:** Consistency #2 (the human receipt row exposes its evidence inline; the mirror hides it in a tooltip); Nielsen #6.
  - **Recommendation:** Render the short proof (or exit-code) as visible muted text under/within the badge, or move it to an always-visible `aria-describedby` detail element. `[needs browser]` to confirm tooltip absence on touch.

- **Fourth knob stretches an already-long prefs description; coupled defaults without enforcement** `[design]` (P2 Minor)
  - **What:** `WORKFLOW_PREFS_DESCRIPTION` grew a fifth clause mid-paragraph ("Acceptance tests decide whether scopes must prove themselves with a failing test…", `creation-settings.tsx:20-21`) and the section now holds 4 collapsible knobs + review gates. Cognitive-load check: decision points 3→4 in one block, and the section description is a 5-sentence wall. Separately, option copy couples modes across knobs ("Production default" / "Experimental default" in `RED_FIRST_OPTIONS`, lines 70-71) with no enforcement — Experimental quality + Strict acceptance is silently allowed.
  - **Flagged by:** Cognitive Load #2/#4 (Progressive Disclosure, Decision Points) + #5 in the 8-item checklist; Nielsen #8 (Aesthetic and Minimalist Design) and #5 (Error Prevention — the coupling is suggestive, not preventive).
  - **Recommendation:** Split the prefs description into per-knob hints only (the new `RED_FIRST_HINT` already carries the meaning) or shorten to one clause per knob; either drop the cross-knob "default" qualifiers or add a one-line consistency note when quality and acceptance modes disagree. Not blocking: collapsed-by-default keeps load Moderate (2–3 checklist failures).

- **Badge contrast unconfirmed from source** `[accessibility]` (P2 Minor) `[needs browser]`
  - **What:** `BADGE_TONE_CLASS` pairs `bg-red-500/15` with `text-red-700` (dark: `red-300`) and `bg-emerald-500/15` with `text-emerald-700`/`emerald-300` (`frozen-acceptance-row.tsx:26-30`); caption and badge descriptions use `text-muted-foreground` at `text-xs` (`TEXT_META = "text-xs text-muted-foreground"`). Translucent tinted backgrounds over unknown surfaces cannot be ratio-checked from source.
  - **Flagged by:** Color Contrast (#1); Color Scheme Adaptation (#11 — both light and dark variants exist, legibility unconfirmed).
  - **Recommendation:** Verify ≥4.5:1 for badge text and the `text-xs` muted caption in both color schemes in a browser; if the red/green tints fail, darken text or drop the tint to a border-only treatment (the glyph+label already carries the signal).

## 4. 🔎 Minor Clarifications

- **Reduced-motion handling of the card `transition`** `[accessibility]` (P3 Polish) `[needs browser]` — `ChoiceCards` labels and review rows use `transition` (`creation-settings.tsx:153,291`) with no `motion-reduce:` variant. The transition is a border-color fade (low vestibular risk), but checklist #9 asks for `prefers-reduced-motion` respect. Add `motion-reduce:transition-none` if the token setup supports it; confirm no layout animation in browser.
- **`groupName` leaks internal jargon, harmlessly** `[design]` (P3 Polish) — `${groupNamePrefix}-red-first` follows the existing `${prefix}-quality/-supervisor/-exploration` derivation exactly (good consistency); `red-first` never renders visibly (it is the radio `name`), while the user-facing label is the plain "Acceptance tests". No change needed; note for future renames only.
- **"red proof, freeze and baseline" is jargon next to plain-language siblings** `[design]` (P3 Polish) — Quality ("never ship as-is"), Supervision ("catches drift early"), and Exploration ("trivial changes only, by explicit choice") hints all speak outcomes; `RED_FIRST_HINT` ("Strict blocks scope close without red proof, freeze and baseline; advisory warns…") speaks mechanism. AI-slop verdict: **0 tells** — no gradient/generic-hue/glass/stat-monument/tile-grid/center-stack/bounce/default-type/nested-card offenders; the copy risk is terseness, not verbosity ("Redundant microcopy" #14 absent). Consider one outcome-first clause: "Strict means a scope cannot close until its failing test, freeze, and baseline exist."
- **Truncated summary relies on `title` for full text** `[design]` (P3 Polish) — the collapsed summary line uses `truncate` + `title={selected.description}` (`creation-settings.tsx:204`), consistent with the pre-existing knobs. Touch/keyboard users lose the overflow; acceptable at P3 given the full text reappears on expand.
- **Mount-point seam is honest but `unknown`-cast** `[design]` (P3 Polish) — `build-detail-hero.tsx:118-122` documents the Fase-4 seam in a comment and null-coalesces to `null` so the row renders nothing pre-gate. No UX impact; flagging only so the cast removal stays tracked when the server type gains the fields.

## 5. ✅ Strengths

- **Same renderer, same contract.** The 4th knob reuses `CollapsibleChoiceCards` → `ChoiceCards` with identical props shape (`label/hint/value/options/onChange/groupName`), identical `min-h-11` targets, identical selected/unselected border treatment, and vocabulary-validated sanitize (`sanitizeKnobPrefs` extended for `redFirst`, `creation-settings.tsx:232-234`). Pattern Consistency (2.3 #2) is exemplary — a new decision point with zero new interaction to learn.
- **Real inputs, real labels, real focus.** Native radio/checkbox inputs, wrapping `<label>`s, `accent-primary`, `focus-within` + `focus-visible` rings, and `aria-expanded`/`aria-label` on every disclosure button. Morgan gets a fully keyboard-operable surface; Taylor gets 44px targets including Select-all/Clear and preset buttons.
- **One row per fact.** The frozen mirror sits *beside* `AcceptanceRow`, never inside it (`build-detail-hero.tsx:107-122`), with a doc comment stating the distinction (human disposition vs. pipeline freeze). This is Nielsen #2 (Match Real World — a lock is not a receipt) made structural, and the "absent freeze renders nothing" rule avoids warning-fatigue (Nielsen #8).
- **Color is never the only signal.** Badges pair tone with glyph (`●` red / `🔒` frozen / `○` missing) and explicit text labels (`red: …`, `frozen 🔒: …`, `no red_proof: …`), satisfying Forced Colors (#10) by construction and surviving monochrome rendering.

## 6. [needs browser] Flag Summary (Codebase mode only)

1. Badge + `text-xs` muted caption contrast in light and dark schemes (§3, P2) — measure ratios at rest (≥4.5:1).
2. Badge tooltip content on touch/keyboard (§3, P2) — confirm `title` is unreachable; validate the inline-proof fix.
3. Card `transition` under `prefers-reduced-motion` (§4, P3) — confirm no perceptible animation; add `motion-reduce` variant if needed.
4. Screen-reader pass over collapsed → expanded knob (Morgan persona) — confirm group name announcement after the §3.1 fix, and `role="status"` announcement of the stale banner.
