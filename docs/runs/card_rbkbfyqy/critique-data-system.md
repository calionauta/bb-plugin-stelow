---
gaps:
  - severity: critical
    tag: data
    title: "Tag-to-changelog matching is unspecified and the only available comparator ignores prerelease"
    description: >-
      §Solution says the enrichment is "the changelog entry whose version matches a tag", but never
      states the match rule. The only version owner named by the spec is `parseReleaseTag` /
      `compareReleaseTags`, and shape §2.10 plus `lib/github-release.mjs:27-35` record that the
      comparator reduces a tag to its numeric triple, so `0.84.1-alpha` and `0.84.1` compare equal —
      and `parseReleaseTag` also accepts an optional `-suffix` while discarding it. On a fleet where
      a project (stelow) ships alpha tags and another (ai-credits) documents `0.4.1` with no tag, a
      triple-based match can attach one release's prose to a different release's row, silently. The
      spec also never says which entry wins when two headings carry the same version (a bad merge
      or a re-cut release produces that in release-please files).
    recommendation: >-
      §Solution, "The read has a spine and an enrichment": state the match key exactly — normalized
      exact string (strip `v`, keep the prerelease suffix) or a parsed triple that merges
      prereleases — and say which heading wins on a multi-match. If the answer is "exact string", say
      how `v0.4.0` in a tag and `[v0.4.0]` in a heading normalize to the same key.
    resolved: false

  - severity: critical
    tag: data
    title: "One flat list of four states mixes project-level and row-level absence, and omits two states measured on this host"
    description: >-
      §Solution asserts four states — `no repo`, `no tags`, `no notes for this release`,
      `unreadable` — as if they were one level. They are not: `no repo` and `no tags` are
      per-project, `no notes` is per-row, and `unreadable` is per-read. D7 makes the ambiguity
      load-bearing: `for-each-ref` can succeed (tags readable, dates trustworthy) while `git show`
      fails, and the spec does not say whether that is a project-level `unreadable` that discards
      the good tag rows or per-row `no-notes`, which would be a false claim. Two further states are
      measurably real today and unnamed: (a) a project path that no longer exists — measured now,
      `/tmp/opencode/e2e-card-proj` is one of the 14 project paths and `git -C` reports "cannot
      change to ... No such file or directory", which is not "not a repository"; (b) a changelog
      that exists but whose headings do not parse — shape §5 explicitly accepts "a project inventing
      a sixth dialect shows fewer rows, and says `no-notes`", which collapses "file absent" with
      "file present and unparsed". The spec's own risk domain is "every empty state must say which
      emptiness it is".
    recommendation: >-
      §Solution, "Absence is a state": split the taxonomy into a project-level state and a row-level
      flag, and add the two missing states. Specifically: when tags read but a blob does not, what
      does the project state read and what do its tag rows say? What state names a path that does not
      exist? What distinguishes "no changelog file" from "changelog present, zero headings matched"?
    resolved: false

  - severity: critical
    tag: system
    title: "The read contract has no timeout, no buffer bound and no aggregate deadline, and the fleet cost claim undercounts the spawns"
    description: >-
      §Scope table row 2 says "Two commands per repo, typed failures" and D8 prices the fleet read at
      100 ms over "the 7 repos", but the call takes project *paths* (14 on this host) and must decide
      "is this a repository" before it can price anything — so the fleet path is at least one
      subprocess per project path, not per repo. Nothing in the spec states the new reader's
      per-command timeout or `maxBuffer`. The precedent it is copying is 15 s per command with a
      1 MiB buffer (`server/runtime/git-evidence.ts:61-79`), and one host command has a 10-minute
      timeout (`git-evidence.ts:307`). With no aggregate deadline, a hung or slow git on one project
      holds the whole call — and the spec never says whether the fleet response may return partial
      results.
    recommendation: >-
      §Scope table, "Strict git reader" plus D8: state the per-command timeout, the `maxBuffer`, the
      aggregate call deadline, and the partial-result policy when the deadline is crossed (rows for
      the projects that answered plus a stated "not read" count, or nothing at all). Also correct the
      spawn count in D8 to commands-per-path and re-state the measured 100 ms against that count.
    resolved: false

  - severity: important
    tag: data
    title: "The sort key and the rendered date are different quantities, so the version tie-break may never fire where D6 assumes it"
    description: >-
      §Solution orders "by tag date, descending, with version as a tie-break" and D6/AC8 rest on
      "32 groups of same-day releases, one date with 35 releases". The proposed command reads
      `%(creatordate:iso-strict)` (shape §2.6), which is the tagger date for an annotated tag and the
      committer date for a lightweight one — verified on this host, `git cat-file -t v0.99.0` reports
      `commit`, and every release tag in this repo is lightweight. That value is a timestamp with a
      UTC offset (`2026-09-15T22:24:13+00:00`). Rows display a calendar day. If the sort key is the
      raw timestamp, two releases shown as the same date keep their timestamp order and the version
      tie-break effectively never runs — the exact visual D6 exists to prevent — and a timezone shift
      changes which releases share a displayed day.
    recommendation: >-
      §Solution ordering paragraph and D6/AC8: state which quantity is the sort key (raw timestamp
      vs. calendar day), in which timezone the day is derived and displayed, and whether the version
      tie-break applies after truncation to the day. If the sort key stays the timestamp, say why
      AC8's "identical order twice" is not trivially satisfied by unique timestamps.
    resolved: false

  - severity: important
    tag: data
    title: "The undocumented-tag count has no stated denominator, and the read is capped"
    description: >-
      AC3 requires degustia's summary to state "the gap of 7 undocumented tags", and D3 argues from
      "252 of 928 tags". Those two numbers cannot come from one capped read: shape §2.6 proposes
      `for-each-ref --count=30`, and spec-product never names a window or cap at all. So "7" could be
      7 of the last 30, 7 of the last 10, or 7 of 55 — and the spec's "recent" claim is unfalsifiable
      until the denominator is written down. The same cap silently decides whether the fleet line's
      "newest release" can ever be wrong: a repo whose 30 newest tags by creatordate are all
      non-release tags (`parseReleaseTag` null) yields `no tags` even though semver tags exist deeper
      in history.
    recommendation: >-
      §Solution, "the undocumented count is stated" and §Scope table row 1: state the read window
      (count or days), state what the count is a count *of* ("N of the last M tags"), and say what the
      spine does when the capped window contains zero parseable tags but the repo has them further
      back.
    resolved: false

  - severity: important
    tag: system
    title: "Call-level failure is undefined: unknown projectId, a failing projects list, and a thrown read"
    description: >-
      §Solution point 3 gives the call one input (`{ projectId: string | null }`) and says it
      "calls fail-soft to a typed state, never to `[]`" — but typed states are per project, and the
      call itself has failure modes with no defined answer: a `projectId` naming a project that was
      deleted or renamed while the board filter still holds it; the fleet path when listing projects
      fails; one project's read throwing despite the fail-soft intent (a `Promise.all` rejection takes
      the whole call). The sibling contract validates input with `.strict()` (`server/card-rpc-contract.ts:173-182`),
      so an unknown-project answer is a decision, not an accident.
    recommendation: >-
      §Solution point 3: define the response envelope (a top-level result vs a typed error), say what
      an unknown or deleted `projectId` returns, say whether the fleet path lists projects itself or
      receives them, and state that each project's read is isolated so one throw cannot fail the call.
    resolved: false

  - severity: important
    tag: data
    title: "The wire shape has no schema and no nullability rule, in a codebase where `undefined` on a result refuses the whole call"
    description: >-
      The row is described in prose (`version`, `date`, `documented`, `takeaway`, `source`) with no
      type, no schema, and no nullability. This repo has a documented failure for exactly this shape:
      `server/runtime/wiring/rpc-surfaces.ts:169-200` records that a result key holding `undefined`
      is refused by the host — "rpc result at $result.redFirst is not a JSON value (undefined)" — and
      the guard is now `withoutUndefined` at the boundary. A `takeaway` that is absent when the
      release has no notes, and a `documented` flag, are precisely the fields that get built as
      `undefined`. `date` is also untyped: `flowMetrics` speaks epoch ms (`server/card-rpc-contract.ts`
      output schema) while `fileTimestamp` speaks ISO strings (`server/runtime/root-paths.ts`).
    recommendation: >-
      §Solution point 3 or the scope table's RPC row: give the input and output zod schemas
      explicitly (nullable, never optional-and-undefined), pick one wire type for `date`, and state
      the `source` and state enums as closed unions so the client cannot invent a fifth state.
    resolved: false

  - severity: important
    tag: system
    title: "No coalescing or invalidation: the fleet read runs per mount with an explicit refusal to cache"
    description: >-
      §Scope table row 3 states the cost plainly — "Fleet rows are computed on every board render
      (100 ms, §2.6) ... the alternative was a cache-invalidation problem" — and shape R5 caps caching
      at "a keyed memo of the drawer's per-tag blob". Nothing states what bounds concurrent callers:
      the board is a client surface, so several open clients or a board remount after a `board-changed`
      publish (`rpc-surfaces.ts:277,313`) each start a fresh fan-out of git subprocesses. The repo has
      a precedent for the alternative: `lib/github-release.mjs:8-10` documents "the server coalesces
      calls behind its update-check window; a failure keeps the previous value".
    recommendation: >-
      §Scope table row 3 (or D8): state whether the fleet call coalesces concurrent callers, what the
      window is, and what invalidates it — a new tag appears while the board is open, and the reader
      expects to see it without a reload. "No cache" is acceptable only if the spec also names the
      bound on simultaneous calls.
    resolved: false

  - severity: important
    tag: data
    title: "The drawer memo's key is a tag name, but tag names repeat across projects"
    description: >-
      Shape R5 justifies the only cache in the plan with "a tag key cannot go stale". Tags are
      per-repository, not per-host: this fleet already has `v0.1.1`, `v0.4.0` and shared minor numbers
      across bb-plugin-stelow, ai-credits, degustia and stelow (shape §2.1 table). A memo keyed by tag
      alone serves project A's changelog blob for project B. The spec also never says what the memo
      retains — the raw blob (up to 232 KB per entry, and shape §2.6 already measures 244,695 B) or the
      parsed rows — so retention is unbounded by construction.
    recommendation: >-
      §Solution point 2 ("no caching beyond the drawer's own memo"): state the memo key (project root
      + tag, or project id + tag), what it stores, and whether anything evicts it. If the answer is
      "the parsed row only", say so, because that changes the 280 ms cost on re-open.
    resolved: false

  - severity: important
    tag: data
    title: "Takeaway is an unnormalized string: no markdown handling, no length contract, no truncation owner"
    description: >-
      §Solution paragraph 2 defines the takeaway as "the indented prose paragraph under the entry when
      the release has one, the first bullet when it does not, and nothing when neither exists". It does
      not say how much of the paragraph counts as the paragraph (the first line, or the whole indented
      block), whether markdown survives (`[#123](https://github.com/.../pull/123)`, inline code,
      `**bold**`, HTML comments), whether embedded newlines are collapsed, or what the maximum length
      is. The 69-character average in shape §2.7 is a measurement of trimmed prose, not a guarantee:
      release-please bullets in this repo routinely carry a PR link longer than the line. The row is
      claimed to be one line, and the repo has a live trap for that: a `line-clamp-*` class sharing a
      class list with `block` silently never applies (AGENTS.md, `card-design-tokens`).
    recommendation: >-
      §Solution paragraph 2 and §Scope table row 1: state the extraction unit (first line vs. whole
      indented block), the normalization rules (links to their text, code fences, HTML, whitespace
      collapse), the character cap, and whether truncation happens in `lib/project-releases.mjs` or in
      CSS — with the rule that an empty-after-normalization takeaway is `null`, not `""`.
    resolved: false

  - severity: important
    tag: data
    title: "The tagless working-tree fallback has no state name, no trusted date, and no stated row semantics"
    description: >-
      D1's row says "fall back to the tree only when there are no tags, and say so", yet the absence
      taxonomy defines `no tags` as a terminal state, and no fifth state exists for "rows read from a
      working tree". A tagless repo with a CHANGELOG would therefore produce rows with no tag date —
      the date would have to come from a heading, the very source §2.2 proves unreliable — and rows
      whose provenance differs from every other row in the same list. A tagless repo without a
      CHANGELOG produces `no tags`. The spec's own out-of-scope list refuses the notes-ahead case
      (`ai-credits 0.4.1`) on the grounds that "a release is a tag", which is in tension with reading
      rows off a tree that has no tag at all.
    recommendation: >-
      §Dangers D1 and the absence paragraph: name the state and the `source` value for tree-sourced
      rows, say where their date comes from and whether it sorts with tag dates, and say whether the
      fleet line counts such a project as "has a release record". If the fallback exists only for a
      case no project on this host has (a tagless repo with a changelog), say so and cut it.
    resolved: false

  - severity: important
    tag: system
    title: "Repository detection must be exact, because git discovers upward and the fleet has a parent-directory project"
    description: >-
      The spec treats "no repo" (8 of 14 projects) as a simple check but never states the test. `git
      for-each-ref` run with `cwd` set to a subdirectory of a repository succeeds and reports the
      *parent's* tags. One of the 14 projects is literally `/home/deploy/repos`, the parent of six real
      project paths: a single stray `git init` there makes six unrelated projects render one identical
      tag list, and the spec has no rule that would catch it. Verified today that no ancestor of the
      eight non-repo paths is a repo, so the failure is latent rather than present — but it is the
      failure mode that turns the whole surface into a confident wrong claim, which is the spec's
      stated risk domain.
    recommendation: >-
      §Scope table, "Strict git reader": state the exact detection command (e.g. `rev-parse
      --show-toplevel` compared to the project path, or `--is-inside-work-tree` plus a toplevel
      equality check) and say whether a linked worktree path counts as the repo. Add it to the state
      tests, since "no repo" is the state 8 of 14 projects occupy.
    resolved: false

  - severity: minor
    tag: data
    title: "The changelog filename is hardcoded with no stated refusal"
    description: >-
      The read is `git show <tag>:CHANGELOG.md` (shape §2.6), and every one of the six files is named
      exactly that today, but `CHANGELOG`, `Changelog.md` and `HISTORY.md` are ordinary spellings. In
      the fallback/no-repo states a differently named file reads as `no notes for this release`, which
      asserts something about the release rather than about the file the reader guessed.
    recommendation: >-
      §Scope table row 1: state that the filename is fixed by contract (and that a repo using another
      name reads as undocumented), or name the probe list. Either way the sentence the reader sees
      should not claim a release has no notes when only the filename was wrong.
    resolved: false

  - severity: minor
    tag: system
    title: "No in-flight or failed-call state, and no way back from a transient unreadable"
    description: >-
      The four absence states are all terminal. Nothing states what the board renders during the read
      (100 ms fleet, 280 ms per-project blob) or after the RPC rejects. The precedent this surface
      copies returns `null` while pending and then `null` again on rejection
      (`components/board/flow-strip.tsx:39-43,100`), so a failure and a load look identical and the
      line appears late, shifting the board. A transient git failure — an `index.lock` from another
      thread's git command, a repo mid-clone — renders `unreadable` with no stated retry and no stated
      refresh affordance; shape §9's DoD says a card "says which of those it is", not that the state
      can be cleared.
    recommendation: >-
      §Solution, board surface, and D7: state the in-flight representation (skeleton, previous value,
      or nothing), the rejected-call representation, whether a typed failure is retried once, and
      what the reader does to re-read after a transient failure.
    resolved: false

