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
  surface, one doc entry. This is an ESTIMATE; the estimation-bias rules apply. The shape is
  small because the substrate is one tag read plus one file read, not because work was cut.
  It stops fitting the moment the interface asks for per-release drilldown (tag diffs, commit
  lists), which is the single expansion named in §10.
stage: shape
created_at: 2026-10-28
approved: false
retry_of: runs/exec_hvew3r95/recon/shape.md
retry_note: >-
  The host lost the polling channel after the first run wrote its evidence (session.log, entry
  2026-10-28). This is the retry the workflow opened. Every load-bearing number was re-executed
  at 68849b42; where a re-measurement differs from the first pass, §1.1 names the difference and
  the method that produced it. Nothing was copied forward on trust.
decision_reads: >
  runs/exec_wfurtsri/recon/setup.md (repository recon, 12 sections) ·
  .stelow/2026-10-10/sw-card_t804npi7/state.md (parent triage context — frontmatter only, empty
  body) · .stelow/2026-10-10/sw-card_rbkbfyqy/session.log (context gate blocked, §1.2) ·
  .stelow/2026-10-10/sw-card_rbkbfyqy/plans/spec-product.md (v2, written after the first pass) ·
  .stelow/2026-10-10/sw-card_rbkbfyqy/critiques/*.md (gaps this evidence now answers) ·
  runs/exec_hvew3r95/recon/shape.md (the lost first pass, re-measured rather than re-quoted) ·
  docs/decision-routing.md
assumptions_resolved:
  - core_flow: "INFERRED — no human confirmation exists for this card's assumptions; the context stage never asked (session.log: two expired questions from a previous worker keep question-gate.mjs refusing every new ask). Applied default: a reader opens the board and sees one line naming the newest release and when it shipped; opening the surface lists the last five with one takeaway each. Reader-initiated, never polled, never a gate."
  - target_user: "INFERRED — the single operator supervising a fleet of projects on one host (one human, no auth, no per-user preferences), reading repos that may be shared with people who were not present at the release."
  - business_rules: "INFERRED — 'shipped' is a git fact, not a ledger fact. FlowStrip already owns 'what finished' (cards), so this slice owns releases and never restates card counts."
  - risk_domain: "INFERRED — a confident wrong claim ('nothing shipped since 0.2.1' while five releases shipped). An absent repo, an absent tag list, an unparsed changelog and an unreadable read are four different sentences; none may render as an empty release list."
  - tech_hints: "INFERRED — one new lib/ module with a node test, one new RPC, one board component, one strict git sibling (never runGitIn, whose fail-soft contract collapses 'unreadable' into 'empty')."
---

# Shape — Slice B: Recent deliveries view

**Stage:** `shape`, retry pass. Recipe `shape-recon`, task `shape-evidence`, `human_boundary: none`.
**Card:** `slice-b-recent-deliveries-view`, split from the parent card's items 3+4.
**Workspace:** `/home/deploy/repos/bb-plugin-stelow`, branch `fix/inbox-row-mobile-reflow`, HEAD
`68849b42`, **dirty** (another thread's work: `lib/jtbd-contracts.mjs`, the
`skills/stelow-product-job-to-be-done/*` tree, `server/runtime/artifact-registration.ts`,
`docs/runs/card_*`). Nothing in this pass wrote to the tree; every measurement is a read.
**Inputs:** `runs/exec_wfurtsri/recon/setup.md`, plus the first pass's evidence, re-executed.

This document is evidence for shaping. It does not decide the product; it records what the
substrate supports, where it bites, and what the five IN scopes actually cost.

---

## 0. Intent classification (first, per the card)

**`feature`, unchanged.** There is something to build and nothing to repair.
`grep -rln "CHANGELOG" server components lib app.tsx` returns exactly one file,
`server/runtime/plugin-protocols.ts:85-87`, and it is a *prompt string* telling a spawn to look
for release automation before writing a commit message. No reader, row, RPC or surface anywhere
in the app reads a release. The ledger cannot answer either: `flow-metrics.ts:28-34` reads
`cards WHERE status='completed'`, a card fact, not a release fact.

The parent card is not usable as a quotation. `.stelow/2026-10-10/sw-card_t804npi7/state.md` is
37 lines of frontmatter with an empty body, `artifacts: []`, `history: []`. The slice paragraph
in the task prompt is therefore the only statement of the requirement, and §7 keeps its open
words open instead of guessing them.

---

## 1. What changed since setup, and what did not

Setup's recon holds up. Every load-bearing number reproduced, with the corrections below.

| # | Setup / first pass said | Re-measured at `68849b42` | Effect |
|---|---|---|---|
| 1 | 6 of 14 projects have a `CHANGELOG` | 6 of 14 — and the same 6 are the only repos with semver tags; `sessionmap` is a repo with zero tags and no changelog; the other seven project paths are not repos at all | the fleet is 6 rows, not 14; the empty case dominates |
| 2 | this checkout: `0.87.0` vs `v0.99.0` | identical, `76` commits behind; two more checkouts behind their own tags, one ahead | staleness is systemic, not one bad branch |
| 3 | "five dialects" | two dialects inside this one file (linked 330 headings at the tag, dashed and bare forms elsewhere) | the dialect is per-heading, not per-repo |
| 4 | 312 release headings here | **330** version headings at `v0.99.0`, **311** at `HEAD` (331 / 312 bracketed, one of which is `[Unreleased]`) | the 312 was the working-tree copy and counted brackets, not versions; the tag carries 19 entries the checkout never received |
| 5 | version-order and date-order agree | they disagree on one project (`stelow`) | the correction that changes the shape (§2.3) |

### 1.1 Differences from the lost first pass, named

- **Undocumented tags: 225 of 928** (first pass: 252). My match key is the exact normalized
  version string — strip a leading `v`, keep the prerelease suffix — because that is the rule the
  data-system critique forced (`0.84.1-alpha` must not borrow `0.84.1`'s notes). A triple-based
  match documents more releases and lies about one of them; a looser count is not a better number.
- **Takeaway composition: 10 prose / 15 bullet / 5 none** in the newest-five window, not "53%
  prose". "Has any indented paragraph" was too generous a rule: half the rows carry a commit-subject
  bullet (`* fix(offline): …`), which is text but not a *why*. §2.7 shows the split per project.
- **Timing is cache-dependent, so it is quoted as a range.** `for-each-ref` 30–66 ms, `git show` of
  244 KB 8 ms warm / 280 ms cold, heading parse 0.4 ms; the fleet read is **374 ms serial, 166 ms
  parallel** (first pass: 362 / 100 — the parallel number moved with machine load, so ~170 ms is
  the planning figure, not 100). The plan must budget the cold case.
- **Same-day ties are more common than the first pass measured:** 40 same-day groups in this repo
  with **36 tags on one date** (first pass: 32 groups, 35 on one date), 47 groups in `stelow`, 31 in
  `ensaiter`, 29 in `gogogo`. Ties are the normal case, not an edge case.
- **New fact, not in the first pass:** `ai-credits` has 5 release headings at its newest tag and
  **6 at `HEAD`** — the sixth is `0.4.1`, documented with no tag anywhere. That confirms the
  notes-ahead case by heading count, not by reading the file's prose.

### 1.2 The thing that did not change, and constrains everything

The context stage never ran a strategic pass and never asked the human anything. `session.log`
records why: two expired questions from a previous worker keep `question-gate.mjs` refusing every
new ask. §frontmatter's `assumptions_resolved` are therefore **inferred defaults**, marked as such
rather than dressed up as confirmations.

---

## 2. Measurement record — executed at `68849b42`, 2026-10-28

### 2.1 The fleet is six release-bearing projects, and five of the six disagree with themselves on at least one axis

```
$ bb project list --json   → 14 projects · 7 with .git · 6 with semver tags · 6 with CHANGELOG.md
```

Per project, newest tag by date versus newest release the changelog documents:

| project | newest tag (by date) | newest documented | relation | newest-10 tags documented *at that tag* |
|---|---|---|---|---|
| bb-plugin-stelow | `v0.99.0` 2026-10-28 | `0.87.0` 2026-10-20 | notes lag by 12 minor releases | 10/10 |
| stelow | `v0.86.0-alpha` 2026-10-27 | `0.86.0-alpha` | agree | 10/10 |
| gogogo-fullstack-template | `v0.59.1` 2026-10-28 | `0.59.1` | agree | 10/10 |
| ai-credits | `v0.4.0` 2026-08-28 | `0.4.1` (HEAD only) | **documented release with no tag** | 5/5 (it has 5 tags) |
| ensaiter | `v0.56.2` 2026-08-31 | `0.56.2` | agree | 10/10 |
| degustia | `v0.7.0` 2026-10-05 | `0.2.1` 2026-08-09 | notes stop 7 tags early | 3/10 |

Two numbers carry the trust argument:

- **Reading the blob at the newest tag covers 48 of the 60 newest releases (80%). Reading the
  checkout's `HEAD` copy covers 30 (50%) — and zero for this repo**, whose `HEAD` changelog stops
  at `0.87.0` while `v0.99.0` shipped that morning. Tag-scoped reads are not pedantry; they are
  what makes ten of ten rows exist here.
- **The long tail is thinner than the window:** 225 of 928 semver tags have no matching heading
  anywhere in their repo's changelog by exact version (78 / 88 / 23 / 0 / 29 / 7). A row deep in
  history can legitimately have a version, a date and no text.

**What this supports:** "shipped" is not one stored fact. On the tag-versus-notes axis alone,
three of six projects disagree with themselves — in both directions: tags ahead of notes
(`degustia` by five minor versions, this repo by twelve) and notes ahead of tags (`ai-credits`).
Add the working-tree axis (§2.2) and five of six are wrong under at least one reading: four
changelogs stop before the newest tag, one documents a release that has no tag, and only
`ensaiter` agrees on both. A view that picks one source and calls it "recently shipped" renders a
claim the repository contradicts, on five of six projects, on day one.

### 2.2 Working-tree reads lie, and the tagged copy can lie differently

```
$ git branch --show-current ; node -p "require('./package.json').version"
fix/inbox-row-mobile-reflow
0.87.0
$ git for-each-ref --sort=-creatordate --count=1 refs/tags  → v0.99.0 2026-10-28
$ git rev-list --count v0.87.0..v0.99.0                     → 76
```

Newest release documented by the **working-tree** `CHANGELOG.md` versus the newest tag, per
project:

| project | `HEAD` changelog's newest | newest tag | what a working-tree read reports |
|---|---|---|---|
| bb-plugin-stelow | `0.87.0` | `v0.99.0` | twelve minor releases stale |
| stelow | `0.84.1-alpha` | `v0.86.0-alpha` | two stale |
| gogogo-fullstack-template | `0.57.0` | `v0.59.1` | two stale |
| degustia | `0.2.1` | `v0.7.0` | five stale |
| ai-credits | `0.4.1` | `v0.4.0` | one release with no tag (notes ahead) |
| ensaiter | `0.56.2` | `v0.56.2` | agrees |

Four of six checkouts are behind their own tags (three of them by commits on a feature branch, one
— `degustia` — by notes that were never written). Reading `<projectRoot>/CHANGELOG.md` inherits
whatever branch is checked out; reading the blob at the tag fixes staleness but not the notes-ahead
case, and neither fixes undocumented tags.

`gogogo`'s `package.json` reports `0.0.0` and `ai-credits` has no `package.json` at all, so
"the working tree's version" is not even one field across the fleet. The changelog is the only
harness-independent statement of what the checkout claims, which is why the table above uses it
rather than a version file.

### 2.3 Version order and time order disagree — measured on `stelow`

```
$ git tag | grep -c '^v1\.'                    → 16   (v1.0.0 … v1.4.5-alpha, 14 Aug – 12 Sep)
$ git for-each-ref --sort=-creatordate --count=1 → v0.86.0-alpha 2026-10-27
```

`lib/github-release.mjs:19` (`parseReleaseTag`) and `:27` (`compareReleaseTags`) already own
version comparison, and they sort `v1.4.5-alpha` above `v0.86.0-alpha`. Sorting the view by
version would put **12 September** at the top of a project whose last release was **27 October**.
Sorting by date shows the right recency and makes the versions look like a downgrade. The view has
to be time-ordered, and it has to show the date beside the version, or the reader cannot tell
which of the two facts is the surprising one.

### 2.4 The parser is four heading shapes plus one non-release

Measured heading shapes:

| Heading | Dialect | Where seen |
|---|---|---|
| `[0.99.0](…compare/v0.98.2...v0.99.0) (2026-10-28)` | release-please, linked | this repo |
| `[0.21.0] - 2026-09-17` | Keep a Changelog, dashed | `stelow`, `ensaiter` |
| `0.57.0 (2026-10-25)` | semantic-release, bare | `gogogo` |
| `[v0.1.1] - 2026-08-28` | `v` prefix | `ai-credits` |
| `[Unreleased]` | a non-release | 4 of 6 files |

One regex (`^##\s+\[?v?\d+\.\d+\.\d+…` with optional link, optional dash, optional parens)
parses 709 headings across the six files with no dialect detection. Three traps, all measured this
pass:

- **`## What's Changed` is not a release boundary.** Splitting the body at the next `## ` gives
  `gogogo` releases with **0-byte bodies** — my first probe did exactly that and reported
  `prose=0, avgBody=0` for its newest five. Splitting at the next *release heading* fixes it
  (22 bullets in `0.57.0`).
- **`Unreleased` is not the first heading.** In `ai-credits` at `v0.4.0` it sits mid-file, so
  "skip the first heading if it says Unreleased" is not a rule; the version pattern is.
- **Heading position is not recency, and this one is a trap for the whole view.** `ai-credits`
  lists `## [v0.1.1]` first and `## [v0.4.1]` second, so a rule of "the newest release is the first
  heading" would report **0.1.1** as the newest documented work on a project whose latest note is
  `0.4.1`. Two more files have at least one non-descending adjacent pair (`stelow` appends its
  `v1.x` line mid-sequence in two places; `gogogo` has one `0.1.0 → 0.24.10` inversion). Measured:
  four of six files are not strictly descending, so **the window and the newest entry are chosen by
  version match against the tag, never by line position**.

### 2.5 Non-semver tags are common, and they sort to the top when fresh

```
bb-plugin-stelow  … archive/stash-0 … archive/stash-4    (7 of 414 do not parse)
stelow            … skills-only-base, archive/main-old   (3 of 234)
gogogo-…          … pre-merge-backup, fullstack-backup-…  (2 of 134)
ensaiter          … backup/encontro-supervisao-pre-merge (1 of 135)
ai-credits, degustia: all parse
```

Four of six. A tag spine without a filter renders `archive/stash-0` as a release, and it sorts by
date like any other. `parseReleaseTag` already returns `null` for those
(`tests/github-release.test.mjs` pins `dev → null`), so the fix is reuse, not a new rule.

### 2.6 `runGitIn` cannot carry this read

`server/runtime/git-evidence.ts:61-79` is a private `runGitIn` with `timeout: 15_000`,
`maxBuffer: 1 MiB`, and a **fail-soft** contract that turns every failure into
`{ok:false, stdout:""}`. It is exported only as an injected dep set (`createGitEvidence`,
`:346`), which feeds five card surfaces that depend on that softness. For this slice the
distinction "no releases" versus "could not read" *is* the product requirement (§2.1), and this
runner cannot make it. So the read is a **new strict sibling** with two commands:

```
$ git for-each-ref --sort=-creatordate --count=30 --format='%(refname:short) %(creatordate:iso-strict)' refs/tags
$ git show <tag>:CHANGELOG.md          # only when the surface is opened
```

Measured: `for-each-ref` 30–66 ms, `git show` of the 244,247-byte tagged changelog 8 ms warm /
280 ms cold, heading parse 0.4 ms, fleet tag read across all 14 project paths **374 ms serial and
166 ms parallel** across the 7 repos.

### 2.7 Takeaways are text in 25 of 30 rows, but only a third are prose

Per project, the newest five releases, classified by what the extraction actually yields:

| project | prose paragraph | commit-subject bullet | nothing | example of what a row would show |
|---|---|---|---|---|
| bb-plugin-stelow | 0/5 | 5/5 | 0/5 | `* bound the publication reconcile probe (#466)` |
| stelow | 5/5 | 0/5 | 0/5 | `The JTBD skill now answers instead of filling. Every slot carries a status…` |
| gogogo | 0/5 | 5/5 | 0/5 | `* fix(offline): stop promising a queue the browser does not have by @…` |
| ai-credits | 5/5 | 0/5 | 0/5 | `` (`UPDATE … WHERE id=? AND status='reserved'` + `RowsAffected()==0`), então `` |
| ensaiter | 0/5 | 5/5 | 0/5 | `* **credits:** audit real usage on the durable outbox settlement path` |
| degustia | 0/5 | 0/5 | 5/5 | — (its last five tags have no notes at all) |

Three consequences the shape must respect:

1. **A bullet is a takeaway, but a weaker one.** It names the change, not the reason. The row may
   show it; the surface must not call it an explanation.
2. **Prose is not always a clean sentence.** `ai-credits` writes prose in Portuguese and its
   paragraphs arrive as wrapped-line fragments that begin mid-sentence (`(`UPDATE …`), então`).
   Extraction cannot repair that; the row has to tolerate a clipped fragment without pretending it
   is a summary. Content language follows the repository, and the UI copy stays English — the
   takeaway is quoted data, never authored copy.
3. **"Nothing" is legitimate** — 5 of 30 rows, and 225 of 928 tags historically. The row says
   `no notes for this release`, not blank.

### 2.8 Deduplication target is real, and already built

`components/panels/build-panel-view.tsx:357` mounts `FlowStrip` with the board's project filter,
and `FlowStrip` renders finished-card counts, lead/cycle percentiles and a per-card table from
`cards WHERE status='completed'` (`server/runtime/flow-metrics.ts:28-34`). A "recently delivered"
list of finished cards is that strip. The card's own words — *"rather than duplicating delivery
records"* — point at exactly this overlap, so the new axis is **releases**, which the ledger cannot
answer.

### 2.9 The cost rules this slice must respect

- `readTextFile` (`server/cards.ts:279-291`) caps at **200,000 chars** and slices from the front:
  this repo's 231,883-byte file loses its oldest entry, not its newest. Acceptable, and only as a
  fallback — it is a working-tree read (§2.2).
- `bb.sdk.files.read` takes `{hostId?, path, rootPath?, signal?}` — **no `ref`, no offset, no
  length** (`bb-plugin-sdk.d.ts:18134-18139`, `FileReadArgs`), so a tag-scoped read is a git
  subprocess by necessity. (`host.read_file`, the daemon command, does accept a `ref`; the plugin
  SDK's file area does not expose it, so this is not reachable from `server.ts`'s deps today.)
  `server/runtime/board-read.ts:33` shows an arbitrary project path is readable through the SDK,
  so *path* plumbing is not new.
- `server/card-detail-rpc-contract.ts` restricts subprocess reads on the **card** path. The board
  path has its own precedent: `buildFlowMetrics`
  (`server/runtime/wiring/rpc-surfaces.ts:67-80`) already walks every finished card's workspace per
  board call and is fail-soft to an empty `FlowCoverage`. This slice is cheaper than that
  precedent — 166 ms for the whole fleet.
- A `git show` larger than the buffer must read as `unreadable`, never as empty. Largest file today
  is 244,247 B, so the trigger is a project that grows past the bound, not one that exists now.

### 2.10 `parseReleaseTag` is the only version owner, and it has a ceiling

`compareReleaseTags` compares the numeric triple only, so `0.84.1-alpha` and `0.84.1` compare
**equal** (`lib/github-release.mjs:27-35`). That is fine for a *filter* and a *tie-break*, and it
must not be the primary sort (§2.3) or the tag-to-notes match key (§2.1's 225 depends on exact
text, not the triple). Reuse it; do not re-derive semver precedence in a second module.

---

## 3. Hill chart

**Uphill — not settled here, on purpose:**

- **H1 (uphill) — One home, and this card cannot choose it alone.** The board strip is
  project-scoped and single-line; a panel view is fleet-wide; a card section is card-scoped and
  would repeat a project fact (`tests/card-information-hierarchy.test.mjs:34` pins one home per
  fact). Recommended: the board, because it is the only surface that already knows both "one
  project" and "all projects". Interface decides. *The critique has since forced the fleet variant
  to a fixed one-line summary rather than a stacked list (§4, item 4).*
- **H2 (uphill) — What a row is.** Version + date + one takeaway line, or version + bullet list?
  Measured difference: 30 rows × ~100 chars vs 15 KB of bodies (§2.7). Recommended: one line, the
  expansion holds the text.

**Downhill — decided by evidence in this document:**

- **H3 — Time is the axis, version is a tie-break.** §2.3. Same-day ties are the norm, not an edge
  case: 40 same-day groups in this repo (max 36 releases on 2026-09-15), 47 in `stelow`, 31 in
  `ensaiter`, 29 in `gogogo`. Without a version tie-break the sort is unstable and rows swap
  between renders.
- **H4 — Tags are the spine, the changelog is enrichment, and the gap is content.** §2.1. Version
  from the tag (filtered by `parseReleaseTag`), date from the tag, takeaway from the changelog
  entry whose version matches exactly, "documented" as a per-row flag.
- **H5 — A takeaway is extracted, never generated.** §2.7: prose paragraph when the release has
  one, first bullet otherwise, never a model. `docs/decision-routing.md` keeps model-backed
  decisions out of artifact acceptance; a generated takeaway would be a new model surface in a read
  path with no grounding in the file.
- **H6 — Absence has two levels, not four flat states.** Project level: `no repo`, `no tags`,
  `no release record` (a changelog with no parsed heading), `unreadable`, `path missing`. Row
  level: `notes missing`. Eight of fourteen projects are one of the first three; the taxonomy
  cannot be one dropdown (§critique-data-system, resolved).

---

## 4. Proposal

### Problem

An operator supervising six release-bearing projects has to leave bb, `cd` into each repo, and
read `git log` / `CHANGELOG.md` to answer "what shipped lately, and what was it about". The board
answers "what finished" from the ledger (`FlowStrip`), and the ledger cannot answer "what shipped"
because releases live in git and the plugin never reads them (§2.8).

### Solution

One project-scoped read of the release record, and one surface that names it.

1. **`lib/project-releases.mjs`** — pure: fold tag rows + changelog text into release rows
   (`version`, `day`, `documented`, `takeaway`, `source`), compute the undocumented gap and the
   notes-ahead case, select the window, render the one-line summary. Reuses `parseReleaseTag` for
   filtering; version text is the match key; never re-implements version order.
2. **`server/runtime/project-releases.ts`** — a strict sibling git reader (two commands, §2.6),
   project root via `projectRoot` (`server/runtime/root-paths.ts:36-49`), one typed state per
   project, bounded parallel fan-out over the fleet, per-command 10 s timeout, 4 MiB buffer,
   aggregate 15 s deadline; an unanswered project reads `unreadable`, never `no releases`.
3. **RPC `projectReleases`** — `{ projectId: string | null }`, `null` meaning the fleet, so one
   handler answers both the project-filtered board and the all-projects board. Zod-validated
   result; per project `{ projectId, name, state, newest: {version, day, documented, takeaway} |
   null, releases: row[], undocumentedCount, notesAhead }`; `day` is `YYYY-MM-DD` derived from the
   tag's own timestamp. Fail-soft to a typed state, never to `[]`.
4. **Board surface** — a fixed one-line strip. Project selected: the newest release with version
   and day. No project selected: the newest release across the fleet plus how many projects
   shipped, never a stacked list. Opening it reveals the last five rows per project. It renders a
   muted placeholder at fixed height from first paint, and it is independent of `FlowStrip`'s
   `count === 0` guard (`components/board/flow-strip.tsx:44`). Closed by default:
   `startsOpen({live, blocking})` (`components/disclosure.tsx:72`) is false for a settled list.
5. **`FEATURES.md`** entry with the measured behaviour, plus the blueprint proposal AGENTS.md owes
   for any new user-facing pattern (separate upstream commit).

### Dangers (concrete failure modes, each with a measured trigger)

| # | Failure | Trigger (measured) | What the design does |
|---|---|---|---|
| D1 | The view confidently reports an old release | 4 of 6 changelogs stop before the newest tag; 3 checkouts are behind by commits, this one by 76 | read the blob at the tag, never the working tree; fall back to the working tree only when there are no tags, and say so |
| D2 | Ordering hides the newest releases | `stelow` carries a `v1.x` line (Aug–Sep) and a `v0.8x` line (Oct) | sort by tag date; version is the tie-break only |
| D3 | A "recent" list omits releases that shipped | `degustia` documents 3 of its newest 10 tags; 225 of 928 tags have no entry at all | tags are the spine; the undocumented count is shown, not dropped |
| D4 | Empty release bodies, blank takeaways | semantic-release dialect: `## What's Changed` inside the body | split at the next *release* heading, not the next `## ` |
| D5 | `archive/stash-0` rendered as a release | 13 non-semver tags across 4 repos | filter with `parseReleaseTag`; test pins `dev → null` |
| D6 | Rows reorder between renders | 40 same-day groups here, one date with 36 releases | stable sort: date desc, then version desc |
| D7 | An unreadable repo reads as "no releases" | `runGitIn` collapses every failure (`git-evidence.ts:61-79`); eight projects have nothing at all | typed states at two levels; test asserts `unreadable ≠ no-releases` |
| D8 | The board slows down | 374 ms serial fleet read, 166 ms parallel; a cold drawer read is 280 ms per project | parallel fan-out, lazily-opened blob reads, no per-row subprocess |
| D9 | A second "delivered" claim appears on the board | `FlowStrip` already renders finished cards from the ledger | releases only; the summary never restates card counts |
| D10 | Wrong notes attached to a tag | `0.84.1-alpha` and `0.84.1` compare equal under `compareReleaseTags` | exact normalized string match on the version text; comparator used only to filter and tie-break |
| D11 | The newest note is missed because of where it sits in the file | 4 of 6 changelogs are not strictly descending; `ai-credits` puts `0.1.1` above `0.4.1` | rows are selected by version match, never by heading position |

### Out of scope (stated, not implied)

GitHub Releases API (no token; 60 req/h/IP unauthenticated), model-written takeaways,
per-release drilldown (tag diff, commit list), a CLI verb, persistence in SQLite,
notifications/digests, projects sourced from another host (all 14 are local today),
multi-version-line detection, backfilling the 225 undocumented changelog entries, and any UI for
the seven projects that are not repos.

---

## 5. OUT/IN Scope Table

| IN scope | Outcome | Trade-off (what is sacrificed, and why) |
|---|---|---|
| 1. `lib/project-releases.mjs` + node test | Parser/selector/formatting with a unit test per dialect, per absence state and per refusal | The parser is a *display* grammar, not a spec of changelog format. An unparsed heading is invisible rather than guessed — cost: a project inventing a fifth dialect shows fewer rows, and says `no release record` |
| 2. Strict git sibling reader | `for-each-ref` + `show` at a project root, typed failures, bounded timeout/buffer | A second git runner lives beside `runGitIn` instead of inside it. Cost: two places run git; benefit: five card surfaces keep their fail-soft contract untouched (§2.6) |
| 3. RPC `projectReleases` | One call answers one project or the fleet | Fleet rows are computed on every board render (166 ms, §2.6). Cost: no cache in v1; the alternative was a cache-invalidation problem for data (tags) that genuinely does not mutate |
| 4. Board one-line strip + expansion | The reader sees the newest release per project and the last five with takeaways | Adds one strip to the board. Cost: the board grows a third band, so the fleet variant is fixed-height and never lists projects inline (critique: no vertical budget otherwise) |
| 5. `FEATURES.md` + owed blueprint | The feature exists in the inventory and the pattern is portable | Documentation work in the same commit. Cost: a second upstream commit; skipped only by breaking AGENTS.md's rule |

| OUT scope | Why it is out | Revisit trigger |
|---|---|---|
| GitHub Releases API | Auth-free read is 60 req/h/IP; no token configured; only covers GitHub-hosted projects | A project whose notes live only in GitHub Releases, or a token in `~/.secrets/` |
| Model-written takeaways | New model in a read path, ungrounded by the file; policy keeps model decisions off artifact surfaces | A human asks for a summary *of* the takeaways, in a separate generation feature |
| Per-release drilldown (diff, commits) | The fastest way for a Lean slice to become a history browser | A reader cannot act on a one-line takeaway |
| CLI verb (`bb stelow releases`) | The UI is the requested surface; the `lib/` module makes the verb cheap later | An agent needs it without opening the panel (§7.1) |
| SQLite persistence | Tags are the source; a table would be a second truth with an invalidation problem | Ordering/search across 300+ releases per project |
| Notifications/digests | Different product: "tell me when" rather than "show me now" | Release cadence drops and the operator asks to be told |
| Remote-host project sources | All 14 projects are one host today; `projectRoot` returns a path, not a host | A project sourced from another machine |
| A row for a documented release with no tag | `ai-credits` documents `0.4.1` with no tag; showing it needs a rule for "notes ahead of tags" | The spec decided: the summary states `notes ahead`, no extra row |
| Changelog backfill (225 entries) | A docs task for six repos, not a view | Someone asks why the gap is large |

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
  would ship in a day. Rejected: four of six changelogs stop before the newest tag — the panel
  would report `0.87.0` while `v0.99.0` shipped that morning, on the operator's own machine (§2.2).
- **D. Tag spine + changelog enrichment (recommended).** Correct for all six projects, shows the
  gap instead of hiding it, and costs 166 ms for the fleet.
- **E. Extend the existing `board` RPC instead of adding one.** `loadBoard` already resolves the
  root and reads project files (`server/runtime/board-read.ts`), so it looks free. Rejected: it
  puts a subprocess on the board's hot path, which every board render already pays for; a separate
  call lets the surface fetch lazily and keeps `board` a pure file read.

---

## 7. Unanswered questions

Answered by the spec after the first pass, kept here with the answer so the evidence and the spec
do not drift:

1. **Whose "orchestrator"?** The done-clause says "the orchestrator sees recent releases per
   project". In this codebase that word names the *agent*; the parent card's title ("painel") and
   `uiScopePresent: true` name the human. **Settled:** the human, on the board; the `lib/` module
   keeps an agent consumer cheap later.
2. **Home.** Board strip vs a tab in the Flow surface vs a panel view. **Settled:** the board, as
   a fixed one-line strip with an on-demand expansion (H1, critique composition).
3. **Whether an untagged documented release is a row.** `ai-credits 0.4.1` is real work with notes
   and no tag. **Settled:** no row; the project reports `notes ahead` so the gap is visible.
4. **Window.** Last five (recommended), last 30 days (dozens of rows for this repo alone), or
   "since 90 days". The fleet's cadence varies 20×, so one window cannot fit all six. **Settled:**
   the last five, with the undocumented count beside it.
5. **Takeaway length.** One line vs two. Measured: prose is 70–100 chars when present, so one line
   fits; a clamped two-line block is a density choice, not a data choice. **Settled:** one line.
6. **Whether the fleet view lists silent projects.** Eight of fourteen have nothing. **Settled:**
   the strip states how many projects have no release record; it never lists them inline.

Still open, and genuinely for Interface: whether the expansion is an overlay panel or a tab inside
the existing flow surface. Both keep the kanban visible; only one reuses `FlowStrip`'s shell.

---

## 8. Rabbit holes (timeboxed, must not become scope)

- **R1 — Semver precedence.** Prerelease ordering (`alpha.2` vs `alpha.10`), ranges, `+build`.
  *Timebox:* none. Use `parseReleaseTag` for filtering and date for ordering; the ceiling is
  documented in §2.10 rather than fixed.
- **R2 — Version-line detection.** `stelow`'s `v1.x` and `v0.8x` lines could be annotated ("line
  changed"). *Timebox:* one spike. Default: show what the tags say, sorted by date; no inference.
- **R3 — GitHub Releases merge.** See alternative A. Default: OUT; revisit with a token.
- **R4 — Changelog dialect autodetection.** *Skip.* One regex, per heading, measured on 709
  headings (§2.4). Autodetection would be a second parser.
- **R5 — Caching and invalidation.** *Timebox:* none. Keyed memo of the per-tag blob, nothing
  more; a tag key cannot go stale.
- **R6 — Very large changelogs.** A `git show` over the buffer bound must read as unreadable
  (§2.9). *Timebox:* one spike on a head-bounded read. Default: raise the bound in the strict
  reader only if a project crosses it.
- **R7 — Takeaway cleanup.** Stripping PR links, bullet markers and commit hashes improves the
  row; repairing wrapped-line fragments or translating Portuguese prose does not belong in a read
  path. *Timebox:* one pass over the six files; stop at "readable in one line".

---

## 9. Definition of Done (Product)

- [ ] With a project selected, the board shows that project's newest release — version **and**
      date — without leaving the app and without running a git command by hand.
- [ ] With no project selected, the board shows one line naming the fleet's newest release and how
      many projects have a release record, and states how many have none.
- [ ] Opening the surface lists the last five releases per project, each with a takeaway taken
      from the release's own text.
- [ ] A tag newer than the documented release is visible as a gap, never hidden.
- [ ] A project with no repo, no tags, no parsed release record or an unreadable read says which
      of those it is.
- [ ] No row changes position between two renders of unchanged data.

## Acceptance Criteria

1. **Given** a repo whose checkout is behind its tags, **when** the board renders that project,
   **then** the newest release shown is the newest *tag*, not the version the checkout claims.
2. **Given** `stelow` (a `v1.4.5-alpha` tag dated 12 Sep and a `v0.86.0-alpha` tag dated 27 Oct),
   **when** the last five are listed, **then** 27 Oct is the first row.
3. **Given** `degustia` (tags to `v0.7.0`, notes stop at `0.2.1`), **when** its summary renders,
   **then** the gap of 7 undocumented tags is stated.
4. **Given** `ai-credits` (notes document `0.4.1`, newest tag `v0.4.0`), **when** its summary
   renders, **then** the row does not claim `v0.4.0` is the newest documented work.
5. **Given** a project whose changelog uses `## What's Changed`, **when** its newest five are
   parsed, **then** no row has an empty body.
6. **Given** a repo with `archive/stash-0` tags, **when** the spine is built, **then** they are
   absent from the list.
7. **Given** a project path that is not a git repo, **when** the fleet renders, **then** that
   project reads `no repo`, not `no releases`.
8. **Given** 36 releases sharing one date, **when** the list is sorted twice, **then** the order is
   identical both times.
9. **Given** `ai-credits`' changelog (`v0.1.1` on the first heading, `v0.4.1` second), **when** the
   newest documented release is computed, **then** it is `0.4.1` — not the first heading.

---

## 10. `appetite_fit` — `fits` (Lean), as an estimate

| Check | Result |
|---|---|
| IN scopes | 5 |
| Hill decisions | 6 (2 still uphill: home, row unit) |
| Distinct surfaces added | 2 — one RPC, one board component |
| New `lib/` modules | 1 (+1 node test) |
| Highest-risk item | H1 (home) — because it is Interface's, not because it is large |
| Measured cost | 166 ms fleet read, 8 ms warm / 280 ms cold per-project blob, 0.4 ms parse |

Nothing here is cut for seeming complex: the parser is one regex, the reader is two commands, the
component is one line plus one expansion. `fits` is an estimate, not a promise. The one expansion
that would break Lean is named: per-release drilldown (tag diffs, commit lists), which is OUT. If
Interface asks for it, `appetite_fit` becomes `cuts_needed` and the cut is that drilldown, not the
substrate.

---

## 11. Evidence hygiene

- Every code fact carries `path:line`, read at `68849b42` on 2026-10-28. Every fleet number was
  executed against `bb project list --json` and the six repos on this host.
- **Re-measured, not inherited:** the fleet table (§2.1), the working-tree staleness (§2.2), the
  tag/date fork (§2.3), the 709 parsed headings and the ordering inversions (§2.4), the takeaway
  split (§2.7), the same-day tie counts (§3 H3), and the timing range (§2.6).
- **Corrections against the lost first pass are named in §1.1** — undocumented count, takeaway
  composition, timing range, and the heading count that the first pass under-reported.
- **Perishable numbers:** §2.1 (which checkouts are behind) and §2.2 (tag counts) move with every
  release; §2.5's non-semver list moves whenever someone tags a backup. Re-measure §2.1 before
  committing to a plan — it is the claim the whole trust argument rests on.
- **Not edited:** `state.md`, gates, completion state — out of scope for this task by instruction.
  `plans/spec-product.md` exists (v2) and belongs to the coordinator; it is read here, not rewritten.
- **Not surveyed:** external or product-side evidence about release dashboards. Nothing here is a
  claim about what other tools do; every number is from this host.
- **No fabrication:** where a question is open (§7, last paragraph), this document says it is open;
  where a claim came from setup rather than my own run, it is not cited as mine.

---

```
stage          : shape
description    : Retry of the shaped slice B — a project-scoped release read (tag spine +
                changelog enrichment) with a fixed one-line board strip and an on-demand
                expansion. Re-executed the fleet: 14 projects, 6 with a release record, 3 of 6
                checkouts behind their tags, 48/60 newest releases documented at the tag vs 30/60
                at HEAD; ordering is by tag date because version order hides six weeks on stelow;
                takeaways are extracted, never generated (10 prose / 15 bullet / 5 none in the
                newest-five window); five IN scopes, `appetite_fit: fits`.
status         : done
artifacts      : runs/exec_w1ti53qw/recon/shape.md
inputs         : runs/exec_wfurtsri/recon/setup.md,
                .stelow/2026-10-10/sw-card_t804npi7/state.md (parent triage, frontmatter only),
                .stelow/2026-10-10/sw-card_rbkbfyqy/session.log,
                .stelow/2026-10-10/sw-card_rbkbfyqy/plans/spec-product.md,
                .stelow/2026-10-10/sw-card_rbkbfyqy/critiques/,
                runs/exec_hvew3r95/recon/shape.md (lost first pass),
                docs/decision-routing.md
next-candidate : critique
gate           : none
rework-on      : shape
```
