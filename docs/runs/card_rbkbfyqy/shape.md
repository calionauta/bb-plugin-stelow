---
name: slice-b-recent-deliveries-view
product_type: software
intent: feature
quality: production
appetite: Lean
supervisor: high
exploration_count: 3
exploration_hybrid: true
review_mode: Product Spec + Interface + Scopes
review_mode_source: setup
appetite_fit: fits
appetite_fit_detail: >-
  Five IN scopes: one pure module with a node test, one strict git reader, one RPC, one board
  surface, one doc entry. The estimate is an ESTIMATE and the estimation-bias rules apply —
  the shape is small because the substrate is one parser and one bounded read, not because the
  work was cut. It stops fitting the moment the interface asks for per-release drilldown
  (tag diffs, commit lists), which is the one expansion named in §5.
stage: shape
created_at: 2026-10-28
approved: false
decision_reads: >
  runs/exec_wfurtsri/recon/setup.md (repository recon: 12 sections, all reproduced below) ·
  .stelow/2026-10-10/sw-card_t804npi7/state.md (parent triage context — frontmatter only, no
  body) · .stelow/2026-10-10/sw-card_rbkbfyqy/session.log (context gate blocked, see §1) ·
  .stelow/2026-10-10/sw-card_g89gtmwt/plans/spec-product_v2.md (sibling slice A, for shared
  conventions only) · docs/decision-routing.md
assumptions_resolved:
  - core_flow: "INFERRED — no human confirmation exists. The context gate never asked: `session.log` records two expired questions from a previous worker and `question-gate.mjs` refusing every new ask while `expiredQuestions > 0`, so no assumptions-receipt was produced for this card. Applied default: a reader opens the board and sees one line per project naming its newest release and when it shipped; the drawer holds the last five with one takeaway each. Reader-initiated, never polled, never a gate. **The spec gate should confirm or correct this.**"
  - target_user: "INFERRED — the operator supervising a fleet of projects on one host (one human, no auth, no per-user preferences), reading a repo that may be shared with people who were not present at the release. Applied default: single operator, fleet visible when no project filter is set."
  - business_rules: "INFERRED — 'shipped' is a git fact, not a ledger fact. The board's existing `FlowStrip` already owns 'what finished' (cards), so this slice owns releases and may not restate card counts. Applied default: tags are the spine, the CHANGELOG supplies the narrative, and a disagreement between them is shown rather than resolved silently."
  - risk_domain: "INFERRED — the visible risk is a confident wrong claim ('nothing shipped since 0.2.1' while five releases shipped). Applied default: an absent repo, an absent tag list and an unreadable read are three different sentences, and none of them may render as an empty release list."
  - tech_hints: "INFERRED — one new `lib/` module with a node test, one new RPC, one board component; git reads through a NEW strict sibling, never through `runGitIn` (its fail-soft contract collapses 'unreadable' into 'empty', §2.6). This mirrors the sibling card's VQ2 decision, measured independently here."
---

# Shape — Slice B: Recent deliveries view

**Stage:** `shape`, first pass. Recipe `shape-recon`, task `shape-evidence`, `human_boundary: none`.
**Card:** `slice-b-recent-deliveries-view`, split from the parent card's items 3+4.
**Workspace:** `/home/deploy/repos/bb-plugin-stelow`, branch `fix/inbox-row-mobile-reflow`, HEAD
`68849b42`, **dirty** (another thread's work: `lib/jtbd-contracts.mjs`, the
`skills/stelow-product-job-to-be-done/*` tree, two untracked `server/runtime/` modules, four
untracked `docs/runs/card_*` directories). Nothing here wrote to the tree.
**Inputs:** `runs/exec_wfurtsri/recon/setup.md` — whose every load-bearing number is re-executed
below rather than quoted.

This document is evidence for shaping. The coordinator keeps the product decisions; what follows
is what the substrate actually supports, the five places it bites, and one honest scope table.

---

## 0. Intent classification (first, per the card)

**`feature`, unchanged.** There is something to build and nothing to repair: `grep -rln
"CHANGELOG" server components lib app.tsx` returns exactly one file,
`server/runtime/plugin-protocols.ts:85-87`, and it is a *prompt string* telling a spawn to look for
release automation before it writes a commit message. No reader, no row, no surface anywhere in
the app reads a release. The ledger cannot answer either: `flow-metrics.ts:28-34` reads
`cards WHERE status='completed'`, which is a card fact, not a release fact.