strengths:
  - "The core data decision is measured, not assumed: tags as the spine, changelog as enrichment, and the measured disagreement between them (5 of 6 projects, in both directions) is exactly the evidence a wrong-source choice would have needed."
  - "Ordering by tag date rather than version is grounded in a reproduced counter-example (stelow's v1.x line vs v0.86.0-alpha), and the spec records why the existing comparator cannot be the primary sort."
  - "Absence is treated as first-class content, with a named requirement that `unreadable ≠ no releases` and an acceptance criterion that pins it — the failure mode the existing fail-soft git runner would otherwise hide."
  - "Cost is priced from executed commands (for-each-ref 30 ms, blob 280 ms, parallel fleet 100 ms), and the expensive read is deliberately pushed to drawer-open rather than the board path."
  - "Persistence is explicitly refused with a stated reason (a table would be a second truth), which is the right call for data whose only source is immutable tags."

verdict: "The plan has gaps"
---

# Critique — Data + System

**Data coverage:** 3 critical, 9 important, 2 minor — the spine is sound; the read contract is not written down.

**System coverage:** no timeout, no aggregate deadline, no coalescing, no detection command; the typed-failure requirement exists but its taxonomy is one flat list.

**Overall verdict:** the plan has gaps. Ship the shape's reasoning; do not ship the read contract as written.

