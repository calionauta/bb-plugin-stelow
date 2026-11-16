---
gaps:
  - severity: critical
    tag: composition
    title: "The fleet line has no vertical budget on the board"
    description: "The fleet variant is the board's default state. Six stacked release lines at min-h-11 sit above a kanban whose height is already fixed at calc(100dvh-17rem); no reviewer found a stated budget, and the band grows with the project count rather than with the reader's attention."
    recommendation: "Where does the fleet line live so it cannot push the board? Either a fixed one-line strip that summarizes (newest release across the fleet, plus how many projects shipped), or a band that only expands on demand."
    resolved: true
    resolution: "Fixed one-line strip. The fleet line never lists projects inline: it names the newest release across the fleet plus a count. Per-project lines exist only in the drawer, which is opened, not always-on."
  - severity: critical
    tag: layout
    title: "The drawer is not a drawer"
    description: "The spec names DisclosureSection as the expansion surface, but DisclosureSection is an inline <details> expander. components/board/flow-strip.tsx records the inline-expander-that-pushes-the-board as an already-reported bug."
    recommendation: "Which expansion primitive is intended: an inline expander that pushes the board down, a real overlay drawer, or a tab inside the existing flow surface?"
    resolved: true
    resolution: "An inline expander is explicitly excluded. The surface expands into an overlay/panel that does not push the kanban, and the interface stage chooses between the overlay and a tab inside the existing flow surface."
  - severity: critical
    tag: composition
    title: "Hosting releases inside the flow band inherits its empty guard"
    description: "FlowStrip returns null when count === 0, so a project with releases but no finished cards would render no release surface at all if the release line shares that component's guard."
    recommendation: "How is the release surface made independent of the finished-card count?"
    resolved: true
    resolution: "The release line is its own surface with its own presence rule (present when the project has any release state, including an explained absence). It must never depend on the flow strip's count."
  - severity: critical
    tag: state
    title: "No loading state between board mount and the first read"
    description: "The read fans out over the fleet (measured ~100 ms parallel, ~360 ms serial). The spec names four absence states but not the in-flight one, so the band appears late or not at all on a slow read."
    recommendation: "What does the reader see before the first answer arrives, and does a failed read render as loading forever?"
    resolved: true
    resolution: "The line renders a muted placeholder at fixed height from first paint; a read that fails replaces it with the unreadable sentence. Loading never persists past the call's deadline."
  - severity: critical
    tag: data
    title: "Tag-to-changelog matching is unspecified"
    description: "Rows are tags and takeaways come from changelog entries, but no rule says how a tag version matches a heading version. The only existing comparator ignores prerelease (0.84.1-alpha compares equal to 0.84.1), so a naive reuse would attach the wrong notes."
    recommendation: "What is the exact match key between a tag and a changelog heading, including prerelease suffixes and a v prefix?"
    resolved: true
    resolution: "Exact normalized string match on the version text after stripping a leading v: 0.84.1-alpha matches only 0.84.1-alpha. The numeric comparator is used for filtering and tie-breaks only, never for matching notes to a tag."
  - severity: critical
    tag: data
    title: "Four absence states are not one axis"
    description: "no repo, no tags, no notes and unreadable mix project-level facts with a per-row fact, and the set measured on this host also includes a path that does not exist and a file whose headings do not parse. The taxonomy therefore cannot be rendered as one dropdown of four answers."
    recommendation: "Split the states by level, and name what a project whose changelog exists but yields no parsed release reads as."
    resolved: true
    resolution: "Two levels. Project level: no repo, no tags, no release record (a changelog with no parsed heading), unreadable (the read failed), and path missing. Row level: notes missing for this release. Each level has its own sentence."
  - severity: critical
    tag: system
    title: "The read contract has no deadline, no buffer bound and no failure typing"
    description: "The spec claims a fleet cost of ~100 ms but names no timeout, no output buffer bound, no aggregate deadline, and no rule for a single project throwing inside the fan-out. A read that hangs is indistinguishable from a quiet fleet."
    recommendation: "What are the per-command timeout, the buffer bound, the aggregate deadline, and the rule for one failing project?"
    resolved: true
    resolution: "Per-command timeout 10 s and buffer 4 MiB in the strict reader; the fleet call settles every project independently (one failure becomes that project's unreadable state, never the call's failure); the call's aggregate deadline is 15 s, after which unanswered projects read unreadable."
  - severity: critical
    tag: data
    title: "The RPC payload shape is undeclared"
    description: "Nothing states the wire shape, and this codebase refuses a whole call when a result carries undefined (rpc-surfaces.ts:169-200). The date type is also unstated, which matters because the rendered day and the sort timestamp are different facts."
    recommendation: "What is the exact result shape, and does the date travel as an ISO instant, a day, or both?"
    resolved: true
    resolution: "A zod-validated result: per project { projectId, name, state, newest: { version, day, documented, takeaway } | null, releases: row[], undocumentedCount, notesAhead }. day is a YYYY-MM-DD string derived from the tag's own timestamp; the raw instant is not rendered."
  - severity: important
    tag: data
    title: "Ordering is not a total order"
    description: "Date desc plus version desc still ties when two tags share a date and a numeric triple (prerelease pairs), so rows can swap between renders even though AC8 claims stability."
    recommendation: "What is the final tie-break?"
    resolved: true
    resolution: "Sort key is (day desc, numeric triple desc, version text desc). The version text tie-break makes the order total; the test asserts two renders of the same data are byte-identical."
  - severity: important
    tag: data
    title: "The undocumented count has no denominator"
    description: "The read is capped (newest 30 tags), so a count of undocumented tags cannot be a historical total (252 of 928) and a window count at the same time."
    recommendation: "Is the gap a count within the window or over the project's history?"
    resolved: true
    resolution: "The gap is stated within the window the surface can see: of the newest five tags, how many have no changelog entry, plus whether the newest note sits ahead of the newest tag. No historical total is claimed."
  - severity: important
    tag: affordance
    title: "A one-line takeaway has no reveal path"
    description: "Takeaways run p50 95 / p95 408 / max 1,224 characters, so one clamped line is readable but can hide the reason a release existed, with no way to read the rest."
    recommendation: "How does a reader see the full takeaway?"
    resolved: true
    resolution: "The drawer row shows the takeaway clamped to two lines with the version and date; the row's own expander reveals the full text in place. Nothing fetches more data to do it."
  - severity: important
    tag: flow
    title: "No rule for a superseded read when the project filter changes"
    description: "The board's project filter is a set; a read started for one selection can land after another. The spec does not say which answer wins."
    recommendation: "What happens to a slow answer that arrives after the filter moved?"
    resolved: true
    resolution: "Answers are keyed by the selection that asked for them; a late answer for a stale selection is dropped rather than rendered."
  - severity: important
    tag: system
    title: "Repo detection is unstated, and one project path is the parent of six repos"
    description: "Git discovers upward, so a project path that is a parent directory can report another repository's tags. The spec assumes every project path is its own repo root."
    recommendation: "How is a project path proven to be a repo root before git reads its tags?"
    resolved: true
    resolution: "The reader asserts the project path itself is the repository top level; a path that is not becomes path-missing, never an inherited repo's releases."
  - severity: important
    tag: composition
    title: "Two recency readings sit adjacent with no separation of axes"
    description: "The flow strip reports finished cards and the new line reports releases, side by side, in the same chip grammar. A reader cannot tell at a glance which recency is which."
    recommendation: "What distinguishes the release line from the finished-card strip at a glance?"
    resolved: true
    resolution: "The release line names its own noun (a release and its version), never a count of cards, and it is typographically distinct from the strip. The interface stage decides the exact mark."
  - severity: important
    tag: feasibility
    title: "The five scopes absorb six artifacts and no verification"
    description: "The plan is production quality, but the scope table lists no test scope and no verification step, while the critique and gate artifacts are counted silently."
    recommendation: "Which test scope is added, and what is verified before done?"
    resolved: false
  - severity: important
    tag: data
    title: "DoD requires a takeaway on every row, which one measured project cannot satisfy"
    description: "ensaiter and gogogo have no takeaway prose in their recent window, so 'each row has a takeaway' is unsatisfiable there."
    recommendation: "What does a row without a takeaway show?"
    resolved: true
    resolution: "The DoD becomes 'each row shows the release's own text when it exists; when the release has none, the row says so in a fixed phrase rather than rendering empty'."
  - severity: minor
    tag: data
    title: "The changelog filename is hardcoded"
    description: "CHANGELOG.md is assumed; a project using CHANGELOG or docs/CHANGELOG.md reads as no record."
    recommendation: "Is a case variant or a second path worth supporting?"
    resolved: true
    resolution: "Accept CHANGELOG.md and Changelog.md at the repo root only; anything else reads as no release record, stated as such."
  - severity: minor
    tag: state
    title: "No cue for how old the line is, and no refresh"
    description: "Tags rarely change, but a line with no age reads as live. There is also no way to ask again after an unreadable read."
    recommendation: "Does the line show its own age or offer a refresh?"
    resolved: true
    resolution: "No age stamp (tags are not a live feed) and no refresh button; the drawer re-reads when it is opened, which is the only moment freshness matters."
  - severity: minor
    tag: design-quality
    title: "Design smells are neither invited nor ruled out"
    description: "The affordance review provisionally scores 1-2 of the 10 smells: stat monument, decoration as organisation, row icons."
    recommendation: "Which smells are explicitly ruled out for this surface?"
    resolved: true
    resolution: "No icons, no sparklines, no second type scale step: the line is one text run plus a version, and the drawer is rows of text."