The parent card is not usable as a quotation. `.stelow/2026-10-10/sw-card_t804npi7/state.md` is 37
lines of frontmatter with an empty body, `artifacts: []`, `history: []` — the same provenance gap
the sibling card recorded. The slice paragraph in the task prompt is therefore the only statement
of the requirement, and §7 treats its two ambiguous words ("orchestrator", "takeaways") as
questions instead of guessing them.

---

## 1. What changed since setup, and what did not

Setup's recon holds up. Every number I re-ran reproduced, with three corrections and one
correction of *emphasis* that changes the plan:

| # | Setup said | Re-measured now | Effect |
|---|---|---|---|
| 1 | 6 of 14 projects have a `CHANGELOG` | 6 of 14 — and the same 6 are the only git repos with semver tags; one more repo (`sessionmap`) has no tags, seven projects are not repos | the fleet is 6 rows, not 14. The empty case dominates |
| 2 | this checkout: `0.87.0` vs `v0.99.0` | identical, `76` commits behind, plus three more checkouts behind their own tags (§2.2) | staleness is systemic, not one bad branch |
| 3 | "the five dialects" | actually **two dialects inside one file**: `bb-plugin-stelow` carries both the linked form (140 headings) and the dashed form (171) | the dialect is per-heading, not per-repo |
| 4 | "newest 10 releases = 7,923 bytes" | true for the working-tree copy; the tagged copy's newest 10 = **3,910 bytes** | cost estimate was conservative, not wrong |
| 5 | version-order and date-order agree | **they disagree on one project of six** (`stelow`: `v1.4.5-alpha` is newest by version, `v0.86.0-alpha` by date) | this is the correction that changes the shape (§2.3) |

One thing that did *not* change, and is worth stating because it constrains everything: the
context stage never ran a strategic pass and never asked the human anything. `session.log` records
the reason — two expired questions from the previous worker keep `question-gate.mjs` refusing every
new ask. So §frontmatter's `assumptions_resolved` are **inferred defaults**, not confirmations, and
they are marked as such rather than dressed up.

---

## 2. Measurement record — executed at `68849b42`, 2026-10-28

### 2.1 The fleet is six projects, and five of those six disagree with themselves

```
$ bb project list --json   → 14 projects; 7 with .git; 6 with semver tags; 6 with CHANGELOG.md
```

The six with a changelog are also the six with tags (`sessionmap` is a repo with zero tags and no
changelog; the other seven project paths are scratch directories or bare parents). Then, per
project, the newest tag by date versus the newest release the changelog documents:

| project | newest tag (by date) | newest documented | relation | newest 10 tags with notes *at that tag* |
|---|---|---|---|---|
| bb-plugin-stelow | `v0.99.0` 2026-10-28 | `0.87.0` 2026-10-20 | notes lag by 12 minor releases | 10/10 |
| stelow | `v0.86.0-alpha` 2026-10-27 | `0.84.1-alpha` 2026-10-22 | notes lag by 2 | 10/10 |
| gogogo-fullstack-template | `v0.59.1` 2026-10-28 | `0.57.0` 2026-10-25 | notes lag by 5 | 10/10 |
| ai-credits | `v0.4.0` 2026-08-28 | `0.4.1` 2026-08-31 | **a documented release with no tag** | 5/5 (it has 5 tags) |
| ensaiter | `v0.56.2` 2026-08-31 | `0.56.2` | agree | 10/10 |
| degustia | `v0.7.0` 2026-10-05 | `0.2.1` 2026-08-09 | notes lag by 7 tags | 3/10 |

Two different measurements, both load-bearing:

- **Reading the changelog at the newest tag covers 48 of the 55 newest releases (87%). Reading the
  checkout's `HEAD` copy covers 30 (55%) — and zero for this repo**, whose ten newest tags do not
  exist in a file that stops at `0.87.0`. The tag-scoped read is not only honest, it is what makes
  the takeaway column non-empty.
- **The long tail is thinner than the window:** 252 of 928 semver tags have no entry anywhere in
  their repo's changelog (97 / 91 / 28 / 0 / 29 / 7), so a row deep in history can legitimately
  have a version, a date and no text.