## What holds

The product decisions in this spec are the strong half. Tags as the spine, the changelog as
enrichment, the gap shown instead of resolved, the order keyed on time rather than version — each
of those is backed by a measurement on this host that a reviewer can re-run, and each one closes a
failure mode that the default implementation (read the working tree, sort by version) gets wrong
today, in this checkout, by twelve releases. The choice to keep model output out of the read path
and to refuse a SQLite mirror of git tags is also the right kind of refusal: both would have been
second truths with an invalidation problem and no owner.

## Where the read contract stops short

Three findings block implementation, and they share a shape: the spec states a property ("typed
failures", "one read call", "version matches a tag"), names the requirement, and leaves the
mechanism to whoever writes the code.

The first is the version match. Everything else in the plan is deferential to
`parseReleaseTag` — reuse, never re-derive — and that function reduces a tag to a numeric triple
by design (`lib/github-release.mjs:27-35`). Using it to attach a changelog entry to a tag means a
`0.84.1-alpha` heading can answer for a `v0.84.1` tag. On this fleet that is not hypothetical
geometry: stelow ships prerelease tags, and ai-credits documents a version it never tagged. The
spec has to say whether matching is exact-string or triple-based, because the two produce different
rows on real data and only one of them is honest.

The second is the state taxonomy. The sentence lists four states as if they answered one question,
but they answer three: which project has no repo or no tags, which release has no notes, and which
read failed. The moment `for-each-ref` succeeds and `git show` fails, that flatness forces a wrong
answer in one direction or the other — discard readable tag rows, or claim a release has no notes
when the file could not be read. Two measured cases are missing from the list entirely: a project
path that does not exist (one of the fourteen does not, right now), and a changelog whose headings
none of the five dialects match, which shape §5 already concedes will render as `no-notes`.

The third is the deadline. The spine is one subprocess per project path, and the fleet path has
fourteen paths, not the seven repos the 100 ms measurement counted. With the timeout it is copying
from `git-evidence.ts` — 15 s per command — a single slow repository holds the call, and the spec
never says whether the response may come back partial. That is the difference between a board that
shows five projects and says "two not read" and a board that shows nothing for fifteen seconds.

## The smaller contracts a reviewer will ask about first

The wire shape is prose only, in a codebase that refuses a result carrying `undefined` and has the
incident comment to prove it — a `takeaway` that is absent when a release has no notes is exactly
that bug waiting to be written. The memo key is a tag name in a fleet where tag names repeat, and
the spec's own justification ("a tag key cannot go stale") is true per repository and false per
host. The takeaway is a string with no normalization contract, so whether the one-line claim
survives markdown links and inline code is left to the implementer. And the tagless fallback in D1
contradicts the absence taxonomy: it produces rows with no tag date and no state name, in a spec
whose out-of-scope section refuses the much smaller notes-ahead case on the principle that a
release is a tag.

None of these require new exploration. They require one paragraph each, in the sections named in
the frontmatter, before the interface stage starts designing a surface on top of an RPC whose
result shape nobody has written down.