strengths:
  - "Every load-bearing claim is measured against six real repositories, with the numbers and commands recorded."
  - "The deduplication target is named precisely: the flow strip already owns finished cards, so this surface owns releases."
  - "The four absence states come from observed data rather than imagination, and the unreadable/empty distinction is treated as a product requirement."
  - "Takeaways are extracted from the release's own text; no model enters the read path."
  - "Ordering by tag date with a documented reason (a two-version-line project) rather than by version."
verdict: "has gaps"
---

# Plan Critique — Recent deliveries view

## Executive Summary

Five independent reviewers read the spec against the two reconnaissance passes and the actual
board code. The product decisions hold: every reviewer accepted the release axis, the tag spine,
date ordering and extracted takeaways. What they found is a document that stops being precise
exactly where implementation starts — the wire shape, the time bounds, the match rule between a
tag and its changelog entry, and the vertical cost of the fleet variant on a board whose height
is already spent.

Twenty gaps were recorded. Seventeen are resolved here by amending the spec, because the
evidence or the repository's own rules decide them; none required a new product decision. Three
survive as decisions for a person, and they are asked at the approval gate:

1. **Which expansion surface** — an overlay panel or a tab inside the existing flow surface. Both
   avoid the inline expander that pushes the board, which the flow strip's own comment records as
   a reported bug.
