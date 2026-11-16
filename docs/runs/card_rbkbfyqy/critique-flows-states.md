---
gaps:
  - severity: critical
    tag: state
    title: "No loading state between board mount and the first read"
    description: "Solution and D8 price the reads (100 ms parallel fleet fan-out, 280 ms per drawer blob) but no section says what renders while they are in flight. On mount, the band either does not exist yet or reads as an absence, which is precisely what the spec forbids ('none of them may render as nothing shipped'). The state checklist requires a per-component loading state, not a page-level one, and there is none for the band or for the drawer body."
    recommendation: "What do the board band and the drawer body render during the first 100 ms and 280 ms — a skeleton, a neutral 'reading releases' line, or nothing — and how is the empty-looking first paint prevented from reading as 'no releases'?"
    resolved: false

  - severity: critical
    tag: state
    title: "AC4 requires a fifth state that the state set does not name"
    description: "Acceptance criterion 4 requires that for ai-credits (changelog documents 0.4.1, newest tag v0.4.0) 'the row does not claim v0.4.0 is the newest documented work', while the scope table keeps untagged documented releases OUT. Solution names exactly four absence sentences — no repo, no tags, no notes for this release, unreadable — and 'the changelog knows a release the tag spine does not' is none of them. The requirement is therefore unsatisfiable with the stated row vocabulary, and no section says what that row says."
    recommendation: "Is notes-ahead a fifth named state with its own sentence on the summary line, and exactly what text does the ai-credits row render to satisfy AC4?"
    resolved: false

  - severity: critical
    tag: data
    title: "Fleet mode collapses the four states back into one count"
    description: "With no project selected the spec renders one line per project that has a release record 'plus a stated count of the projects that have none'. That count merges seven non-repos, one repo with zero tags (sessionmap) and any unreadable repo into a single number. In fleet mode the four sentences the Solution insists on collapse into the very 'nothing shipped' the spec calls a failure, and an unreadable repo — described as 'the only one that is a fault' — becomes invisible inside a quiet count. The D7 distinction survives only in project-selected mode."
    recommendation: "What does the fleet summary say when one of the 'none' projects is unreadable rather than simply empty, and is that fault surfaced at board top level as its own sentence?"
    resolved: false

  - severity: critical
    tag: flow
    title: "No rule for a superseded read when the project filter changes"
    description: "The read is async and nothing the spec names cancels it: the fleet fan-out is ~100 ms and the drawer blob ~280 ms, while the board's project filter can change at any moment. No section describes what happens when the response for the previously selected project lands after a new one is selected — the surface would render project A's releases under project B's header. A wrong-project release claim is the surface's own stated risk domain, not a cosmetic race."
    recommendation: "Does the call carry a cancellation or generation key, and what renders when a response for a superseded project arrives after the filter changed?"
    resolved: false

  - severity: important
    tag: flow
    title: "The unreadable state has a sentence but no recovery action"
    description: "D7 and AC7 define unreadable as a state and pin a test for it, but no flow says what the reader can do next; the state checklist requires a recovery path per state. The whole-call failure (the projectReleases RPC itself rejecting, as opposed to one repo failing inside a fail-soft fan-out) also has no defined UI, even though the spec promises fail-soft 'never to []' per project."
    recommendation: "What is the reader's recovery action for an unreadable project — retry, open the repo, nothing — and what renders if the whole call fails rather than one repo?"
    resolved: false

  - severity: important
    tag: flow
    title: "Drawer read granularity is undefined, so its partial state cannot be designed"
    description: "Solution says the takeaway is 'the changelog entry whose version matches a tag' and D8 prices 'a drawer read' at 280 ms, but nothing says whether the drawer parses one blob (the newest tag's copy, which shape 2.1 measured as covering the newest ten releases) or one `git show` per row. At per-row cost a five-row drawer is ~1.4 s and a partial state is mandatory; at one-blob cost it is a single 280 ms wait. Either way, whether rows appear with version and date before takeaways resolve is unstated."
    recommendation: "Does the drawer read one changelog blob or one per row, and do rows render with version and date while takeaways are still resolving?"
    resolved: false

  - severity: important
    tag: state
    title: "'No notes for this release' is listed as a project absence but is a per-row fact"
    description: "The four sentences mix scopes: no repo and no tags are project-level, but 'no notes for this release' is per-row, and it is the common case — 47% of the newest five releases per project have no prose paragraph, and 252 of 928 tags have no entry at all. The spec never says whether a takeaway-less row still renders, what occupies the takeaway slot, or whether the drawer states a per-row reason. If text-less rows are dropped, the drawer silently shows fewer than five rows."
    recommendation: "Does a row with no extractable text still render with version and date, what occupies the takeaway position in that row, and is a short drawer explained rather than silently shortened?"
    resolved: false

  - severity: important
    tag: data
    title: "The claimed stable order is not a total order"
    description: "D6 and the DoD require that no row changes position between renders, with date desc then version desc as the tie-break. Shape 2.10 records that compareReleaseTags compares the numeric triple only, so 0.84.1-alpha and 0.84.1 tie even as a tie-break. With 32 same-day groups here (one holding 35 releases) ties are the norm, so the comparator leaves the fifth/sixth boundary of the 'last five' window arbitrary — AC8 can pass (two sorts of the same array) while the window's membership is unstable."
    recommendation: "What is the final tie-break after date and version (tag name, commit date, tag creation order), and is the 'last five' cut itself required to be stable across renders?"
    resolved: false

  - severity: important
    tag: data
    title: "The undocumented-gap count has no defined scope"
    description: "D3 says 'the undocumented count is stated' and AC3 pins degustia's number at 7, but no section says what that count is computed over: the five rows in the drawer, the 30 tags the reader fetches, or the full tag history (repo-wide the figure is 252 of 928, and per project it differs from the five-row count). The number appears in both the summary line and the drawer, which are different scopes by construction."
    recommendation: "Is the undocumented count scoped to the shown window, the fetched 30 tags, or the full tag history, and does the summary line use the same scope as the drawer?"
    resolved: false

  - severity: important
    tag: flow
    title: "Fleet lines are a dead end with no route to the analytics behind them"
    description: "Unanswered question 4 settles the fleet variant as 'a plain line', no drawer. That leaves the fleet view — the Monitor surface a reader lands on with no project selected — with no next step: the reader learns which project shipped but must find the project filter to see the takeaways or the documented gap. The spec also does not say how a non-interactive fleet line is prevented from inheriting the clickable styling of the project-scoped line."
    recommendation: "Is a fleet line deliberately non-interactive with no path to that project's drawer, and which affordance distinguishes it from the clickable project-scoped line?"
    resolved: false

  - severity: minor
    tag: affordance
    title: "Interaction states for the summary line are undefined"
    description: "The summary line is the surface's only interactive element and the spec covers it with 'on demand' only: no hover, focus-visible, keyboard activation, aria-expanded, or the repo's min-h-11 touch target. The clamped takeaway (Q3) is a truncation with no stated affordance — no title, tooltip or expand — so overflow text is unreachable by any means the spec names."
    recommendation: "Which interaction states does the summary line carry, and how does a reader reach a takeaway that is clamped out of view?"
    resolved: false

  - severity: minor
    tag: state
    title: "No cue for how old the line is, and no refresh action"
    description: "There is no cache, but also no visible read time and no refresh affordance: a board left open shows whatever the last render fetched. A release line that could be hours old is the same class of claim as D1's stale checkout, only quieter — the reader cannot tell a quiet week from a tab that has not re-rendered."
    recommendation: "Does the surface show when the read happened or offer a refresh, and what tells the reader the line is not live?"
    resolved: false

  - severity: minor
    tag: state
    title: "A repo whose tags all fail the release filter will read as 'no tags'"
    description: "Filtering with parseReleaseTag is what removes archive/ and backup/ tags, and four of six repos carry such tags today. A repo whose every tag fails the filter yields zero spine rows but is not tagless; the spec's four sentences would have it render 'no tags', which misstates a repository that has tags and no releases."
    recommendation: "Does the zero-rows-after-filter case get its own sentence, or does it reuse 'no tags' and misstate the repo?"
    resolved: false

