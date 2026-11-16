---
gaps:
  - severity: critical
    tag: data
    title: "The RPC payload has no declared shape, and the four absence states are not one axis"
    description: >-
      The spec's third IN scope is "one read call answering one project or the fleet", but it
      never states the response shape, and the four states it does name mix two levels:
      `no notes for this release` is a per-row fact while `no repo`, `no tags` and `unreadable`
      are per-project. Worse, `no repo` has three distinct causes on this host, verified: a
      project with no source (`projectRoot` returns null), a path that exists but is not a git
      repo (7 projects today: Stelow exploratory work, jogo da velha, stelow-e2e-guards,
      repos, e2e-diagram-probe, daisyui-mcp, experimental-jogo-velha — measured with
      `git -C <path> rev-parse --show-toplevel`), and a path that *is* inside some other repo,
      where `git -C` walks up and would report a parent's tags as this project's releases.
      A fourth case is unnamed: a repo whose tags all fail `parseReleaseTag` (only `archive/*`
      today) would read `no tags` while it has tags. Without a declared shape the Interface
      stage, the handler and the tests will each invent one, which is what this gate exists
      to prevent.
    recommendation: >-
      Publish the `projectReleases` output contract (per-project state enum with precedence,
      plus the row shape) in this spec: where does a row-level "no notes" live, how is
      "not a repo" proven (and does that proof cost a third git command, contradicting
      "two commands per repo"), and what sentence does a repo with only non-release tags get?
    resolved: false

  - severity: important
    tag: feasibility
    title: "The summary's undocumented-gap count contradicts the drawer-only blob read"
    description: >-
      D8 and alternative E justify the separate RPC by "changelog blobs read only when the
      drawer opens", which prices the fleet read at the 100 ms tag fan-out. But DoD item 4 and
      AC3 require the *summary* to state the gap between tags and documented releases, and a
      release row carries "whether the changelog documents it" — both need the blob, per
      project, on the board's default (no-filter) state. Measured now: the six newest-tag
      blobs total 876,663 characters, 78 ms serial / 57 ms parallel, against 54 ms for the six
      tag reads — so the fleet summary is roughly 3x the stated cost and ~0.9 MB per render,
      repeated on `useDebouncedRealtime` for `card-state`, `board-changed` and `inbox-changed`
      with "no cache in v1" (scope 3).
    recommendation: >-
      Which is true — the summary computes `documented`/the gap (so the fleet read reads six
      blobs on every board refresh, and scope 3 needs a cache or a lazy variant), or the gap
      is drawer-only (so DoD 4 and AC3 must be rewritten)? State the fleet read's real cost
      with the blob included.
    resolved: false

  - severity: important
    tag: feasibility
    title: "Fleet mode ignores the board's real project selector, which is a set"
    description: >-
      The board has two project scopes: the panel's `projectId` and the board filter
      `state.projectIds`, and `BuildPanelView` passes the filter to `FlowStrip` as
      `projectIds.length === 1 ? projectIds[0] : null` (components/panels/build-panel-view.tsx:359).
      So the common states are zero selected and two-or-more selected, and both become `null`.
      The spec's `{ projectId: string | null }` therefore turns a two-project filter into all
      fourteen projects, and its core flow ("with a project selected") does not say which of
      the two selectors it means. `loadBoard` refuses outright when the panel project is null
      (server/runtime/board-read.ts:346-357), so the fleet variant is a new behaviour, not an
      existing one.
    recommendation: >-
      Does the RPC take the filter set (`projectIds: string[]`) rather than one id or null, and
      does a two-project filter show those two projects, or the whole fleet? Which selector is
      "the selected project" for the summary line?
    resolved: false

  - severity: important
    tag: feasibility
    title: "Version-to-changelog matching is undefined, and `parseReleaseTag` cannot be the key"
    description: >-
      The enrichment is "the changelog entry whose version matches a tag", but the match rule is
      not stated, and the reused helper cannot supply it: `parseReleaseTag` returns a numeric
      triple and discards the suffix (lib/github-release.mjs:16-24), so `v0.26.0` and
      `v0.26.0-alpha` produce the same key. Both pairs exist on this host — stelow
      (`v0.26.0`/`v0.26.0-alpha`, `v0.2.3`/`v0.2.3-alpha`) and ensaiter
      (`v0.30.0`/`v0.30.0-alpha`, `v0.5.0`/`v0.5.0-alpha`) — and `compareReleaseTags` returns 0
      for those pairs, so the declared "version desc" tie-break is not a total order over the
      domain. The notes-misattribution is latent today (all four pairs are deep history), but
      the tag pattern that produces it (prerelease then final on one triple) is the repo's own.
    recommendation: >-
      What is the match key — the tag string with a `v`/`no-v` normalisation, or the triple — and
      what breaks the tie when `compareReleaseTags` returns 0 for two distinct tags, given AC8
      promises identical order on two renders?
    resolved: false

  - severity: important
    tag: data
    title: "The displayed date is ambiguous where the tag and the notes disagree"
    description: >-
      The plan shows "version and date" and sorts by tag date, but two of the six newest windows
      already carry a one-day disagreement between the tag's creatordate and the changelog
      heading's own date: bb-plugin-stelow `v0.98.2` (tag 2026-10-27, notes 2026-10-28) and
      ai-credits `v0.4.0` (tag 2026-08-28, notes 2026-08-29). The spec's risk domain is "a
      confident wrong claim", and its own evidence says the two sources disagree on five of six
      projects in the tag-vs-documented axis; the date is a second such axis.
    recommendation: >-
      Which date is a row's date, and when the tag and the notes disagree about the day, is the
      disagreement shown, hidden, or promoted to a fifth state? (A drawn date that contradicts
      the release's own heading is the failure mode this spec is written against.)
    resolved: false

  - severity: important
    tag: feasibility
    title: "The 5-scope split silently absorbs six artifacts and no verification for a `production` plan"
    description: >-
      Scope 3 is "one read call" but a new RPC in this repo also needs a contract fragment entry
      with a <=120-char `experimental_description`, a strict zod input and a JSON-safe zod output
      (the `board` entry at server/card-rpc-contract.ts:18-33 is the template; undefined values
      are refused by the host, per rpc-surfaces.ts:168-172), plus the client-side method type
      (`FlowRpc` in components/board/flow-types.ts is hand-written). Scope 4 adds a component
      whose test file must be wired into package.json or `suite-wiring.test.mjs` fails the suite.
      And with `quality: production`, the only test the plan names is one node test on the pure
      module: AGENTS.md requires a test for every UI rule in the same commit, and
      `card-design-tokens` / `card-surface-consistency` / `rendered-ui` all apply to a new board
      surface (the type-size ceiling only ratchets down — a new `text-[11px]` site fails).
    recommendation: >-
      Are the contract entry, client type, test-suite wiring and UI-rule tests inside scopes 3
      and 4, or do they need their own scope? And what is the verification this plan claims for
      `production` beyond one lib node test?
    resolved: false

  - severity: important
    tag: data
    title: "DoD 'each row has a takeaway' is unsatisfiable for one of the six measured projects"
    description: >-
      DoD item 3 says the drawer lists the last five releases "each with a takeaway taken from
      the release's own text". degustia's changelog stops at 0.2.1 while its newest tags reach
      v0.7.0: measured at the newest tag, 3 of its newest 10 tags have an entry and 0 of its
      newest five do. So the first full drawer this feature ever opens shows five rows with no
      takeaway — which is the honest outcome the spec's own D3 describes, but the DoD sentence
      forbids it.
    recommendation: >-
      Does DoD 3 become "a takeaway when the release has one, and a stated absence when it does
      not", or is there a fallback source for a release whose notes do not exist anywhere?
    resolved: false

  - severity: minor
    tag: feasibility
    title: "Scope 4 calls `DisclosureSection` a drawer; the board's drawer is a different primitive"
    description: >-
      Scope 4 says "opening a `DisclosureSection` drawer", and the shape doc calls
      `SECTION_SURFACE` / `DisclosureSection` "the only legal shapes". `DisclosureSection` is an
      inline `<details>`-based card section (components/disclosure.tsx:109+), and the
      `card-surface-consistency` test scans the open-card section files only
      (tests/card-surface-consistency.test.mjs:47-57) — it says nothing about the board. The
      adjacent board surface, `FlowStrip`, opens a `ResponsiveDrawerShell` side drawer
      (components/board/flow-strip.tsx:56-77), and `tests/flow-drawer.test.mjs` pins that
      behaviour. The two sit on different interaction models (accordion vs mobile-aware drawer).
    recommendation: >-
      Which primitive does the release detail use — an inline `DisclosureSection`, or the board's
      `ResponsiveDrawerShell` — and which test file gains it? The claim that one is "the only
      legal shape" should be corrected either way.
    resolved: false

  - severity: minor
    tag: data
    title: "The same-day tie figure does not reproduce"
    description: >-
      The spec (copied from shape) says "thirty-two groups of same-day releases exist in this
      repository" and "one date carries 35 releases". Measured at HEAD with 414 tags: 40 groups
      with more than one tag, max 37, on 2026-09-15; restricting to tags that parse gives 40 and
      36. The argument (same-day ties are the norm, not an edge case) survives and is stronger,
      but the specific numbers and the date are not reproducible, and this is the one number a
      later reader will try to check.
    recommendation: >-
      Re-measure and restate the figure with the command and the date-slicing rule used
      (creatordate vs ISO offset moves tags across day boundaries), or drop the number and keep
      the shape-level claim.
    resolved: false

  - severity: minor
    tag: feasibility
    title: "No relative effort ordering between scopes, so `Lean / fits` rests only on milliseconds"
    description: >-
      The scope table gives each IN scope an outcome and a trade-off but never compares the
      scopes to each other, which is what the feasibility checklist asks for ("scope A is more
      complex than scope B because..."). It also does not name the repo's shape budgets that
      decide how the pure module must be split (400 lines per file, 50 per function, 160 per
      line — scripts/check-source-budgets.mjs, scripts/check-source-shape.mjs). `fits` is
      therefore asserted from runtime measurements, not from the ordering a reviewer can
      challenge.
    recommendation: >-
      Which scope is the most complex, and which is least, and by what comparison? And does the
      parser/selector/summary split fit one 400-line module with 50-line functions, or is it two?
    resolved: false

  - severity: minor
    tag: feasibility
    title: "`projectRoot` resolves every project today but drops the source's host"
    description: >-
      Verified: all 14 projects have exactly one `isDefault` local source, so `projectRoot`
      (server/runtime/root-paths.ts:36-49) resolves every path the plan needs, and no new
      plumbing is required for paths. But the helper returns `sources[].path` and discards
      `hostId`, which the host model carries on every source. A project whose default source
      moved to another host would return a path that does not exist locally and render as
      `no repo` — a wrong sentence under the spec's own rule that no state may read as "nothing
      shipped".
    recommendation: >-
      Is "source on another host" inside the four states, and does the reader compare the
      source's `hostId` against the local host before running git — or is that a documented
      wrong sentence until remote projects exist?
    resolved: false

strengths:
  - "The tag-scoped read is justified against measured evidence, not preference: 3 of 6 checkouts are behind their tags (67, 17 and 74 commits measured today), and the claim that no ref-scoped SDK read exists is correct — `FileReadArgs` has no `ref`, and `projects.fileContent` accepts only `{ path }`."
  - "Splitting a strict reader from the fail-soft `runGitIn` preserves five existing card surfaces instead of changing their contract, and the alternative is priced (git-evidence.ts:61-79)."
  - "Reuse of `parseReleaseTag` for filtering and the documented ceiling of `compareReleaseTags` (triple only, prerelease ties) is honest about what the shared helper cannot do, rather than re-deriving semver in a second module."
  - "The absence model, the 'release vs finished card' axis, and the OUT list (GitHub API, persistence, drilldown, CLI verb) are all grounded in numbers from this host rather than in taste."
  - "The per-project path plumbing the plan relies on is real: `projectRoot` is the shared locator, all 14 projects resolve, and running a subprocess at a project root already has precedent (`advanceStage`, `seedWorkflow`)."

verdict: "The plan has gaps"
---

# Feasibility critique — recent deliveries view

**Feasibility coverage:** 4/4 — architecture fits (one pure module, one strict reader, one RPC, one board surface), stack is adequate (git via `execFile`, no new dependency), security is unchanged (args-array, host-supplied paths, no new auth surface), and the performance numbers reproduce in direction. What is missing is not capability but definition.

**Scope fit:** 5 IN scopes is inside the ceiling of 9 and the shape of the work matches Lean — but the fit is asserted from runtime milliseconds rather than from relative complexity, and two of the five scopes are not as single as the table says: "one read call" carries the contract, the description, the JSON-safe output and the client type, and "one board surface" carries a component plus the UI-rule tests a `production` plan owes.

**Overall verdict:** the plan has gaps.

## Why the two critical reading points matter

The payload question and the cost question are the same question asked at two ends. The summary is supposed to say "degustia is seven tags ahead of its notes" (AC3), and that sentence cannot be produced without reading the changelog blob for that project. The spec's cost model says blobs are read only when a drawer opens. Both cannot be true, and the measured difference is not hypothetical: six blobs are 877 KB and 57-78 ms on this host, against 54 ms for the six tag reads, on a board that refetches on three realtime channels.

The selector question is the same kind of collision. "With a project selected" reads naturally in the spec, but the board's filter is an array and the placeholder for "not exactly one" is `null`; the RPC shape as written turns a two-project filter into the whole fleet. That is a visible product behaviour decided by an implementation detail rather than by the spec.

## Where the plan is genuinely strong

The refusal to read the working tree is the right call and it is evidenced rather than argued: three checkouts are behind their own tags today, and the SDK has no ref-scoped read (verified in the bundled types, not only in the recon). The strict-reader split is also the correct shape — `runGitIn`'s fail-soft contract is load-bearing for five card surfaces, and copying it would have made "unreadable" and "empty" the same sentence, which is the exact failure the spec is written against.

## What this critique does not decide

Which band the surface occupies, whether the drawer is inline or a side drawer, and how wide the takeaway clamps are all Interface's. This report only insists that the *data* those surfaces render — the state enum, the row identity rule, the date and the gap count — be decided here, because each of them is consumed twice (summary and drawer) and a second invention of any of them is a second source of truth.
