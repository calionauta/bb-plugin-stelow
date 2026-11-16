---
gaps:
  - severity: critical
    tag: affordance
    title: "The trigger is named as the wrong component, and its expansion direction is the bug FlowStrip already had reported"
    description: >-
      The spec says the drawer opens 'on demand' but the shape document commits to a
      `DisclosureSection` with `startsOpen({live,blocking})`, and `DisclosureSection`
      (components/disclosure.tsx:109) is an INLINE `<details>` that grows in place, not a
      drawer. FlowStrip's own docstring records the exact consequence of that shape: the
      accordion 'pushed the board down and then covered it with a max-h-56 scroll box', which
      was reported as a bug and replaced by `ResponsiveDrawerShell side="right"`
      (flow-strip.tsx:26-38, 64-82). Nothing in the spec says which component is the trigger.
    recommendation: >-
      Which component is the release line — a `<button>` summary like `FlowSummaryHeader`
      opening `ResponsiveDrawerShell side="right"`, or an inline `DisclosureSection`? If the
      latter, what stops the board from being pushed down the way FlowStrip was, given
      `startsOpen` returns false for a settled list and the section therefore starts closed
      and expands inline?
    resolved: false

  - severity: critical
    tag: affordance
    title: "The one-line takeaway is the entire payload and there is no path to the rest of it"
    description: >-
      The takeaway is the reason the feature exists and every surface clamps it to one line.
      Measured across the six live changelogs at /home/deploy/repos (same heading rule as
      shape.md §2.4, prose-then-first-bullet selection): p50 95 chars, p95 408, max 1,224 over
      683 releases; inside the drawer's own newest-five window three of six projects run
      112-256 chars (bb-plugin-stelow 230/244/256/252/70, ensaiter 167/177/150/153/180,
      gogogo 134/145/136/138/112). At 360 px a clamped line holds roughly 30-50 chars once
      version and date are on it, so most rows, and this repo's entire newest five, are
      truncated. The drawer clamps too, so there is no place where the full sentence is
      readable. `title=` is not a touch affordance, and the repo's only truncate precedent
      (AttentionRow, flow-wait.tsx:139-155) truncates a short card name, not the payload.
    recommendation: >-
      What reveals the full takeaway — a tap/click expansion per row (at `min-h-11`), a
      two-line clamp in the drawer only, or a detail row? And does the summary line give the
      takeaway a guaranteed non-zero measure, or may version + date + a gap chip squeeze it as
      `inbox-row-layout` prevents in the Inbox?
    resolved: false

  - severity: critical
    tag: affordance
    title: "Fleet variant: up to six stacked targets with no stated measure, target size, or tab budget"
    description: >-
      With no project selected the surface becomes one row per project with a record (six
      today) and those rows are the only way into a project's drawer. Nothing states their
      target size, `cursor-pointer`, wrap behaviour, or measure. At the repo's `min-h-11`
      floor that is at least 264 px of stacked targets ahead of the board, each carrying
      version + date + a gap sentence + a takeaway in one line. This is the same squeeze the
      Inbox row shipped and had reported from a phone (`tests/inbox-row-layout.test.mjs:11-25`:
      content box ≈302 px, controls ≈226 px, text down to ~20 px).
    recommendation: >-
      Is each fleet row its own `min-h-11` target, or is there one control per row (a chevron)
      with the text as a label? What is the row's guaranteed text measure when the controls
      are `shrink-0`, and how many tab stops sit between the panel header and the first board
      card when six fleet rows are present?
    resolved: false

  - severity: important
    tag: affordance
    title: "No loading state for either read, and the FlowStrip precedent makes the band appear late"
    description: >-
      The board read is 30 ms per repo / 100 ms for the fleet; the drawer's changelog blob is
      280 ms per project and happens only on open (shape.md §2.6). FlowStrip returns null until
      its result arrives and when the count is zero (flow-strip.tsx:44), so copying its shape
      means the release band materialises above the board after the board has rendered — a
      layout shift in the exact place the reader is aiming — and the drawer's 280 ms has no
      per-row state at all. The checklist requires a per-component loading state, not only a
      page-level one.
    recommendation: >-
      While the fleet read lands, is the band a skeleton (the repo has `TrackSkeleton`), a
      reserved-height placeholder, or absent? Inside the drawer, what does a row show during
      the 280 ms per-project read, and does the trigger disable while the read is in flight —
      and if it does, what is the stated reason?
    resolved: false

  - severity: important
    tag: affordance
    title: "The four absence states are named as sentences, not as affordances"
    description: >-
      `no repo`, `no tags`, `no notes for this release`, `unreadable` are four sentences
      (spec §Solution) and `unreadable` is declared 'the only one that is a fault', but the
      spec does not say which is interactive, which is plain text, which gets a tone, and what
      recovers the fault. A row that is clickable and opens a drawer containing the same
      sentence is a dead end with no exit.
    recommendation: >-
      For each of the four states: plain text, a disabled control with a stated reason, or an
      active row? And for `unreadable`, is there an in-place retry (as
      `board-cards.tsx:52` 'Retry the worker in place' does) or does recovery mean reloading
      the whole panel?
    resolved: false

  - severity: important
    tag: affordance
    title: "The 'projects with none' count is a number with no way to inspect it"
    description: >-
      The fleet line 'states how many projects have none' — eight of fourteen today. The
      reader cannot tell from that number whether those eight have no repo, no tags, or could
      not be read, which is the distinction the spec's own risk domain (D7) says is the whole
      point. The count carries no affordance and no state kind.
    recommendation: >-
      Is the count a control that expands the eight with their state kind, or plain text? If
      plain text, how does a reader distinguish 'eight projects have no releases' from 'eight
      projects could not be read' without opening each one?
    resolved: false

  - severity: important
    tag: design-quality
    title: "Two strips in the same chip grammar, one of them about cards"
    description: >-
      FlowStrip renders `text-xs` muted spans — 'N finished · preset · lead typical … · cycle
      typical …' — inside `rounded-md border bg-muted/20 px-3 py-2` (flow-strip.tsx:54, 129-163).
      The spec puts the release line 'in the strip band that already holds FlowStrip' with a
      version, a date and counts, in the same `text-xs` vocabulary. Nothing states what
      distinguishes a release strip from a finished-card strip at a glance, which is D9
      arriving through visual grammar rather than through data.
    recommendation: >-
      What tells the reader in one glance which line is releases and which is cards — a
      distinct label word, a tone, an icon, or position? If it is a tone or colour, which one
      from the existing vocabulary, given `SECTION_SURFACE`'s rule that what differs is tone
      and never a new border?
    resolved: false

  - severity: important
    tag: design-quality
    title: "No enforced test would cover the new surface's rules"
    description: >-
      AGENTS.md states that a UI rule with no test is not a rule. `card-surface-consistency`
      checks a hardcoded `SECTION_FILES` allowlist (tests/card-surface-consistency.test.mjs:43-53)
      that a new `components/board/release-*.tsx` would not appear in; `min-h-11` is the rule
      that section explicitly says it cannot keep (82 raw buttons standing evidence). The spec
      commits to `SECTION_SURFACE`, `DisclosureSection` and `startsOpen` in prose only, so the
      first implementation can drift from all three and stay green.
    recommendation: >-
      Which test asserts the new surface — closed by default, one surface token, `min-h-11` +
      `cursor-pointer` + `focus-visible` on every target, `line-clamp-*` never beside `block`?
      If no test is planned, which of those rules is being dropped for this feature rather than
      silently assumed?
    resolved: false

  - severity: important
    tag: affordance
    title: "Keyboard and screen-reader contract unstated for the trigger, the drawer and focus return"
    description: >-
      `FlowSummaryHeader` sets `aria-expanded`, a full-content `aria-label` and a `title`
      (flow-strip.tsx:141-147) precisely because a line of facts is not self-describing;
      `SUMMARY_ROW` supplies `focus-visible:outline` (disclosure.tsx:45-52). The spec names
      none of these, nor Escape, nor where focus lands after the drawer closes, nor what a
      screen reader announces for a row whose only description is a visually clamped takeaway.
    recommendation: >-
      What is the trigger's `aria-expanded` and `aria-label`; do Enter and Space both open it;
      does focus return to the trigger on close; and what is the announced text for a row whose
      takeaway is truncated to ~30 characters on screen?
    resolved: false

  - severity: minor
    tag: affordance
    title: "Hover feedback on a whole-line target is unspecified, and the shared family carries none"
    description: >-
      `SUMMARY_ROW` and `SUMMARY_LINK` carry focus-visible but no hover background
      (disclosure.tsx:52-60); `AttentionRow` adds `hover:bg-muted/60` to the same shape
      (flow-wait.tsx:143). A line made of five facts needs to say it is pressable before the
      pointer lands, not only once focus arrives.
    recommendation: >-
      Which hover treatment does the release line take — the shared family's (none) or
      AttentionRow's muted background — and is the whole line the target or only the chevron?
    resolved: false

  - severity: minor
    tag: design-quality
    title: "Version typography risks a second state line"
    description: >-
      `lib/design-tokens.ts` documents `TEXT_STATE` as 'Exactly one per screen' and records
      that the card's original complaint was a state line drowned by adjacent emphasis. A
      release version plus date is the natural place for a large figure, and the version is
      the fact the reader came for.
    recommendation: >-
      Which step renders the version — `TEXT_META` alongside the date, `TEXT_SECTION`, or a
      state-sized number — and if it is state-sized, what does that do to 'exactly one per
      screen'?
    resolved: false

  - severity: minor
    tag: design-quality
    title: "Three of the ten smells are invited by the current wording and none are ruled out"
    description: >-
      Audited against the anti-pattern list: gradient, glassmorphism, decorative motion and
      default typography are neither described nor implied at spec level (5 of 10 not
      applicable), but three are invited — (a) stat monument, because 'one line naming that
      project's newest release' reads as a large version figure; (b) decoration as
      organisation, because per-project accent rails or badges on fleet rows would fake the
      grouping a list already gives; (c) icons as filler, because a per-row tag or rocket
      glyph is the default move. Provisional score 1-2 (mostly clean) if the interface stage
      rules them out, 3-4 if any survives.
    recommendation: >-
      Does the surface rule out an oversized version figure, a per-project accent colour, and
      an icon on every release row — or is one of them intended, and if so what does it encode
      that the text does not?
    resolved: false

  - severity: important
    tag: composition
    title: "The band's vertical cost on a 360 px board is unmeasured"
    description: >-
      The panel already stacks `BuildHeader`, `GithubAuthNotice`, `BuildControlStrip`, the
      swipe hint, then `FlowStrip` before the first board column
      (build-panel-view.tsx:338-364). The spec adds one more band plus, in the fleet case, up
      to six rows, and states no budget. Which band it occupies is deliberately the interface
      stage's call; how much room the board loses to it is not, because the board is the
      surface the operator came for.
    recommendation: >-
      What is the vertical distance from panel top to the first board card at 360 px with six
      fleet rows present, and what is the ceiling that band may consume before the board is
      pushed below the fold?
    resolved: false

