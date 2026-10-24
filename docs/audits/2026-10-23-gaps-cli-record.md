# `bb stelow gaps` — a read-only view over the gap registry

**Type:** feature record for the brief of 2026-10-23 ("`bb stelow gaps`: a
read-only view over the gap registry").
**Branch:** `bb/cli-bb-stelow-gaps-thr_b8w4gjktr6` (the worktree BB opened for
this thread; the brief's `feat/cli-gaps-2026-10-23` was already checked out in
another worktree, so the thread used its own).
**Base:** `origin/master` `0f665fd5`.
**Nothing was pushed, merged, tagged or released.**

## 1. The command surface

```
bb stelow gaps [--card <card_id>] [--area <glob>] [--status documented|escalated] [--json]
```

Registered like every other verb: one entry in the advertised catalog
(`server/runtime/cli-registry.ts:123`) and one family in the dispatch table
(`server/runtime/cli/cli-dispatcher.ts:45`). The family returns `null` for a verb
it does not own, so exactly one family answers `gaps` — the existing
`runtime-cli-commands` test proves that for the whole table without being
touched.

Measured against a fixture of two cards (3 documented + 1 escalated finding):

```console
$ bb stelow gaps                                     [exit 0]
Gaps: 4 total · 0 fixed · 3 documented · 1 escalated (25% escalated)
Cards: 2 read
Areas: 2 · 4 shown

cli/argv — 1 documented / 1 escalated
  documented  card_48uuhus1  the fleet view has no area filter
  escalate    card_oqm8gyae  gaps cannot be grouped by area

tests/docs-index — 2 documented
  documented  card_48uuhus1  docs-index.test.mjs walks docs/ non-recursively
  documented  card_oqm8gyae  declaration-drift cites a record that does not exist

$ bb stelow gaps --status escalated                   [exit 0]
Gaps: 4 total · 0 fixed · 3 documented · 1 escalated (25% escalated)
Cards: 2 read
Areas: 1 · 1 of 4 shown (--status escalated)
```

Decisions inside that surface, each one where a view could lie:

- **The header counts what was READ, the third line counts what is SHOWN.**
  A filtered view says `1 of 4 shown (--status escalated)` instead of printing
  `1` and letting a reader conclude the fleet has one finding.
- **No thread-card default.** `--card` wins, and without it the scope is the
  fleet (every non-archived Build card). `metrics` falls back to the calling
  thread's card; that would answer "what has been flagged in this area" with the
  caller's own card while looking fleet-wide, so this command follows `storage`
  (`--card` only) instead. An archived card drops out of the default scope; an
  explicit `--card` still names one.
- **`--area <glob>`** is `*`-only wildcard matching over the registry's own
  `area` field, exact otherwise. A pattern that matches nothing shows
  `0 of 4 shown` and exits 0.
- **`--status` accepts `documented|escalated`.** `fixed` is a third resolution in
  the registry and appears in the tally (`0 fixed`), never as a row: a settled
  finding is not a flag. Anything else is a usage refusal (exit 2) naming both.
- **`--json`** carries `read {cards, withoutCritique, only}`, `filter`, `tally`
  (every finding read, whatever the filter hid), `shown`, and `areas[]` with each
  group's own `tally` and `rows`.
- **Exit 0 whenever the read succeeded**, including zero rows and zero matches.
  Exit 2 is reserved for usage and `Unknown card` — the same refusals every
  card-scoped family shares (`server/runtime/cli/cli-contract.ts`).

## 2. Reuse points (nothing new is a mechanism)

| What | Where | Role |
|------|-------|------|
| `parseGapFrontmatter` | `lib/gap-registry.mjs:63` | parses the `gaps:` frontmatter — unchanged |
| `registryGaps` | `lib/gap-registry.mjs:185` | the per-document finding list; now carries `area` |
| `tallyGaps` | `lib/gap-registry.mjs:214` | **new**: the one counting of a finding list; `summarizeGaps` (`:231`) folds it |
| `createCritiqueGapState` | `server/runtime/critique-gap-state.ts:212` | the only reader of critique artifacts; the CLI injects it as `deps.gapState` |
| `addRegistryGaps` | `server/runtime/critique-gap-state.ts:99` | dedupes a finding across a card's critique documents; now passes `area` through |
| `formatGapTotals` | `lib/metrics-format.mjs:60` | the header's tally wording, not re-spelled |
| fleet query | `server/runtime/cli/cli-gaps.ts:79` | the same `SELECT … kind = 'build' AND status != 'archived'` as `cli-metrics.ts` |
| filter / grouping / report | `server/runtime/cli/cli-gaps.ts:117`, `:127`, `:138` | the whole view; 201 lines, no function over 50 |

Two small additions to existing owners, both additive:

- `registryGaps` rows gained `area` (it already parsed the field and dropped it),
  and `critique-gap-state`'s gap rows carry it. The CLI never parses a document:
  there is no second reader, and `docs/`'s own `area` values
  (`tests/docs-index`, `docs/README.md`, …) group as written in the fixture from
  a real card's audit.
- `tallyGaps(rows)` counts a list. `summarizeGaps` was the only counter and it
  counts the rows of **one document**; a finding list is a different list.

`lib/gap-registry.d.mts` gained `GapRow`/`GapTally` and the new export in the
same commit, so a `.mjs` imported from TypeScript keeps its types.

## 3. The three red proofs

`tests/runtime-cli-gaps.test.mjs` (wired into `test:cli-runtime`, no new band).
It drives the **real** `createCritiqueGapState` over real state dirs and real
critique documents in a temp tree — a fake gap state would prove the formatting
and nothing about the reading.

### 3.1 Zero rows is not the same as zero found

Fixture: `card_a` documents two findings, `card_b` documents one and escalates
one — 3 documented, 1 escalated across two cards.

| Assertion (line) | Statement |
|---|---|
| `149` | `3 documented findings were read` |
| `150` | `1 escalated finding was read` |
| `156` | `--status escalated lists exactly the one escalated finding` → `1` |
| `161` | `--status documented lists the three documented findings` → `3` |
| `162` | `a documented view still knows an escalation exists` → tally stays `1` |
| `165` | header matches `Gaps: 4 total · 0 fixed · 3 documented · 1 escalated` |
| `170` | `Areas: 1 · 1 of 4 shown (--status escalated)` — the view names what it hid |

**Red proof** — `statusMatches` replaced by `return resolution !== "fixed"` (the
filter ignored):

```
AssertionError [ERR_ASSERTION]: --status escalated lists exactly the one escalated finding
4 !== 1
```

Restored, the same file passes. That is the brief's second reading: with the
filter disabled, "escalated" reports 4.

### 3.2 An orphan state directory is not a card

`card_orphan/` holds a fully valid registry (two documented, one escalated) and
a `state.md` registering it — the control that the fixture would count if
anything enumerated directories — and no card row.

| Assertion (line) | Statement |
|---|---|
| `183` | `the orphan is a real registry` (3 gaps parsed from the file on disk) |
| `184` | `an orphan directory is never read` — no read path mentions it |
| `185` | `the orphan adds nothing to the tally` (`documented + escalated === 4`) |
| `186` | `an orphan is not reported as a broken card` (no `Unknown card`) |

**Red proof** — the fleet enumeration replaced by a directory scan that
attributes every unclaimed directory as a card (the shape of the export bug the
brief reports as 15 `Unknown card` lines across 42 directories; this
repository's own committed bundles show 4 orphan dirs across 11, per
`2026-10-23-final-gaps-record.md` §4.2):

```
AssertionError [ERR_ASSERTION]: 3 documented findings were read
6 !== 3
```

The two directories without a row in this fleet (the orphan, and the duplicate
card's workspace, which the same test scopes out with `--card`) enter the tally.
Restored, the total is 4 again.

### 3.3 It writes nothing

The fixture root is a real git repository, initialised **before the first
invocation** — and that ordering is the proof's own near-miss: the first version
committed the fixture after assertions 1–2 had run, so a mutating read was
captured as baseline and `git status` stayed clean. The check now covers every
invocation in the file.

| Assertion (line) | Statement |
|---|---|
| `191` | `no invocation above wrote into the fixture repo` (`git status --porcelain` empty) |
| `196` | `the view never calls write` — also `mkdir`, `updateCard`, `comment`, `inbox` |

**Red proofs**, two mutations, one per surface:

```
# fs write inside the card workspace
AssertionError [ERR_ASSERTION]: no invocation above wrote into the fixture repo
+ '?? card_a/.stelow/gaps-read.json\n?? card_b/.stelow/gaps-read.json'
- ''

# write through the host file API
AssertionError [ERR_ASSERTION]: the view never calls write
+ [ [ 'write', { content: '{}', path: 'gaps-read.json' } ] ]
```

Both restored (`sha256sum` checked against a pre-mutation copy); green again.

## 4. The trailer: one key, one owner, one shape

### 4.1 What was wrong

`buildArtifactTrailer` appended `Stelow-Gaps: …` **only when** a critique
matched. Measured across the eleven committed bundles under `docs/runs/`, six
carry the line and five carry none — `card_oqm8gyae` says `Stelow-Gaps: 3 fixed
/ 15 documented / 0 escalated` while `card_kwbdqy8f` and four others say only
`Stelow-Artifacts: 0`. Two shapes for one field, where absence could mean "no
gaps" or "nobody audited".

There was a second, quieter defect under it. That line counted registry **rows**
(`summarizeGaps`, per document); the card's own finding list dedupes across
documents. The measured card `card_wxpaf8ll` writes the same three findings into
`report.md`, `evidence.md` and `requirements.md` — 9 rows, 3 findings — so the
trailer said `9 documented` above a list of three. Two accountings of one field,
one level down from the defect `bbd6d497` fixed.

### 4.2 The decision

- **One key, always present:** `Stelow-Gaps`, emitted by
  `buildArtifactTrailer` (`lib/artifact-manifest.mjs:150`) through the single
  `gapTrailerLine` (`:170`) — for `manifest`, `export`, `done`, the bundle's
  embedded trailer and `docs/runs/<card>/manifest.md`.
- **One shape:** `N fixed / N documented / N escalated`.
- **One owner for the numbers:** `tallyGaps(gapState.gaps)` — the deduped
  finding list, the same list `bb stelow gaps` lists and tallies.
  `cli-manifest.ts:74` and `cli-bundle-writer.ts:363` both pass that, so the
  commit, the bundle and the command cannot disagree.
- **Unread is named, not zeroed:** a card with no readable critique prints
  `Stelow-Gaps: no execution critique registered`, one constant (`NO_CRITIQUE`,
  `lib/artifact-manifest.mjs:164`) shared with the bundle's `## Gaps` section.
  A zero there would be the same lie as `Stelow-Artifacts: 0` over a `## Missing`
  list.

### 4.3 The delta that must differ, named

`gapState.totals` (`summarizeGaps`) still counts **rows per document** and still
drives the card header, the fleet metrics and `gap-scopes`. It is not the same
number as the finding tally, and the trailer now says which one it is: findings.
Moving `totals` would move the card, the board and the fleet at once — a separate
change with its own evidence, so it was left alone and the delta is pinned
instead: `tests/runtime-cli-gaps.test.mjs:206` builds a card whose one finding is
written into **two** documents and asserts `Stelow-Gaps: 0 fixed / 1 documented /
0 escalated`, with `bb stelow gaps --card` reporting the same single finding
(`:207`). A card nobody audited is the sentence, not a zero (`:212`).

## 5. Gates (exit codes)

| Gate | Exit | Output head |
|------|------|-------------|
| `npm run typecheck` | 0 | `tsc --noEmit` |
| `npm run quality:shape` | 0 | `source shape ok: 10 source file(s) …, no changed line over 160 characters`; `source budgets: … cli-bundle-writer.ts:writeBundle#1: 65 lines (baseline 65)`; `lint ok: 39 finding(s), all inherited` |
| `npm test` | 0 | full suite, ends `upstream drift check ok: vendored tree matches pin 81f4505da0c4` |
| `node --experimental-strip-types --import ./tests/register-ts-source.mjs --test tests/runtime-cli-gaps.test.mjs` | 0 | `gaps cli test ok: shown vs read, orphans ignored, nothing written, one trailer record` |

## 6. What I did not do, and why

- **Did not re-derive `gapState.totals` from the deduped list.** That number is
  the card header's and the fleet's; changing it moves three surfaces at once
  (§4.3). The delta is named and pinned instead.
- **Did not add `--status fixed`.** The trailer counts fixed findings; the view
  does not list them, because a settled finding is not a flag. A refusal with no
  door was avoidable anyway: `--json`'s `tally.fixed` is the count, and a fixed
  row is visible on its own card.
- **Did not enumerate state directories, not even to report orphans.** A view
  over cards cannot report a directory it never enumerates; that cleanup is a
  human-approved `rm`, named in `2026-10-23-final-gaps-record.md` §4.2.
- **Did not touch the twenty committed bundles under `docs/runs/`.** They are
  evidence of what the older code emitted, including the two shapes this change
  ends.
- **Did not add a table, a schema, a migration, a dependency or a UI surface.**
  The brief's other two gap ideas were rejected on purpose: a zero-gaps floor
  changes a contract that was just stabilised, and capturing gaps earlier
  duplicates a schema across stages.
- **Did not build or reload the plugin.** A feature branch is not a deployment,
  and `npm run build:reload` would swap the plugin for every live thread on this
  host. `npm test` and the gates above are the evidence; the bundle is the
  releasing PR's job.
- **Did not edit `skills/` or `data/stelow`.** No sync was run.
- **No full-repo lint** — the changed files were linted directly (39 inherited
  findings, none new) and the shared-host hazard in `AGENTS.md` stands.
