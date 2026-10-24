# Final gaps, 2026-10-23 — four pendings, a floor, a door, and two absences

**Type:** fix/feature record for the brief of 2026-10-23 ("four pendings, the
script-count guard, and the docs that stop repeating today").
**Branch:** `bb/final-gaps-rebase-guard-door-docs-thr_uc2scxqk54`, based on
`origin/master` `4f21e4e4`.
**Commits:** `f169e46f` (the band floor), `0103c018` (the contrast door),
`bbec7312` (the docs page), then this record.
**Nothing was pushed, merged, tagged or released.**

## 1. The merge that would have amputated the suite (PR #420)

### 1.1 What the numbers actually were

| Reading | Branch side | Master | After the resolution |
|---|---|---|---|
| `"test:` scripts in `package.json` | **87** | **88** | **88** |
| `test:contrast-wiring` in the `test` aggregate | absent | present | present |
| `tests/artifact-count-owner.test.mjs` referenced | present | absent | present |
| `tests/suite-wiring.test.mjs` | — | green | green (540 files wired) |

The brief said the branch carried **82**; the branch head (`dbef66e5`, the PR's
own head) carries **87**, measured with `git show <ref>:package.json | grep -c
'"test:'`. Master's 88 is the brief's number and matches. The conclusion does not
change — the branch side loses a band — and the difference is reported rather
than smoothed: the "82" is 88 minus six, and master had gained exactly one band
since the fork, so 87 is what a reader can reproduce today.

### 1.2 The resolution

Done in a scratch worktree (`~/tmp/one-owner-rebase-fix`) on a local branch
`fix/one-owner-2026-10-23-rebased`; PR #420's own branch was not rewritten.

1. `git rebase origin/master` → two conflicts: `package.json` and
   `docs/audits/README.md`.
2. `package.json`: **master's file, wholesale** (`git show
   origin/master:package.json`), then the branch's own reference re-added —
   `tests/artifact-count-owner.test.mjs` inserted into `test:artifacts` after
   `run-bundle.test.mjs`, where the branch had put it. The branch added no band
   of its own, so the count stays 88 rather than 89.
3. `docs/audits/README.md`: **both sides kept** — master's two new entries plus
   the branch's `2026-10-23-one-owner-record.md` entry. This conflict was not
   about a fact, only about a list.
4. Rebased commit `d1b43a72`; `tests/suite-wiring.test.mjs` green in that
   worktree (540 test files); the branch's own two tests green
   (`artifact-count-owner`, `gap-registry`).

The brief called this "the branch's own two test references"; measured, the
branch contributes **one** file-level reference (`artifact-count-owner`) plus the
`test` aggregate line that must keep master's `test:contrast-wiring`. Both were
restored; `test:contrast-wiring` is the one a branch-side resolution silently
deletes.

### 1.3 The guard — `lib/test-script-floor.mjs`

`TEST_SCRIPT_FLOOR = 88`; `assertTestScriptFloor(scripts)` refuses a package.json
with fewer `test:` scripts, naming both numbers and how many bands went missing.
`tests/test-script-floor.test.mjs` reads the real file, asserts the floor equals
the live count (so it cannot lag), deletes one band from a **fixture copy** on
disk, and refuses a malformed manifest. Wired into `test:source-budgets` — no new
band, so adding it did not move the number it guards.

### 1.4 Red proofs (both run, both restored byte-identical)

| Mutation | Assertion |
|---|---|
| `test:board-mermaid` deleted from the real `package.json` | `suite-wiring`: **green** (`540 test files wired`) — it is the blind spot, because the file is also named by `test:artifacts`. Floor: `Error: package.json declares 87 "test:" scripts, below the recorded floor of 88 — 1 CI band(s) went missing.` |
| The branch side of the conflict, applied wholesale (87 bands) | Floor: the same refusal, `87` vs `88`. |

One measured correction to the brief: with **today's** test files, taking the
branch side of the whole file also makes `suite-wiring` fail (`unwired:
answer-premise-staleness, contrast-artifact, contrast-asks`) because those three
are named only by `test:contrast-wiring`. The structural claim still holds and
is what the floor closes: a band whose files are also named elsewhere can vanish
without a word, and 8 bands on this tree are in exactly that position (`test:fast`
with 6 files, `test:behavioral` with 8, `test:board-mermaid`, `test:reconciler`,
`test:worktree-storage`, `test:metrics-contract`, plus two name-only bands).

Restoration was verified with `sha256sum -c` against a pre-mutation copy.

## 2. The door: a live card asks a derived question

### 2.1 Where, and why there

`server/runtime/card-detail.ts` → `loadDetailInputs` is the moment the host reads
a card's state-dir documents for a person, so it is the first moment
`contrast-matrix.md` is parsed at all. `server/runtime/card-detail-contrast.ts`
(a sidecar, so the detail file stays at 362 of its 400-line budget) reads the
artifact and calls `lib/contrast-ask-door.mjs`, which parses the matrix through
the existing `recordContrastAsks` path.

- The question lands in the **existing** derived-ask registry (`ask_contracts`)
  and is answered through the **existing** answer door, which matches it by
  question text. No new table, verb, RPC or UI surface.
- `premise` is mandatory end to end: `recordDerivedQuestions` refuses a row
  without one, so a blank cell always produces a question that names itself.
- **One row per question text per card.** The matrix is read on every detail
  open; the answer door can only consume the earliest row for a text, so a
  second identical row would be a wait nobody can end. `recordContrastAsks` now
  skips a text already recorded for the card; a new hole (new premise, new text)
  lands normally, and a rewritten matrix does not reopen an answered hole.
- **A malformed matrix is a rollback, not a partial ask.** The artifact's own
  validation throws before any row is written, the detail catches at the I/O
  boundary and still renders the card — a worker's broken document costs the
  questions it implies and nothing else.

### 2.2 Red proof

| Mutation | Result |
|---|---|
| `await recordContrastQuestions(...)` removed from `loadDetailInputs` | `not ok 1 - a blank cell becomes one open question whose premise is that cell` (`actual: 0, expected: 1`); `not ok 2` likewise. A matrix with one blank cell recorded **zero** questions. |
| Restored | Exactly **one** row; `premise = "cart|paid"`; `consumed_at` null; the question text is the model's (`cart offers nothing in state paid`), not a re-phrasing. Reopening the detail twice still leaves **one** row. |

The handler test runs against a real SQLite database built by
`runPluginMigrations`, a real card row, and a real state dir on disk
(`tests/card-detail-contrast.test.mjs`); the library half
(`tests/contrast-ask-door.test.mjs`) proves one question per blank cell, no
question without a matrix, no second row on a re-read, a new question for a new
hole, and a refusal (not an all-blank reading) for a document with no matrix
fence.

## 3. The nine `gaps:` rows of `card_wxpaf8ll`

The card's state dir is `/home/deploy/repos/bb-plugin-stelow/.stelow/2026-10-23/
sw-card_wxpaf8ll`; the three audit documents under `runs/exec_a02ul1ax/audit/`
each carry the **same three gaps** in their frontmatter — nine rows, three
distinct findings (the audit stage writes one registry into all three files).

| # | Document | Type | Area | Impact | Effort | Still true on `4f21e4e4`? |
|---|---|---|---|---|---|---|
| 1 | `report.md` | debt | `tests/docs-index` | medium | moderate | **yes** — `tests/docs-index.test.mjs:39` walks `docs/` non-recursively |
| 2 | `report.md` | drift | `docs/README.md` | low | trivial | **no** — no counted numeral remains (the index is a bullet list) |
| 3 | `report.md` | stale-reference | `tests/declaration-drift` | low | trivial | **no** — `docs/audits/2026-10-23-scope-8-record.md` exists on master |
| 4 | `evidence.md` | debt | `tests/docs-index` | medium | moderate | **yes** (same finding) |
| 5 | `evidence.md` | drift | `docs/README.md` | low | trivial | **no** (same finding) |
| 6 | `evidence.md` | stale-reference | `tests/declaration-drift` | low | trivial | **no** (same finding) |
| 7 | `requirements.md` | debt | `tests/docs-index` | medium | moderate | **yes** (same finding) |
| 8 | `requirements.md` | drift | `docs/README.md` | low | trivial | **no** (same finding) |
| 9 | `requirements.md` | stale-reference | `tests/declaration-drift` | low | trivial | **no** (same finding) |

### Which are worth routing, and which are honest debt

- **G1 — `docs-index-recursion` (rows 1/4/7): worth one follow-up scope.** The
  guarantee the card established (every audit record is named) is still
  unguarded in CI; the audit's own recipe is recursive walk, skip the
  directory-local `README.md`, exclude `docs/runs/`, and prove an unindexed
  fixture red.
- **G2 (rows 2/5/8) and G3 (rows 6/9): honest debt — and now settled debt.**
  Neither is real any more: the numeral is gone, the cited record landed. They
  should not be re-routed, and re-opening them would create work for a state
  that no longer exists.
- **The command would do nothing today, and that is the trap worth naming.**
  `bb stelow gap-scopes` converts **escalated** rows; this card's
  `execution/gap-escalation.json` records `escalated: []` and all three rows are
  `resolution: documented`. So routing G1 is a **product call** — escalate the
  row (or name the scope by hand), then run `bb stelow gap-scopes`; the command
  by itself is a no-op on this card.
- **Nothing was fixed.** A gap that gets fixed silently is a gap nobody learns
  from, and routing is not the implementer's call.

## 4. The bundles that copied zero files

### 4.1 What was broken, and where the fix actually is

`writeBundleFiles` handed `assignBundleNames` the readable list, whose entries
carry `sourcePath`; the function reads `path`. Every entry therefore read as
junk:

```
assignBundleNames([{stage:'scope', path:'a.md'}])        → [ { name: 'a.md', … } ]
assignBundleNames([{stage:'scope', sourcePath:'a.md'}])  → []
```

**The fix is not merged.** It is in open PR #420 (`fix/one-owner-2026-10-23`,
`server/runtime/cli/cli-bundle-writer.ts`: map `{stage, path: entry.sourcePath}`
before naming). On `origin/master` the writer still passes `sourcePath` and every
export still copies nothing. The rebased #420 branch from §1 carries the fix.

### 4.2 Counts, before and after

Measured in `/home/deploy/repos/bb-plugin-stelow` (the checkout holding
`docs/runs/`), read-only: `bb stelow export --card <id> --check --json`.

| Card | Files in the bundle now | Sources a fixed export would copy |
|---|---|---|
| `card_1fgz8lge` | 0 writer copies (1 legacy manifest row, SHA `—`) | 7 |
| `card_48uuhus1` | 0 (empty Files table) | 47 |
| `card_a9q5zhzd` | 0 | 54 |
| `card_e3u00eb4` | 0 | 44 |
| `card_g4fchxvq` | 0 | 26 |
| `card_kwbdqy8f` | 0 | 5 |
| `card_oqm8gyae` | 0 | 30 |
| `card_dwghr6do`, `card_g9kzo6po`, `card_ncf0glu8`, `card_pttx9ion` | 0 | — (`Unknown card`: the rows are deleted; the dirs are orphans) |
| **Total** | **0 copied files across 11 bundles** | **213 across the 7 live cards** |

**The re-export itself was not run**, and the counts are the honest half of the
answer: the only way to produce the 213 files is to run the fixed writer, which
means loading the #420 build into the running BB — a live plugin swap for every
thread on this host — and then `bb stelow export --card <id>` per card. Running
it with the current (master) build would rewrite ten manifests with an empty
Files table again, which is the lie the fix exists to end. The command per live
card is `bb stelow export --card card_48uuhus1` (etc.) once #420 is on master and
the plugin reloaded; the four orphan dirs cannot be re-exported and want deleting
as a separate, human-approved cleanup.

## 5. Docs: the two absences

`docs/dependencies-and-diagrams.md` (new) and its index entry in
`docs/README.md` under "Stays here":

- **Mandatory dependencies, each with its verifying command:** `node`/`npm`
  (`node -v && npm -v`), `git` (`git --version`), `bash` (`bash --version`, the
  helper is bash), `python3` (`python3 -V`, the helper parses `state.md`
  frontmatter and the workflow's JSON with it), `pele` (`node --input-type=module
  -e "import('pele').then(m => console.log(typeof m.render))"` — bundled via npm
  at `1.8.0`, nothing to install).
- **The two misleading symptoms:** `Could not locate the bindings file` → the
  install, not the code (`npm ci`, or `npm rebuild better-sqlite3`);
  `Cannot find module 'pele'` → an incomplete install (or a shared
  `node_modules` older than the pin), not an optional extra.
- **How diagrams render now:** a ` ```mermaid ` fence and a `.mmd` artifact
  render on read with the bundled `pele`; there is no SVG artifact; the source
  is the durable thing; a render failure falls back to the source plus a
  playground link.
- **`FEATURES.md` carries its entry**, in the artifact viewer bullet: no SVG
  artifact, the fallback-to-source rule, and the link to the page. The GitHub
  Pages site was **not** touched.

## 6. Gates

| Command | Exit | Note |
|---|---|---|
| `npm run typecheck` | 0 | `tsc --noEmit` |
| `npm run quality:shape` | 0 | 8 changed owned files, no changed line over 160 chars, 39 inherited lint findings (none new), boot cost 505 leaf commands / 98.2% |
| `npm test` | 0 | full suite, including the new bands; ends on `upstream drift check ok: vendored tree matches pin 81f4505da0c4` |
| `node tests/test-script-floor.test.mjs` | 0 | `test script floor ok: 88 test bands, one deleted band refused` |
| `node tests/suite-wiring.test.mjs` | 0 | `542 test files wired into npm scripts` |
| `node tests/contrast-ask-door.test.mjs` | 0 | one blank cell → one question, premise names the cell |
| `node --experimental-strip-types --import ./tests/register-ts-source.mjs --test tests/card-detail-contrast.test.mjs` | 0 | 4/4 subtests |
| `node tests/declaration-surface.test.mjs` | 0 | 276 declaration files, no orphan |

The worktree shares the main checkout's `node_modules` by symlink (the brief's
option); `better-sqlite3` loaded without a rebuild on Node v22.22.2, so no
`npm rebuild` was needed.