strengths:
  - "The takeaway's provenance is a rule, not a hope: extracted from the release's own text or absent, never generated — so the one line cannot become model-written sludge."
  - "Four absence states are enumerated with distinct sentences instead of one 'nothing here', which is state work most specs skip entirely."
  - "Closed-by-default is stated against the repo's own rule (`startsOpen`) rather than invented, so the section cannot claim to be live or blocking."
  - "Stable ordering (tag date, version as tie-break) removes the row-swap flicker that makes a list feel machine-made, and it is backed by a measured count of same-day ties."
  - "Row-level honesty (a tag newer than its documentation is shown as a gap, never hidden) gives the surface a story its numbers tell, which is what keeps it from being a stat strip."

verdict: "The plan has gaps"
---

## Executive summary

**Affordance coverage:** 3/8 — the surface has a stated *shape* (one line, a drawer) but no interaction inventory: no trigger component, no hover/focus/pressed/loading/disabled coverage, no target size, no rule for the four absence states as controls, no keyboard contract.

**State coverage (interaction):** ~2 of 9 applicable — idle and (by inheritance from `SUMMARY_ROW`) focus are implied; hover, active, loading, disabled, overflow-with-reveal are absent, and the loading one matters because there are two asynchronous reads with different latencies.

**Design-quality (10 smells):** provisional 1–2 present (stat monument via an oversized version; decoration-as-organisation via per-project accent rails), both avoidable — but unscoreable until the interface stage says whether either is intended.