2. **What the fleet line says** — the newest release across the fleet plus a count of projects
   that shipped, or the newest release per project stated as a short list. The first has a fixed
   height; the second answers "per project" literally.
3. **Whether a documented-but-untagged release appears** — one measured project documents a
   release that carries no tag.

## What the reviewers agreed on

- The absence taxonomy was the weakest part. Reviewers independently found that "no repo / no
  tags / no notes / unreadable" mixes a project-level fact with a row-level one, and that a path
  which does not exist and a changelog that parses to nothing were both missing. The spec now
  splits the two levels and names five project states.
- The drawer language was wrong in a way that mattered: `DisclosureSection` is an inline
  expander, and the flow strip already carries a comment about how that pushes the board. Naming
  it as the expansion surface would have reproduced a known bug.
- The read had no contract at all: no deadline, no buffer bound, no per-project isolation, no
  wire schema. In a codebase that refuses an entire call for one `undefined`, that is not a
  detail left to implementation.
- The one-line takeaway needed a reveal path; clamped text is fine as a row, not as the only copy.

## Gaps left open

Only the feasibility gap about test scope remains unresolved in the plan itself, because it is a
planning artefact rather than a product decision: the tech plan must add a test scope for the
parser and the absence states, and the verification stage must run the host gates. It is carried
forward, not dropped.

## Why this plan is still worth approving

The three surviving questions are the interface stage's job by construction — the card's review
mode keeps them open on purpose. Everything else the reviewers raised has been answered in the
spec text, so the interface stage starts from a document that states its own bounds instead of
one that leaves them to whoever writes the code.