**What this supports:** "shipped" is not a single stored fact. Five of the six projects disagree
with themselves, and in *both* directions — tags ahead of notes (`degustia` by five minor versions,
this repo by twelve) and notes ahead of tags (`ai-credits`). Any view that picks one source and
calls it "recently shipped" renders a claim the repository contradicts, on five of six projects,
on day one.

### 2.2 Working-tree reads lie, and the tagged copy can lie differently

```
$ git branch --show-current ; node -p "require('./package.json').version"
fix/inbox-row-mobile-reflow
0.87.0
$ git tag --sort=-v:refname | head -1        → v0.99.0
$ git rev-list --count v0.87.0..v0.99.0      → 76
```

Three of the six checkouts are behind their own tags (`0.87.0` vs `v0.99.0`; `0.84.1-alpha` vs
`v0.86.0-alpha`; `0.57.0` vs `v0.59.1`), one is ahead (`ai-credits`, 0.4.1 documented, 0.4.0
tagged), one agrees, and one has tags whose notes stop five minors earlier (`degustia`). Reading
`<projectRoot>/CHANGELOG.md` therefore inherits whatever branch is checked out; reading the blob at
the tag fixes staleness but not the notes-ahead case, and neither fixes the undocumented tags.

### 2.3 Version order and time order disagree — measured on `stelow`

```
$ git tag | grep -c '^v1\.'    → 16      (v1.0.0 … v1.4.5-alpha, Aug 14 – Sep 12)
$ git for-each-ref --sort=-creatordate --count=1 → v0.86.0-alpha 2026-10-27
```

`lib/github-release.mjs:19` (`parseReleaseTag`) and `:27` (`compareReleaseTags`) already own
version comparison, and they sort `v1.4.5-alpha` above `v0.86.0-alpha`. Sorting the view by version
would put **12 September** at the top of a project whose last release was **27 October**. Sorting
by date shows the right recency and makes the version numbers look like a downgrade. The view has
to be time-ordered, and it has to show the date next to the version, or the reader cannot tell
which of those two facts is the surprising one.

### 2.4 The parser is five shapes, and one repo can carry two of them

Measured heading shapes, one per line:

| Heading | Dialect | Where seen |
|---|---|---|
| `[0.87.0](…compare/v0.86.0...v0.87.0) (2026-10-20)` | release-please, linked | 140 |
| `[0.21.0] - 2026-09-17` | Keep a Changelog, dashed | 171 |
| `0.57.0 (2026-10-25)` | semantic-release, bare | `gogogo` |
| `[v0.1.1] - 2026-08-28` | `v` prefix | `ai-credits` |
| `[Unreleased]` | a non-release | 4 of 6 files |

A single regex (`^##\s+\[?v?\d+\.\d+\.\d+…` with optional link, optional dash, optional parens)
classifies, per file: 311/312, 142/143, 105/133 (the 28 `## What's Changed` are body H2s), 6/6,
105/105, 12/13 (`Unreleased`). Two traps, both measured:

- **`## What's Changed` is not a release boundary.** Splitting the body at the next `## ` gives
  `gogogo` releases with **0-byte bodies** — my first probe did exactly that and reported
  `prose=0, avgBody=0` for its newest five. Splitting at the next *release heading* fixes it
  (2,442 B average, 22 bullets in `0.57.0`). 28 of that project's 105 releases carry such an H2.
- **`Unreleased` is not the first heading.** In `ai-credits` at `v0.4.0` it sits **mid-file**
  (line 85), so "skip the first heading if it says Unreleased" is not a rule; the version
  pattern is.

### 2.5 Non-semver tags are common, and they sort to the top when fresh

```
bb-plugin-stelow  … archive/stash-0 … archive/stash-4      (407/414 parse)
stelow            … skills-only-base, archive/main-old     (231/234)
gogogo-…          … pre-merge-backup, fullstack-backup-…   (132/134)
ensaiter          … backup/encontro-supervisao-pre-merge    (134/135)
ai-credits, degustia: all parse
```

Four of six. A tag spine without a filter renders `archive/stash-0` as a release, and it sorts by
date like any other. `parseReleaseTag` already returns `null` for those (`tests/github-release.test.mjs:8`
pins `dev → null`), so the fix is reuse, not a new rule.

### 2.6 `runGitIn` cannot carry this read