**Composition:** the board is a Monitor surface and the plan adds a fourth stacked band to it without a vertical budget; the band *position* is correctly deferred, the cost is not.

**Verdict:** has gaps. Two are blocking because they are the feature's payload: the trigger is named as a component that contradicts the drawer, and the takeaway is clamped everywhere with no reveal.

## The measurement that reframes the truncation question

The spec's own open question 3 treats "one line" as settled by an average of 69 characters. I re-measured the takeaway as the spec defines it — the indented prose paragraph under a release heading, else the first bullet — across the six changelogs on this host, using the heading rule from shape.md §2.4:

| scope | p50 | p90 | p95 | max |
|---|---|---|---|---|
| all 683 parsed releases | 95 | 252 | 408 | 1,224 |
| drawer window (newest five, per project) | — | — | — | 256 (bb-plugin-stelow), 180 (ensaiter), 145 (gogogo) |

Inside the exact window the drawer shows, three of six projects have takeaways of 112–256 characters, and this repository's newest five are 230, 244, 256, 252, 70. A single clamped line at 360 px carries roughly 30–50 of those characters once version and date sit on the same row. So the spec's density question is not "one line or two" — it is "where does the sentence live at all", and today the answer is nowhere: the summary clamps it and the drawer clamps it identically.

That also makes the truncation rule a repo-rules question, not a taste question. `inbox-row-layout` exists because a row's controls were allowed to squeeze its text to ~20 px on a phone; the fleet variant puts version, date, a gap sentence, a takeaway and a chevron into one line with no stated measure, which is the same shape one level up.

## On the deferred band

Respecting the constraint: I am not asking which band. The spec is right to leave that to the interface stage. What is missing is the consequence that must be stated whichever band wins — the vertical cost to the board and the loading behaviour, since a band that arrives late above the board is a shift in the reader's aim regardless of where it sits.

## What is genuinely strong

The absence work is the best part of this spec. Four sentences where most plans ship one, plus an explicit statement that an unreadable repository is the only fault. That is the difference between a surface that can be trusted and one that says "nothing shipped" with confidence it has not earned — and it is why the remaining gaps are all about the *controls* rather than the *claims*. The data story is honest, the ordering is stable, and the takeaway is extracted rather than invented. What the surface lacks is an interaction inventory for the reader who has to operate it.