strengths:
  - "Absence was treated as a design object before any UI existed: four named sentences, a test that pins unreadable ≠ no releases, and an explicit ban on 'nothing shipped'."
  - "Every state claim in the Dangers table carries a measured trigger (three checkouts behind, 252 of 928 undocumented tags, 35 same-day releases), so the failure modes are falsifiable rather than rhetorical."
  - "Ordering was resolved against evidence, not intuition: the stelow v1.x line is the concrete case where version order would hide six weeks of releases."
  - "Read cost is measured per interaction (100 ms fleet, 280 ms blob, 0.92 ms parse), which gives the loading design real numbers to work against — the spec simply has not used them yet."
  - "The surface is read-only, so no destructive action and no rollback obligation is deferred or hidden; that part of the flow checklist is genuinely N/A rather than unfilled."

verdict: "has gaps"
---

# Critique — Flows & States

**Flow coverage:** 3/6 — the primary and fleet flows are named but not sequenced; concurrency, recovery and drawer-loading are missing; rollback is legitimately N/A for a read-only surface.

**State coverage:** 3/7 — populated and project-level empty/error are strong; loading, partial and the notes-level states are absent, and the aggregate surface erases the states the project surface spent a whole section defending.

The spec's own thesis is that a wrong claim is the product risk, and its state work is genuinely good at one level: the per-project absence vocabulary. What the review found is that the same discipline stops at three other levels. At the *row* level, a release can have no text and the spec never says what occupies that slot. At the *request* level, a 100–280 ms read has no in-flight appearance and no rule for a superseded response. At the *aggregate* level, the fleet count re-collapses no-repo, no-tags and unreadable into one number, which undoes D7 for the screen the reader sees first.

Two of the four critical gaps are not polish; they are contradictions inside the document. AC4 demands an honest row for notes-ahead-of-tags while the scope table removes the only entity that could carry it, and the DoD demands position stability from a comparator that the shape document itself says ties on prerelease suffixes. Both should be answered before the interface stage, because a screen cannot fix a data vocabulary that has no name for the case it is required to render.

One structural note for the approver: none of these depend on which band on the board wins (unanswered question 1). They hold for the strip, the tab and the panel view alike, so resolving the home does not clear them.