`server/runtime/git-evidence.ts:61-79` is a private `runGitIn` with `timeout: 15_000`,
`maxBuffer: 1 MiB`, and a **fail-soft** contract that turns every failure into
`{ok:false, stdout:""}`; it is exported only as an injected dep set
(`createGitEvidence`, `:346-359`), which feeds five card surfaces that depend on that softness.
For this slice the distinction "no releases" versus "could not read" is the product requirement
(§2.1), and this runner cannot make it. So the read is a **new strict sibling**, exactly the shape
the sibling card settled by VQ2, with two commands:

```
$ git for-each-ref --sort=-creatordate --count=30 --format='%(refname:short) %(creatordate:iso-strict)' refs/tags
$ git show <tag>:CHANGELOG.md          # only when the drawer is opened
```

Measured: `for-each-ref` **30 ms**, `git show` of the 244,695-byte tagged changelog **280 ms**,
fleet tag read across all 14 project paths (serial) **362 ms**, parallel across the 7 repos
**100 ms**, and the parse itself **0.92 ms** per 232 KB file.

### 2.7 Takeaways exist as prose, in 53% of the releases anyone would actually look at

```
newest five releases per project: 30 releases, 16 carry an indented prose paragraph (53%)
gogogo 0/5 · ensaiter 0/5 · bb-plugin-stelow 1/5 · stelow 5/5 · ai-credits 5/5 · degustia 5/5
```

Across all 681 parsed releases the ratio is 336/681, average prose length 69 characters — one line
after trimming. Example (`stelow 0.84.1-alpha`): *"Its body-extraction regex matched greedily across
the NEXT test, so every…"*. The prose is the *why*, written by whoever wrote the commit body, and it
is in the same file at the same cost. Where it is missing, the first bullet is the only text there
is (`ensaiter 0.56.2`: one bullet, 187 bytes).

### 2.8 Deduplication target is real, and already built

`components/panels/build-panel-view.tsx:357` mounts `FlowStrip` with the board's project filter, and
`FlowStrip` renders finished-card counts, lead/cycle percentiles and a per-card table from
`cards WHERE status='completed'` (`server/runtime/flow-metrics.ts:28-34`, documented at
`FEATURES.md:2385-2400`). A "recently delivered" list of finished cards is that strip. The card's
own words — *"rather than duplicating delivery records"* — point at exactly this overlap, so the new
axis is **releases**, which the ledger cannot answer.

### 2.9 The cost rules this slice must respect

- `readTextFile` (`server/cards.ts:279-291`) caps at **200,000 chars** and slices from the front:
  this repo's 231,883-byte file loses its oldest entry, not its newest. Acceptable, and only as a
  fallback — it is a working-tree read, see §2.2.
- `bb.sdk.files.read` takes `{hostId?, path, rootPath?, signal?}` — **no `ref`, no offset, no
  length** (`bb-plugin-sdk.d.ts:18134-18139`), so a tag-scoped read is a git subprocess by
  necessity. `server/runtime/board-read.ts:238` proves an arbitrary project path is readable this
  way today, so *path* plumbing is not new.
- `server/card-detail-rpc-contract.ts:21-34` restricts subprocess reads on the **card** path. The
  board path has its own precedent: `buildFlowMetrics`
  (`server/runtime/wiring/rpc-surfaces.ts:67-80`) already walks every finished card's workspace per
  board call and is fail-soft to an empty `FlowCoverage`. This slice is cheaper than that
  precedent — 100 ms for the whole fleet.
- A `git show` larger than the 1 MiB buffer reads as *nothing*, silently, unless the strict reader
  distinguishes it. Largest file today is 244,695 B, so the trigger is a project that grows its
  changelog past 1 MiB, not one that exists now.

### 2.10 `parseReleaseTag` is the only version owner, and it has a ceiling

`compareReleaseTags` compares the numeric triple only, so `0.84.1-alpha` and `0.84.1` compare
**equal** (`lib/github-release.mjs:27-35`). That is fine for a *filter* and a *tie-break*, and it
must not be used as the primary sort — §2.3 already shows why (the v1 line). Reuse it; do not
re-derive semver precedence in a second module.

---

## 3. Hill chart (what was unknown, and what is now known)

**Uphill — the shape is not settled here, on purpose:**

- **H1 (uphill) — One home, and this card cannot choose it alone.** The board strip is
  project-scoped and single-line; a new panel view is fleet-wide by default; a card section is
  card-scoped and would repeat a project fact (`tests/card-information-hierarchy.test.mjs:34`
  pins one home per fact). Recommended: the board, because that is the only surface that already
  knows both "one project" and "all projects". Interface decides.
