---
dimension: composition
gaps:
  - severity: critical
    tag: composition
    title: "The fleet variant is the board's default state and has no vertical budget"
    description: >
      The spec leaves band choice to the interface stage but never constrains the fleet
      variant's density, and the fleet variant is what the board renders by default:
      `build-panel-view.tsx:357-361` passes a projectId only when exactly one project is
      filtered, so "no project selected" (and any multi-project filter) resolves to the
      fleet. "One line per project that has a release record" is 6 rows at today's
      measurements — 6 x `min-h-11` (44px, the repo's touch floor) = ~264px of new band —
      sitting above a kanban whose desktop height is a hard constant:
      `md:h-[clamp(20rem,calc(100dvh-17rem),48rem)]` (`build-panel-view.tsx:258`). On a
      900px-tall viewport the board has 628px today; 264px of release rows takes 42% of it
      and silently invalidates the 17rem constant tuned to today's bands.
    recommendation: >
      What is the fleet variant's maximum rendered height and its item shape — six stacked
      `min-h-11` rows, one wrapping line of project chips, or a single aggregate line plus
      a count — and which constant replaces `calc(100dvh-17rem)` when it is present?
    resolved: false
  - severity: critical
    tag: layout
    title: "\"Drawer\" is specified as `DisclosureSection`, the in-place expander the board already rejected"
    description: >
      Solution step 4 says the board line opens a "`DisclosureSection` drawer", but
      `DisclosureSection` is a `<details>` that expands in place inside its own container
      (`components/disclosure.tsx:109-155`); a drawer on this board is
      `ResponsiveDrawerShell side="right"` (`components/board/flow-strip.tsx:64-82`). The
      difference is not cosmetic: `flow-strip.tsx:26-38` records the board's own history —
      the flow surface used to be an accordion that expanded IN PLACE in the board column,
      pushing the board down on a scrolling surface, and the report was "a barra de flow ta
      em um lugar ruim tambem e qdo abre ta mal apresentada". A five-row release list
      expanded in place reproduces that failure one band lower.
    recommendation: >
      Is the five-release detail a right-side `ResponsiveDrawerShell` (matching the flow
      surface it will sit beside) or an in-place expansion, and if in place, what prevents
      it from pushing the kanban down on the same scrolling surface that was already
      reported broken?
    resolved: false
  - severity: critical
    tag: composition
    title: "Hosting releases in the flow band inherits `count === 0 → null` and makes releases unreachable"
    description: >
      Unanswered Q1 offers "a tab inside the flow drawer" and shape.md §5 records the cost
      without deciding it, but the spec states no constraint. `FlowStrip` returns `null`
      when there are no finished cards (`flow-strip.tsx:44`, documented in `FEATURES.md:2406`
      as "Empty boards render no strip"). So for any project with releases but no completed
      cards — a fresh project, or any project whose work lands as tags rather than cards —
      putting releases in that band or its drawer makes the newest release unreachable by
      construction. That is a placement rule, not an implementation detail.
    recommendation: >
      What is the stated constraint that the release surface must render independently of
      the flow strip's empty guard — i.e. may releases occupy the flow band only as a
      sibling that survives `count === 0`, and is a tab inside the flow drawer ruled out for
      that reason?
    resolved: false
  - severity: important
    tag: composition
    title: "The undocumented-gap fact has no stated home between the line and the drawer"
    description: >
      Acceptance criterion 3 requires that "when its summary renders, then the gap of 7
      undocumented tags is stated"; the board summary is specified as "one line naming that
      project's newest release — version and date". Three facts (version, date, gap count)
      on one line, times six rows in fleet mode, is a different density class than one. The
      spec never says whether the gap is a row-level fact, a drawer-only fact, or a
      fleet-level aggregate — and `card-information-hierarchy.test.mjs` exists because this
      repo treats "stated where convenient" as the failure.
    recommendation: >
      Which surface owns the undocumented count — the board line (making it a three-fact
      row), the drawer header, or a per-row flag inside the drawer — and does that choice
      survive the fleet variant repeating it six times?
    resolved: false
  - severity: important
    tag: design-quality
    title: "Two delivery-recency readings will sit adjacent with no stated separation"
    description: >
      The band the spec targets already carries "N finished · all time · lead typical X ·
      cycle typical Y" (`flow-strip.tsx:139`). Beside it, "newest release v0.87.0 · 20 Oct"
      is a second recency claim over a different source and a different timeframe: this
      repository today reads roughly "many finished this week" next to "last shipped 8 days
      ago (notes)". The spec's dedup rule (D9) forbids restating card counts but says
      nothing about how a reader is meant to tell that the two lines answer different
      questions rather than contradict each other.
    recommendation: >
      How do the two lines differ visually and verbally so the reader reads "cards finished"
      and "releases shipped" as two axes and not one aggregate disagreeing with itself —
      distinct label, distinct unit, own row, or explicit ordering with the release line
      subordinate?
    resolved: false
  - severity: important
    tag: layout
    title: "Band presence across board, list and hill views is unspecified"
    description: >
      `FlowStrip` is mounted in `BuildPanelView` (`build-panel-view.tsx:357`), above
      `BuildSurface`, so it renders in all three view modes. A six-row release band placed
      in that same slot would render above the list view, which is already a dense
      full-height card list, and above the hill view, which is a spatial canvas with its own
      layout assumptions. The spec says "the board" without saying whether that means the
      panel or the kanban view.
    recommendation: >
      Does the release band belong to the panel (all three views) or to the kanban view only,
      and if the panel, what does it look like above the list and hill views where the
      reader has explicitly chosen a non-board layout?
    resolved: false
  - severity: important
    tag: composition
    title: "No fleet ordering, so the band has no scan affordance"
    description: >
      The fleet variant is "one line per project that has a release record" with six rows and
      no stated order. The whole justification for the surface is staleness detection ("the
      operator ... reads git log by hand"), and a Monitor surface earns that by position: the
      row that shipped longest ago should be findable without reading all six. Sorting by
      newest-release date descending, alphabetical, or board project order produce three
      different reading experiences.
    recommendation: >
      What orders the fleet rows — newest release date descending (making staleness the first
      thing scanned), project name, or the board's existing project order — and does the
      chosen order put the project most likely to be forgotten at a known position?
    resolved: false
  - severity: minor
    tag: composition
    title: "The absence count is a fact about the project set, stated away from where the set is decided"
    description: >
      The spec puts "a stated count of the projects that have none" (8 of 14) in the release
      band. The project set is decided by the filter control (`build-control-strip.tsx:52`,
      `filterProjectIds`), and the count is meaningless without knowing which set is being
      counted — the 8 is true for all 14 projects and false for any filtered subset. The
      band would then carry a denominator it does not own.
    recommendation: >
      Does the absence count read as a property of the current filter ("2 of the 3 selected
      projects have no release record") stated on the filter's own affordance, or does the
      release band restate the denominator itself when the filter is narrowed?
    resolved: false
  - severity: minor
    tag: design-quality
    title: "On an empty board the release band is loudest exactly where the hero pitch lives"
    description: >
      `build-panel-view.tsx:346-348` renders `EmptyBuildState` — a dashed, centered
      "Start new issue" pitch — when there are no cards. `FlowStrip` disappears there by
      design. The release band would render its fullest form in exactly that state (fleet,
      six rows), so the newest product surface appears at maximum height beside the
      onboarding hero, competing with the one call to action that state exists to make.
    recommendation: >
      On a board with no cards, does the release band render at all, render collapsed to one
      line, or defer below the hero — and does that answer hold for the reader who has 14
      projects, six releases and no cards on this board yet?
    resolved: false
strengths:
  - "Names the right pattern for the job: a per-project newest release is a Monitor fact, and the plan's one-line summary is a scan line, not a dashboard of stat tiles."
  - "D9 is the correct deduplication instinct and it is stated as a hard constraint rather than a preference — the sibling surface (FlowStrip) already owns finished cards."
  - "The drawer carries depth and the line carries recency, which is the right split of sparse-overview / dense-on-demand for this band; the density strategy is at least named for the project-scoped case."
  - "Explicitly defers the band choice to the interface stage and writes down the one constraint that must survive that choice (never a second finished-cards list), instead of pre-empting a design decision it has no evidence for."
  - "Absence is specified as four distinct sentences rather than one empty list, which is the state vocabulary a fleet surface needs before placement can be judged at all."
verdict: "The plan has gaps"
---

# Composition critique — recent deliveries view

**Composition coverage:** 3/10 clean, 3 critical — the surface's *unit* (one line) is well chosen and its *band* is deliberately open, but the density consequence of the open band is never bounded, and the detail's shape contradicts the board's own recorded history.

**Overall verdict:** the plan has gaps.

## What holds

The plan picks the correct work pattern. A project's newest release is a vigilance fact, and the spec asks for one line rather than a widget: that is Monitor composition, not a stat monument. The one-line / drawer split is also the right density strategy for the project-scoped case, and the D9 constraint (releases never restate card counts) is the exact dedup rule `card-information-hierarchy.test.mjs` exists to enforce. Deferring the band to the interface stage is defensible — a spec that guessed would be guessing — but a deferred choice still has consequences the spec is responsible for bounding, and that is where these gaps are.

## Why the deferred band is still a spec problem

Three of the gaps are not design opinions, they are arithmetic and precedent.

The board's desktop height is a constant, `calc(100dvh - 17rem)` (`build-panel-view.tsx:258`), tuned to the bands that exist today. The *default* board state is the fleet variant (projectId is only non-null with exactly one project filtered), so the band's common form is six rows, and six touch-floor rows are ~264px. A spec that adds a band without saying how tall it may grow has not deferred a decision, it has deferred a constraint that will be discovered as "the board got short".

The second is the word "drawer". `DisclosureSection` is a `<details>` that expands in place; `flow-strip.tsx` carries a paragraph explaining that the flow surface *used* to do exactly that in this column and that it was reported as broken, which is why the detail moved to a right-side `ResponsiveDrawerShell`. A five-row release list in an inline expander is that bug, repeated. Either the spec means the drawer shell (and should say so, since the plan's own vocabulary for `DisclosureSection` is "section" everywhere else in this repo) or it means an in-place expansion and owes a reason why this band escapes the precedent.

The third is a door that closes: `FlowStrip` returns `null` at zero finished cards. If releases ride that band or its drawer — an option the spec lists — then a project with tags but no completed cards can never reach its own releases, which is the one project most likely to want the surface. That is a placement constraint precise enough to write down now, and the spec does not.

## The hierarchy question underneath

The surface's real risk is not crowding the kanban; it is joining a band that already makes a delivery claim. "12 finished · lead typical 2d" and "newest release v0.87.0 · 20 Oct" are different sources on different clocks, and in this repository they legitimately disagree — that disagreement is the whole reason the feature exists. Two lines of equal weight saying "we are busy" and "we have not shipped" read as a contradiction unless the composition separates the axes. The spec's dedup rule prevents a *duplicate*, not a *collision*, and only one of those two is written down.

The remaining gaps are the ordinary ones a deferred band creates: an ordering decision nobody owns, a gap count with three candidate homes, an absence count that carries a denominator it does not own, and a view-mode scope that `FlowStrip`'s mount position silently decides for it. None of them block; all of them are cheaper to answer before the interface stage draws the line than after.
