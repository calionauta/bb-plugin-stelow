# SCOPE-3 record — state honesty (reconstructed from the branch)

**Type:** execution record for `SCOPE-3` of
`2026-10-23-stelow-audit-repair-plan.md`, rebuilt from the tree because the file
this scope should have written never existed.
**Scope:** 3.1–3.6 (the plan's table at `docs/audits/2026-10-23-stelow-audit-repair-plan.md:394`).
**Branch:** `fix/state-honesty-2026-10-23`, three commits on `2e9cba9d`.
**Merged as:** part of `f5442249` — *fix: audit repair batch, nine scopes,
verified as one tree (#410)*, 2026-10-23 14:19 −0300.
**Reconstruction date:** 2026-10-23, from `git log --stat` and the diff of
`2e9cba9d..016dbfb4`, plus mutations re-run on `b70f1e5a` (see §4).
**Status:** all six acceptance criteria are implemented in the merged tree (3.2
predated the branch — §2); **two have no guard** (3.AC-3, and the running half of
3.AC-5) and are recorded as debt in §5, not quietly claimed.

This file is written *after* the fact and says so. It is not memory: every claim
below is checkable with the command beside it, and every red proof was re-run on
the merged tree rather than copied from a session.

## 1. What shipped, in three commits

`git log --oneline origin/master..fix/state-honesty-2026-10-23` (three commits,
base `2e9cba9d`; `git diff --stat 2e9cba9d..016dbfb4` → 20 files, +272/−82):

| Commit | Subject | Files |
|---|---|---|
| `1a4d87b4` | fix: make the ask substance floor absolute | `lib/question-gate.mjs`, `tests/question-substance.test.mjs`, `FEATURES.md` |
| `058e9533` | fix: tell the truth about finished cards, stale errors and unreadable questions | `server/cards.ts`, `server/execution-reconcile-boundary.ts`, `server/execution-reconcile-deps.ts`, `server/runtime/card-detail.ts`, `server/runtime/card-detail-types.ts`, `server/runtime/cli/cli-done.ts`, `server/runtime/cli/cli-deps.ts`, `server/runtime/pending-questions.ts`, `server/runtime/track-projection.ts`, `tests/runtime-pending-questions.test.mjs`, `FEATURES.md` |
| `016dbfb4` | fix: one completion writer for every track | `server/runtime/card-completion.ts` (new), `server/runtime/cli/cli-done-track.ts`, `server/runtime/research-track-sync.ts`, `tests/artifact-contracts.test.mjs`, `tests/auto-continue.test.mjs`, `tests/card-lifecycle-contract.fixtures.mjs`, `tests/runtime-research-track-sync.test.mjs` |

One defect class, stated once in `FEATURES.md`: **a surface must not invent an
answer it does not have.** Finished cards project no questions; a failed ask read
is `unknown` (`null`), never `[]`; a running track clears the previous
`last_error`; a quiet poll completes through the same writer as the explicit
`done`; a placeholder ask cannot be forced through.

## 2. The six acceptance criteria, and where each one lives

| AC | Outcome | Code | Plan's `test_map` file | Guard that actually runs it |
|---|---|---|---|---|
| 3.AC-1 | A forced probe still hits the substance floor | `lib/question-gate.mjs` — `questionSubstanceGate` runs **outside** `if (!forced)` in `decideAskGate` | `question-substance.test.mjs` | same file |
| 3.AC-2 | Restore neither reopens nor blocks on a withheld question | `lib/card-restore-pending.mjs` — `questionsReopened: 0`, `questionsWithheld` counted | `runtime-card-restore.test.mjs` | `card-restore-pending.test.mjs` — `runtime-card-restore` asserts neither field |
| 3.AC-3 | A terminal card shows no waiting hero | `server/runtime/pending-questions.ts` — `isTerminalCardStatus` returns `[]` before reading asks | `runtime-pending-questions.test.mjs` | **none** (§5) |
| 3.AC-4 | An unreadable source yields *unknown* | same file — `null` for a failed read and a throwing projection; `[]` only for a known zero | `pending-questions.test.mjs` | `runtime-pending-questions.test.mjs` |
| 3.AC-5 | A recovered thread shows no stale error | `server/runtime/track-projection.ts` (`last_error: null` in `markThreadRunning`) and `card-completion.ts` | `runtime-thread-lifecycle.test.mjs` | `runtime-research-track-sync.test.mjs`, completion path only; `runtime-thread-lifecycle` passes with the running-path clear removed (§5) |
| 3.AC-6 | Exactly one writer marks a card done | `server/runtime/card-completion.ts`; both tracks and the `done` CLI call it | `terminality-contracts.test.mjs` | `artifact-contracts.test.mjs` (count) + `runtime-research-track-sync.test.mjs` (columns) |

**The plan's `test_map` drifted against the branch in four places**, and the
table above is the corrected map rather than the intended one:
`tests/pending-questions.test.mjs` (3.AC-4) was never written — the assertions
landed in `runtime-pending-questions.test.mjs`; 3.AC-5's mapped file
(`runtime-thread-lifecycle.test.mjs`) does not assert the running-path clear it
was supposed to defend; and 3.AC-6's mapped file (`terminality-contracts.test.mjs`)
does not carry the one-writer count — `artifact-contracts.test.mjs` does. 3.AC-2's
mapped file (`runtime-card-restore.test.mjs`) never reads `questionsWithheld` or
`questionsReopened`; `card-restore-pending.test.mjs` does.

**3.2 (restore) predates this branch.** `lib/card-restore-pending.mjs` was last
touched by `4dcdbe9f` (#184) and the scope-3 branch did not edit it: the
withholding decision was already made and documented there. The plan's DoD
("restore closes what it withheld") and the shipped rule ("withheld, counted, and
named — never reopened") differ, and the module's own header argues the
divergence: a fresh worker never made the old interaction, so reopening buys a
badge that vanishes on the next sync. This record repeats the divergence instead
of smoothing it over.

## 3. Red proofs, re-run on the merged tree

Each mutation was applied to `/tmp/s3-tree` (a worktree at `b70f1e5a`, the
merged tree), the named test run, and the file restored (`git status` clean
afterwards). Six mutations: five failed a named assertion, and one (3.AC-5)
passed in both files that should have caught it — which is the point of running
them.

| AC | Mutation | Result |
|---|---|---|
| 3.AC-1 | moved `questionSubstanceGate` back inside `if (!forced)` | **fails**: `--force does NOT override the substance floor…` — actual `true`, expected `false` |
| 3.AC-2 | `questionsReopened: 0` → `questionsWithheld` | **fails**: `restore reactivates per kind…` — actual `questionsReopened: 1`, expected `0` |
| 3.AC-3 | `if (isTerminalCardStatus(card?.status)) return []` → `if (false)` | **passes** — no test asserts it (see §5) |
| 3.AC-4 | both `return null` → `return []` in `pending-questions.ts` | **fails**: `a failed live read is unknown, not zero` — expected `null`, actual `[]` |
| 3.AC-5 | dropped `last_error: null` from `markThreadRunning` | **passes** in `runtime-research-track-sync` *and* in the plan's `runtime-thread-lifecycle` — no test asserts the running-path clear (see §5) |
| 3.AC-6 | `research-track-sync.ts` writes its own `status: "completed"` instead of calling `completeCard` | **fails**: `one writer sets the completed status…` — actual `2`, expected `1`; and executably `a valid index completes the research card and records the review trail` |

## 4. Gates

Measured on the merged tree (`b70f1e5a`), in a throwaway worktree with this
checkout's `node_modules` linked, not on the author's branch:

| Command | Exit |
|---|---|
| `node tests/question-substance.test.mjs` | 0 |
| `node tests/card-restore-pending.test.mjs` | 0 |
| `node --experimental-strip-types --import ./tests/register-ts-source.mjs tests/runtime-pending-questions.test.mjs` | 0 |
| `node --experimental-strip-types --import ./tests/register-ts-source.mjs tests/runtime-research-track-sync.test.mjs` | 0 |
| `node tests/artifact-contracts.test.mjs` | 0 |
| `node --experimental-strip-types --import ./tests/register-ts-source.mjs --test tests/core-migrations.test.mjs` | 0 |
| `npm run typecheck` | 0 |
| `npm run quality:shape` | 0 (0 changed files against the merge base; 39 inherited lint findings, none new) |
| `npm test` | 0 |

## 5. Debt this record discovers rather than claims

**3.AC-3 has no guard.** `pending-questions.ts` filters a terminal card's
questions, and `tests/runtime-pending-questions.test.mjs` exercises neither the
terminal status nor the filter: flipping the condition to `if (false)` leaves the
whole file green. The behaviour is real (the FEATURES entry quotes the hero text
it removes) and the test the plan maps to it does not defend it.

The same is true of one half of 3.AC-5: the *completion* path clears `last_error`
through the one writer and is guarded (`runtime-research-track-sync` fails
without it), while the *running* path's `last_error: null` in
`markThreadRunning` has no assertion — removing it leaves both
`runtime-research-track-sync` and the plan's `runtime-thread-lifecycle` green.

Both are recorded here, not fixed here: this file is a reconstruction, and adding
assertions to another scope's tests would make the next reader believe the branch
shipped them. The fix is one test each, in their own commit, with the mutation
above as the acceptance check.

## 6. What this record does not do

- **It does not re-litigate the restore decision.** §2 states the divergence and
  the module argues it; reopening it would need a second identity on the inbox
  row plus a sync exemption, and that is a different scope.
- **It does not attribute the exits to the branch's own run.** The branch tip
  still exists, but only as another thread's checkout
  (`/home/deploy/tmp/impl-state-honesty` at `016dbfb4`), which this record did
  not enter; and the merged tree is what ships, so §4 measures `b70f1e5a`. Two
  of the branch's files were refactored after it landed: `lib/question-gate.mjs`
  lost the `intent`/`context` gates in a later scope (the substance change
  survived — §3 re-proves it), and `server/runtime/track-projection.ts` dropped a
  dead type alias. Neither changes the claims above.
- **It does not claim 3.AC-2 came from this branch.** It did not; see §2.
- **No prose was invented.** Every sentence cites a commit, a file, a test name
  or a mutation run recorded above.