- **H2 (uphill) — What a row is.** Version + date + one takeaway line, or version + bullet list?
  Measured difference: 30 rows × ~70 chars vs 15 KB of bodies (§2.7). Recommended: one line, the
  drawer holds the text.

**Downhill — decided by evidence in this document:**

- **H3 (downhill) — Time is the axis, version is a tie-break.** §2.3. Same-day ties are the norm,
  not an edge case: 32 same-day groups in this repo (max **35** releases dated 2026-09-14), 30 in
  `stelow`, 25 in `ensaiter`. Without a version tie-break the sort is unstable and rows swap
  places between renders.
- **H4 (downhill) — Tags are the spine, the changelog is enrichment, and the gap is content.**
  §2.1. Version from the tag (filtered by `parseReleaseTag`), date from the tag, takeaway from the
  changelog entry whose version matches, "documented" as a per-row flag.
- **H5 (downhill) — A takeaway is extracted, never generated.** §2.7: prose paragraph when the
  release has one, first bullet otherwise, never a model. `docs/decision-routing.md:1-15` keeps
  model-backed decisions out of artifact acceptance; a generated takeaway would be a new model
  surface in a read path with no grounding in the file.
- **H6 (downhill) — Absence is a state, and there are four of them.** `no-repo`, `no-tags`,
  `no-notes` (tags but no changelog entry for that version — 7 of the 55 recent releases, 252 of
  928 tags historically), and `unreadable`. Eight of fourteen projects are the first two. A single
  "nothing to show" would be the `plannedTaskGhosts` failure in its ordinary form.

---

## 4. Proposal

### Problem

An operator supervising six release-bearing projects has to leave bb, `cd` into each repo, and
read `git log` / `CHANGELOG.md` to answer "what shipped lately, and what was it about". The board
answers "what finished" from the ledger (`FlowStrip`), and the ledger cannot answer "what shipped"
because releases live in git and the plugin never reads them (§2.8). Everything the app shows about
delivery is card-shaped, and releases are not cards.

### Solution

One project-scoped read of the release record, and one line of UI that names it.

1. **`lib/project-releases.mjs`** — pure: fold tag rows + changelog text into release rows
   (`version`, `date`, `documented`, `takeaway`, `source`), compute the undocumented gap, select
   the window, and render the one-line summary. Reuses `parseReleaseTag` / `compareReleaseTags`;
   never re-implements version order.
2. **`server/runtime/project-releases.ts`** — a strict sibling git reader (two commands, §2.6),
   project root via `projectRoot` (`server/runtime/root-paths.ts:36-49`), one typed state per
   project, bounded parallel fan-out over the fleet, no caching beyond the drawer's own memo.
3. **RPC `projectReleases`** — `{ projectId: string | null }`, where `null` means the fleet, so one
   handler answers both the project-filtered board and the all-projects board. Fail-soft to a typed
   state, never to `[]`.
4. **Board surface** — one summary line in the strip band that already holds `FlowStrip`
   (project-scoped; the fleet variant lists only projects with a record and states how many have
   none), opening a `DisclosureSection` drawer with the last five rows. Closed by default:
   `startsOpen({live,blocking})` (`components/disclosure.tsx:72`) is false for a settled release
   list, and `SECTION_SURFACE` / `DisclosureSection` are the only legal shapes.
5. **`FEATURES.md`** entry with the measured behaviour, plus the blueprint proposal AGENTS.md owes
   for any new user-facing pattern (separate upstream commit).

### Dangers (concrete failure modes, each with a measured trigger)