## 7. What I did not do, and why

- **No push, merge, tag or release.** The #420 rebase exists as a local branch in
  `~/tmp/one-owner-rebase-fix`; publishing it is the PR owner's call, not mine.
- **No bundle re-export.** Covered in §4.2: the fix is in an open PR, and running
  the current writer would re-write ten manifests with an empty Files table.
- **No gap was routed or fixed.** Routing is a product call, and `gap-scopes`
  only converts escalated rows (`escalated: []` here), so it would silently do
  nothing — see §3.
- **The derived question is not listed in the detail's open-question list.** It
  is a real row, consumed by the real answer door by its text, but the UI lists
  BB's pending asks and expired rows, not `ask_contracts`. Adding it to that list
  without an answer path would be a phantom wait, which the repo forbids; the
  read surface for `ask_contracts` remains the debt the #419 record already
  names.
- **No `--premise` flag on `bb stelow ask`.** Same reason the #419 record gave:
  `createAskCommand` has no test harness here, and an untested flag is worse than
  the gap it closes.
- **No parity guard for `docs/audits/`** — that is gap G1, and writing it would
  fix a gap the brief told me not to fix.
- **`skills/` and `data/stelow` untouched.** No sync was run.
- **No full-repo lint.** The pre-commit hook and `quality:shape` gate the change;
  a tree-wide run is the shared-host hazard `AGENTS.md` forbids.