| # | Failure | Trigger (measured) | What the design does |
|---|---|---|---|
| D1 | The view confidently reports an old release | Project source on a feature branch: 3 of 6 checkouts behind their tags today, this one by 76 commits | read the blob at the tag, never the working tree; fall back to the working tree only when there are no tags, and say so in the row |
| D2 | Ordering hides the newest releases | `stelow` carries a `v1.x` line (Aug–Sep) and a `v0.8x` line (Oct) | sort by tag date; version is the tie-break only |
| D3 | A "recent" list omits releases that shipped | `degustia` documents 3 of its newest 10 tags (`v0.7.0` tagged, notes stop at `0.2.1`); 252 of 928 tags have no entry at all | tags are the spine; the undocumented count is shown, not dropped |
| D4 | Empty release bodies, blank takeaways | semantic-release dialect: 28 of `gogogo`'s 105 releases have `## What's Changed` inside the body | split at the next *release* heading, not the next `## ` |
| D5 | `archive/stash-0` rendered as a release | 4 of 6 repos carry non-semver tags | filter with `parseReleaseTag`; test pins `dev → null` |
| D6 | Rows reorder between renders | 32 same-day groups here, one date with 35 releases; 30 in `stelow` | stable sort: date desc, then version desc |
| D7 | An unreadable repo reads as "no releases" | `runGitIn` collapses every failure (`git-evidence.ts:61-79`); eight projects have nothing at all | four typed states (§H6); test asserts `unreadable ≠ no-releases` |
| D8 | The board slows down | 362 ms serial fleet read, 100 ms parallel; a drawer read is 280 ms per project | parallel fan-out, drawer-only blob reads, no per-row subprocess |
| D9 | A second "delivered" claim appears on the board | `FlowStrip` already renders finished cards from the ledger (`FEATURES.md:2385-2400`) | releases only; the summary line never restates card counts |

### Out of scope (stated, not implied)

GitHub Releases API (no auth configured; 60 req/h/IP unauthenticated, measured in
`runs/exec_wfurtsri/recon/setup.md` §7), model-written takeaways, per-release drilldown (tag diff,
commit list), a CLI verb, persistence in SQLite, notifications/digests, projects sourced from
another host (all 14 are local today), multi-version-line detection, backfilling the 252
undocumented changelog entries, and any UI for the seven projects that are not repos.

---

## 5. OUT/IN Scope Table

| IN scope | Outcome | Trade-off (what is sacrificed, and why) |
|---|---|---|
| 1. `lib/project-releases.mjs` + node test | Parser/selector/formatting with a unit test per dialect and per refusal | The parser is a *display* grammar, not a spec of changelog format. We accept that an unparsed heading is invisible rather than guessing — cost: a project inventing a sixth dialect shows fewer rows, and says `no-notes` |
| 2. Strict git sibling reader | `for-each-ref` + `show` at a project root, typed failures | A second git runner lives beside `runGitIn` instead of inside it. Cost: two places run git; benefit: five card surfaces keep their fail-soft contract untouched (§2.6) |
| 3. RPC `projectReleases` | One call answers one project or the fleet | Fleet rows are computed on every board render (100 ms, §2.6). Cost: no cache in v1; the alternative was a cache-invalidation problem for a feature whose context (tags) genuinely never mutates |
| 4. Board summary line + drawer | The reader sees the newest release per project and the last five with takeaways | Adds one band to the board. Cost: the board grows a third strip; benefit: it is the only surface with both project and fleet scope (§3 H1). Interface may move it into the Flow drawer at the cost of rewriting `FlowStrip`'s `count === 0` guard (`flow-strip.tsx:44`) |
| 5. `FEATURES.md` + owed blueprint | The feature exists in the inventory and the pattern is portable | Documentation work in the same commit. Cost: a second upstream commit; skipped only by breaking AGENTS.md's rule |

| OUT scope | Why it is out | Revisit trigger |
|---|---|---|
| GitHub Releases API | Auth-free read is 60 req/h/IP; no token configured; only covers GitHub-hosted projects | A project whose notes live only in GitHub Releases, or a token in `~/.secrets/` |
| Model-written takeaways | New model in a read path, ungrounded by the file, and policy keeps model decisions off artifact surfaces | A human asks for a summary *of* the takeaways, in a separate generation feature |
| Per-release drilldown (diff, commits) | The fastest way for a Lean slice to become a history browser | A reader cannot act on a one-line takeaway |
| CLI verb (`bb stelow releases`) | The UI is the requested surface; the `lib/` module makes the verb cheap later (`cli-metrics.ts` has no `--project` today) | An agent needs it without opening the panel (§7.1) |
| SQLite persistence | Tags are the source; a table would be a second truth with an invalidation problem | Ordering/search across 300+ releases per project |
| Notifications/digests | Different product: "tell me when" rather than "show me now" | Release cadence drops and the operator asks to be told |
| Remote-host project sources | All 14 projects are one host today; `projectRoot` returns a path, not a host | A project sourced from another machine |
| A row for a documented release with no tag | `ai-credits` documents `0.4.1` with no tag; showing it needs a rule for "notes ahead of tags" | The spec decides (§7.3) |
| Changelog backfill (252 entries) | A docs task for six repos, not a view | Someone asks why the gap is large |

---

## 6. Alternatives considered

- **A. Read the GitHub Releases API per project.** Real published notes and a canonical "what
  shipped", but: no token configured, 60 req/h/IP unauthenticated, and it only answers for
  GitHub-hosted projects — `degustia` tags `v0.7.0` with no notes anywhere, which the API cannot
  invent. Rejected for this slice; it remains the right upgrade once the parser exists.
- **B. Duplicate delivery records (finished cards) as "recent deliveries".** Rejected: `FlowStrip`
  already does it from the same ledger on the same project axis (§2.8). The card explicitly warns
  against it.
- **C. Changelog-only, read from the working tree.** Cheapest (one `files.read`, ~5 ms) and it
  would ship in a day. Rejected: 3 of 6 checkouts are behind their tags — the panel would report
  `0.87.0` while `v0.99.0` shipped that morning, on the operator's own machine (§2.2).
- **D. Tag spine + changelog enrichment (recommended).** Correct for all six projects, shows the
  gap instead of hiding it, and costs 100 ms for the fleet.
- **E. Extend the existing `board` RPC instead of adding one.** `loadBoard` already resolves the
  root and reads project files (`server/runtime/board-read.ts:342-357`), so it looks free. Rejected:
  it puts a subprocess on the board's hot path, which every board render and several tests already
  pay for; a separate call lets the drawer fetch lazily and keeps `board` a pure file read.

---

## 7. Unanswered questions (what this evidence does not decide)

1. **Whose "orchestrator"?** The done-clause says "the orchestrator sees recent releases per
   project". In this codebase that word names the *agent*; the parent card's title ("painel") and
   `uiScopePresent: true` name the human. The two readings differ by one scope (a CLI verb, OUT
   above). Recommendation: build the `lib/` reader first — both consumers need it — and answer the
   question at the spec gate rather than guessing.
2. **Home.** Board strip vs a third tab in the Flow drawer vs a panel view (§H1). Costs differ;
   the fact-home rule and the `FlowStrip` null-guard differ.
3. **Whether an untagged documented release is a row.** `ai-credits 0.4.1` is real work with notes
   and no tag. Showing it is honest and cheap; not showing it is defensible ("a release is a tag").
4. **Window.** Last five (mine), last 30 days (would be 88 rows for this repo), or "since 90 days".
   The fleet's cadence varies by 20×, so one window cannot fit all six.
5. **Takeaway length.** One line (53% have one) vs two. Measured: 69 chars average, so one line
   fits; a clamped two-line block is a density choice, not a data choice.
6. **Whether the fleet view lists silent projects.** Eight of fourteen have nothing; listing them
   is noise, hiding them is a lie unless the count is stated.

---

## 8. Rabbit holes (timeboxed, must not become scope)

- **R1 — Semver precedence.** Prerelease ordering (`alpha.2` vs `alpha.10`), ranges, `+build`.
  *Timebox:* none. Use `parseReleaseTag` for filtering and date for ordering; the ceiling is
  documented in §2.10 rather than fixed.
- **R2 — Version-line detection.** `stelow`'s `v1.x` and `v0.8x` lines could be annotated
  ("line changed"). *Timebox:* one spike. Default: show what the tags say, sorted by date; no line
  inference.
- **R3 — GitHub Releases merge.** See alternative A. Default: OUT; revisit with a token.
- **R4 — Changelog dialect autodetection.** *Skip.* One regex, per heading, measured on 681
  releases (§2.4). Autodetection would be a second parser.
- **R5 — Caching and invalidation.** *Timebox:* none. Keyed memo of the drawer's per-tag blob, and
  nothing more; a tag key cannot go stale.
- **R6 — Very large changelogs.** A `git show` over 1 MiB fails as empty today (§2.9). *Timebox:*
  one spike on a `maxBuffer` raise or a head-bounded read. Default: raise the buffer in the strict
  reader only if a project crosses it; not now.

---

## 9. Definition of Done (Product)

- [ ] With a project selected, the board shows that project's newest release — version **and**
      date — without leaving the app and without running a git command by hand.
- [ ] With no project selected, the board shows one row per project that has a release record, and
      states how many projects have none.
- [ ] The drawer lists the last five releases per project, each with a takeaway taken from the
      release's own text.
- [ ] A tag newer than the documented release is visible as a gap, never hidden.
- [ ] A project with no repo, no tags, or an unreadable read says which of those it is.
- [ ] No row changes position between two renders of unchanged data.

## Acceptance Criteria

1. **Given** a repo whose checkout is behind its tags, **when** the board renders that project,
   **then** the newest release shown is the newest *tag*, not the version in `package.json`.
2. **Given** `stelow` (a `v1.4.5-alpha` tag dated 12 Sep and a `v0.86.0-alpha` tag dated 27 Oct),
   **when** the drawer opens, **then** 27 Oct is the first row.
3. **Given** `degustia` (tags to `v0.7.0`, notes stop at `0.2.1`), **when** its summary renders,
   **then** the gap of 7 undocumented tags is stated.
4. **Given** `ai-credits` (notes document `0.4.1`, newest tag `v0.4.0`), **when** its summary
   renders, **then** the row does not claim `v0.4.0` is the newest documented work.
5. **Given** a project whose changelog uses `## What's Changed`, **when** its newest five are
   parsed, **then** no row has an empty body and each takeaway is non-empty.
6. **Given** a repo with `archive/stash-0` tags, **when** the spine is built, **then** they are
   absent from the list.
7. **Given** a project path that is not a git repo, **when** the fleet renders, **then** that
   project reads `no repo`, not `no releases`.
8. **Given** 35 releases sharing one date, **when** the list is sorted twice, **then** the order is
   identical both times.

---

## 10. `appetite_fit` — `fits` (Lean), as an estimate

| Check | Result |
|---|---|
| IN scopes | 5 |
| Hill decisions | 6 (2 still uphill: home, row unit) |
| Distinct surfaces added | 2 — one RPC, one board component |
| New `lib/` modules | 1 (+1 node test) |
| Highest-risk item | H1 (home) — because it is Interface's, not because it is large |
| Measured cost | 100 ms fleet read, 280 ms per-project blob, 0.92 ms parse |

Nothing here is cut for seeming complex: the parser is one regex, the reader is two commands, the
component is one disclosure. The bias rules warn about overestimating complexity, not about calling
a small plan small — but `fits` is an estimate, not a promise. The one expansion that would break
Lean is named: per-release drilldown (tag diffs, commit lists), which is OUT above. If Interface
asks for it, `appetite_fit` becomes `cuts_needed` and the cut is that drilldown, not the substrate.

---

## 11. Evidence hygiene

- Every code fact carries `path:line`, read at `68849b42` on 2026-10-28. Every fleet number was
  executed against `bb project list --json` and the six repos on this host.
- **Corrections made to setup, not inherited:** the dialect count (two inside one file, not five
  per repo), the tagged-copy byte offsets (3,910 for ten releases, not 7,923), and the version-vs-date
  fork (§2.3) that setup did not test.
- **Perishable numbers:** §2.1 (which checkouts are behind) and §2.2 (tag counts) move with every
  release; §2.5's non-semver tag list moves whenever someone tags a backup. Re-measure §2.1 before
  committing to a plan — it is the claim the whole trust argument rests on.
- **Not edited:** `state.md`, gates, completion state — out of scope for this task by instruction.
  `plans/spec-product.md` does not exist yet for this card and is the coordinator's to write.
- **Not surveyed:** external or product-side evidence about release dashboards. Nothing here is a
  claim about what other tools do; every number is from this host.
- **No fabrication:** where the question is open (§7), this document says it is open; where a claim
  came from setup rather than my own run, it is not cited as mine.

---

```
stage          : shape
description    : Shaped Slice B — a project-scoped release read (tag spine + changelog
                enrichment) with a board summary line and drawer. Re-measured the whole fleet:
                14 projects, 6 with a release record, 4 of those 6 disagreeing with their own
                tags; ordering is by tag date because version order hides six weeks on stelow;
                takeaways are extracted, never generated; five IN scopes, `appetite_fit: fits`.
status         : done
artifacts      : runs/exec_hvew3r95/recon/shape.md
inputs         : runs/exec_wfurtsri/recon/setup.md,
                .stelow/2026-10-10/sw-card_t804npi7/state.md (parent triage context, frontmatter only),
                .stelow/2026-10-10/sw-card_rbkbfyqy/session.log,
                .stelow/2026-10-10/sw-card_g89gtmwt/plans/spec-product_v2.md,
                docs/decision-routing.md
next-candidate : critique
gate           : none
rework-on      : shape
```
