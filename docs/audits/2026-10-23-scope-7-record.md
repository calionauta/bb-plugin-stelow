# SCOPE-7 record — noise and prose

**Type:** repair record (dead-code deletion, prose correction).
**Date:** 2026-10-23.
**Base:** `origin/master` @ `2e9cba9d7216a46c77a1ea5d90dabfcd8769f9ba`.
**Branch:** `fix/noise-and-prose-2026-10-23`, cut from that commit in this
thread's worktree (`…/worktrees/thr_4ikym8wnab-1/bb-plugin-stelow`).
**Scope:** delete what nothing reads; stop restating numbers a gate already
measures. No behaviour change.

---

## 0. Premises, re-verified before acting

| Premise | Verdict | Evidence |
|---|---|---|
| `npm run deadcode` lists ~275 exports with no external reader | **Held in substance** | 273 unused exports + 142 unused exported types on this base (knip 5.x resolved by the lockfile). The count is a candidate list, not a proof — see §1. |
| `contextAskGate` is a stub that always returns allowed | **Held** | `lib/question-gate.mjs` returned `{allowed: true}` on every branch, with `void intent; void stage;`. |
| `NON_AUTO_SKIPS` and `MODE_DOES_NOT_RUN` are dead constants | **Held** | `NON_AUTO_SKIPS` was `[]`, read only by its own `.d.mts`; `MODE_DOES_NOT_RUN` was read nowhere at all. |
| `.trackSync` is built twice | **Held** | `execution-surfaces.ts` called `buildTrackSync(core)` on line 246 and again inside the line-247 argument, and no consumer ever read the `trackSync` property. |
| `gatePreservation` is duplicated in `start-workflow-prompt.ts` | **Held** | The sentence was pasted into the template while `BUILDER_CLAUSES.gatePreservation` already owned it. |
| `tests/prompt-cache-order.test.mjs` claims the build paths are red | **Held, and false** | The header said "currently red on all three build paths"; the test is un-skipped and green (90.9% / 91.7% / 95.6% cacheable). |
| `lib/prompt-clause-budgets.mjs` cites 93.7% | **Held, and stale** | The same measurement is 11,902 / 12,490 = **95.3%** on this base. |
| `docs/remaining-debt-audit.md` restates ceilings the gate owns | **Held** | It quoted `debt baseline ok: 3 oversized file(s) and 37 oversized function(s), 7 inherited entries`; the gate on this base prints **2 / 32 / 27**. |
| `tests/declaration-drift.test.mjs` exists (the second gate, 42 invisible exports, 35 unchecked barrel re-exports) | **DEAD — does not exist** | `git ls-tree -r --name-only origin/master \| grep declaration-drift` → empty; `git grep -n "declaration-drift\|invisible exports\|unchecked barrel" origin/master` → empty. See §4. |
| `docs/file-locking.md` is missing; one "orphan" file is orphaned; there is no `types/` directory | Not acted on (given as dead) | `docs/file-locking.md` exists on this base; no action taken. |

The brief's second gate is not on this base. `spike/declaration-surface-2026-10-23`
(cut from the same commit, not merged) carries only
`docs/audits/2026-10-23-scope-8-record.md`: it measures the declaration surface
and recommends a signature-integrity check as its own scope. The 42/35 ceilings
have no file here to lower, so the coupling honoured in this commit is the one
that exists — `tests/declaration-surface.test.mjs` — and it is green (§3).

---

## 1. What was deleted, and what proves nothing reads it

**Method.** For every candidate, `git grep -w -o -n -- <name> origin/master`
was run and each occurrence was classified by where it lives: its own module,
a sibling `.d.mts`, `tests/`, `docs/`+`FEATURES.md`, or other source. A symbol
was deleted only when the **only** occurrence in the whole tree was its own
definition. It was un-exported (definition kept, `export` removed) only when
every other occurrence was inside its own module. Nothing was deleted on
knip's word alone.

**Why knip is a candidate list, not a proof.** Of its 273 entries, 138 names
have an occurrence in another source file (some are a same-named symbol in a
different module, which makes the entry look used — a conservative miss, never
an unsafe deletion), and one line merged two names (`CORE_SKILLS|WORKFLOW_SKILLS`,
both genuinely imported by `lib/workflow-skills-sync.mjs`). Its two "unused
files" are both false positives: `components/detail/frozen-acceptance-row.tsx`
is imported by `build-detail-hero.tsx` through an extensionless specifier, and
`tests/fixtures/restore-dogfood.mjs` is a documented manual repro named by
`FEATURES.md` and `docs/restore-dogfood.md`.

### Deleted — 47 symbols in 41 files (definition only, no reader anywhere)

- `components/board/track-lists.tsx`: `ResearchList`, `ExploreList`
- `components/panels/track-panel-dialogs.tsx`: `TrackPresetManagerProps`, `TrackOnboardingProps`
- `lib/bb-workflow-capabilities.mjs`: `SCOPE_BATCH_PILOT_CAPABILITY_GATE`
- `lib/delegation-map.mjs`: `DELEGATION_TIERS`
- `lib/execution-artifacts.mjs`: `executionArtifactManifest`
- `lib/first-turn-contract.mjs`: `FIRST_STAGE`
- `lib/preset-judge.mjs`: `PRESET_JUDGE_POLL_MS`
- `lib/preview-detect.mjs`: `PREVIEW_TIERS`
- `lib/recipe-width.mjs`: `activeRecipeTasks`
- `lib/stage-skips.mjs`: `MODE_DOES_NOT_RUN`
- `lib/verify-blockage.mjs`: `VERIFY_BLOCKAGE_STATES`
- `lib/workflow-config.mjs`: `DEFAULT_EXPLORATION_HYBRID`
- `server/bb-workflow-bridge.ts`: `nativeStatusOf`, `normalizeNativeWorkflowStatus`
- `server/contracts.ts`: `LEGACY_APPETITE_DEFAULTS`
- `server/runtime/cli/cli-contract.ts`: `archivedCard`
- `server/runtime/quality-seal.ts`: `unverifiedSeal`
- `server/scope-batch.ts`: `ScopeBatchPilotScope`, `isBatchCoordinated`
- `server/decision-config-rpcs.ts`: `DecisionConfigHandlers`
- `server/decision-point-rpcs.ts`: `DecisionPointHandlers`
- `server/decision-review-policy.ts`: `DecisionReviewPolicyHandlers`
- `server/execution-lifecycle-types.ts`: `ResumeFailure`
- `server/execution-lifecycle.ts`: `ExecutionLifecycle`
- `server/execution-native-types.ts`: `StartFailure`
- `server/execution-reconcile.ts`: `ExecutionReconcile`
- `server/runtime/ask-artifacts.ts`: `AskArtifacts`
- `server/runtime/card-briefing-runtime.ts`: `BriefingRuntime`
- `server/runtime/card-seams.ts`: `CardSeams`
- `server/runtime/claim-coordination.ts`: `ClaimCoordination`
- `server/runtime/decision-surface.ts`: `DecisionSurface`
- `server/runtime/preview-host.ts`: `PreviewHost`
- `server/runtime/question-inbox.ts`: `QuestionInbox`
- `server/runtime/read-runtime.ts`: `ReadRuntime`
- `server/runtime/research-track-sync.ts`: `ResearchTrackSync`
- `server/runtime/shared-checkout.ts`: `SharedCheckoutReader`
- `server/runtime/track-capabilities.ts`: `ResearchStrategyEntry`, `TechniqueEntry`, `TrackCapabilities`
- `server/runtime/track-projection.ts`: `TrackProjection`
- `server/runtime/verify-blockage.ts`: `VerifyBlockageReader`
- `server/runtime/worker-protocol-clauses.ts`: `WorkerProtocolClauses`
- `server/runtime/workflow-shared.ts`: `BuildPromptVariant`
- `server/workers-retry.ts`: `WorkerRetryDeps`
- `server/worktree-cleanup.ts`: `WorktreeCleanup`

Deleting them exposed cascading dead code that the lint gate caught before the
commit existed: `exploreListMeta`, `researchListMeta` and `LightweightListProps`
in `track-lists.tsx` (imports/types that only the two removed components used)
and `INTENT_ORDER` in `lib/github-intent.mjs` (a const whose only export was the
bottom-of-file list removed with it). All four were removed; lint went back to
its recorded 39 inherited findings.

### Deleted by hand — 5 symbols

- `lib/question-gate.mjs`: `contextAskGate`, `CONTEXT_STAGE`, `CONTEXT_SKIP_INTENTS`
  — the gate was a stub (`void intent; void stage;`) that always allowed. Its
  rationale (upstream `context:5` permits the reduced ask; the host cannot read
  that predicate) moved into `decideAskGate`'s docstring and into the RFC's
  pipeline list. `intent` stays in the dispatcher's input shape because the CLI
  and handler pass it, and is documented as gating nothing.
- `lib/stage-skips.mjs`: `MODE_DOES_NOT_RUN_BY_STAGE` (a map written by the
  projection loop and read by nothing) and `NON_AUTO_SKIPS` (an empty array read
  only by its own declaration). The loop now builds only the union the timeline
  reads; the docstring says which reader owns the "does not run" set
  (`lib/workflow-moves.mjs`, which reads the catalog directly).

### Un-exported — 74 symbols in 44 `lib/` modules (read only inside their own module)

Every one kept its definition and lost its `export` plus its `export declare`
line, because the declaration surface is what drifts:

- `lib/audit-receipt.mjs`: `AUDIT_RECEIPT_MIN_CHARS`
- `lib/audit-verification.mjs`: `checkFrozenBaseline`, `checkFrozenTestMap`, `checkFrozenRedProof`, `checkFrozenSha`
- `lib/auto-continue.mjs`: `TERMINAL_STAGES`
- `lib/bulk-batch.mjs`: `BULK_BATCH_SIZE`
- `lib/composer-execution.mjs`: `COMPOSER_PERMISSION_MODES`, `COMPOSER_SERVICE_TIERS`
- `lib/decision-api.mjs`: `DECISION_STATE_MAX_CHARS`, `DECISION_API_KEY_ENV_VARS`
- `lib/decision-coverage.mjs`: `DECISION_READS_CAP`
- `lib/decision-points.mjs`: `DECISION_POINT_MODES`
- `lib/decision-receipts.mjs`: `DECISION_RECEIPT_SCHEMA_VERSION`
- `lib/delegation-map.mjs`: `DELEGATION_SITES`
- `lib/diff-split.mjs`: `MAX_PATCH_CHARS`
- `lib/discard-policy.mjs`: `MAX_PREVIEW_FILES`
- `lib/draft-burst.mjs`: `DRAFT_SOURCE_CARD`, `DRAFT_SOURCE_BOARD`, `DRAFT_SOURCE_BAND`
- `lib/execution-adapter.mjs`: `NORMALIZED_STATES`, `capabilityReport`
- `lib/execution-route.mjs`: `SCOPE_BATCH_PILOT_REQUIRES`
- `lib/execution-run-ledger.mjs`: `RUN_STATUS_PHRASES`
- `lib/first-turn-contract.mjs`: `EAGER_SKILLS`
- `lib/github-issue-create.mjs`: `GH_CANDIDATES`, `STELOW_CARD_MARKER_PREFIX`, `POST_BODY_MAX_CHARS`
- `lib/hill-position.mjs`: `HILL_PLOT`
- `lib/inbox-severity.mjs`: `SEVERITY_ERROR_REPETITIONS`
- `lib/native-run.mjs`: `RUN_ACTIVITY`
- `lib/preset-onboarding-state.mjs`: `persistOnboarding`
- `lib/preview-detect.mjs`: `PREVIEW_SKIP_DIRS`
- `lib/preview-lifecycle.mjs`: `startPreview`, `stopPreviews`, `sharePreview`, `disposePreviews`
- `lib/preview-process.mjs`: `clearStartTimer`, `killPreviewProcess`, `spawnPreviewProcess`
- `lib/preview-session.mjs`: `PREVIEW_PORT_MIN`, `PREVIEW_PORT_MAX`, `EMPTY_PREVIEW`
- `lib/prompt-clause-budgets.mjs`: `CEILING_SLACK`
- `lib/question-batch.mjs`: `QUESTION_ID_SEP`, `MAX_DESC_CHARS`, `MAX_PREVIEW_CHARS`, `MAX_ARTIFACT_CHARS`, `CONTRACT_ID_PATTERN`
- `lib/question-exclusivity.mjs`: `expiredOptionLabels`
- `lib/question-store.mjs`: `QUESTION_SYNC_KICK_MS`
- `lib/recon-receipt.mjs`: `RECON_RECEIPT_CONTRACT`
- `lib/research-artifacts.mjs`: `MIN_ROUND_CHARS`, `MIN_EXPLORE_CHARS`
- `lib/research-evidence.mjs`: `NO_WEB_PATTERNS`
- `lib/review-gates.mjs`: `REVIEW_GATE_ATOMS`, `PRE_REVIEW_GATE_ARTIFACT`
- `lib/review-truncation.mjs`: `EXCERPT_MODES`
- `lib/review-verdict.mjs`: `REVIEW_VERDICTS`
- `lib/ripwire-gates.mjs`: `MAX_GATE_ROWS`
- `lib/ripwire-lanes.mjs`: `MAX_LANE_ROWS`, `MAX_LANE_WARNINGS`
- `lib/scope-batch-cleanup.mjs`: `TERMINAL_SCOPE_OUTCOMES`
- `lib/scope-merge.mjs`: `FAILED_SCOPE_STATUSES`, `SUCCESS_SCOPE_STATUSES`
- `lib/squash-merge.mjs`: `SQUASH_EXIT_BASE_CHECKOUT_FAILED`
- `lib/transition-facts.mjs`: `TRANSITION_KINDS`
- `lib/workflow-config.mjs`: `DEFAULT_QUALITY`, `DEFAULT_EXPLORATION_COUNT`, `VALID_RED_FIRST`
- `lib/workflow-moves.mjs`: `stagesThatDoNotRun`, `stagesThatDoNotRunForMode`, `absentStages`, `stagesAbsentByPolicy`

`RUN_STATUS_PHRASES` and `stopPreviews` are named in `FEATURES.md` and in the
debt audit; both texts describe the values and the behaviour, not the export,
and both remain true (the consts and functions still exist).

### Declarations

**80 `export declare`/ambient declaration lines removed from 48 `.d.mts` files**
— one for every deleted or un-exported `lib/` symbol, in the same commit, which
is what `tests/declaration-surface.test.mjs` requires. Three of the deleted
declarations were in the *ambient* form (`export function …` with no `declare`),
which that gate cannot see; they were removed anyway, because a declaration the
gate cannot check is exactly the claim that drifts.

`npm run deadcode` after the change: **179 unused exports (from 273) and 113
unused exported types (from 142)**. The two "unused files" remain (both have
readers, above).

---

## 2. The duplicated wiring

**`trackSync` was built twice per call.** `buildThreadSync` returned
`trackSync: buildTrackSync(core)` and then called `buildTrackSync(core)` again
as the argument to `buildBuildSync`. No consumer ever read the `trackSync`
property (`grep -rn "\.trackSync\b" server components lib tests` → no hits), so
the property is gone and the track sync is constructed once, inside the build
sync that uses it. `syncThreadState` — the only consumer — is unchanged.

**`gatePreservation` was restated.** `startWorkflowPrompt` now interpolates
`BUILDER_CLAUSES.gatePreservation` from `server/runtime/workflow-shared.js`.
Proof the rendered prompt did not move: the old module (from `git show
origin/master:…`) and the new one both render 1597 characters and compare
`identical: true` for the same request; `tests/runtime-wiring.test.mjs` still
finds the gate sentence in the prompt.

---

## 3. Prose: what the gate said, and what changed

A comment cannot fail a gate, so each fix below starts from a measurement that
**contradicts the old text**, and where the fact is checkable the check is now a
test that fails on the old text.

### 3.1 `tests/prompt-cache-order.test.mjs` claimed a red check

- **Old text:** "## Why the order check is skipped rather than failing / It is
  currently red on all three build paths…" and "Measured 0.6% before F2 … and
  94-95% after".
- **The gate:** the test had already been un-skipped, and
  `node --experimental-strip-types --import ./tests/register-ts-source.mjs --test
  tests/prompt-cache-order.test.mjs` printed `pass 4 / fail 0`, including
  `ok 2 - every build path states its shared clauses before any per-card value`,
  and measured `spawn 90.9% · restart 91.7% · reseed 95.6%`. The three pairs are
  91.6% / 95.5% / 97.4%, so "94-95%" was stale too.
- **Fix:** the header now says the check is asserted and points at the run for
  the numbers; the stale percentage is gone. The property itself stays
  gate-enforced by the assertion below it (it fails if a per-card value moves
  back above the shared clauses).

### 3.2 `lib/prompt-clause-budgets.mjs` restated an aggregate size

- **Old text:** "11,700 of the reseed prompt's 12,490 chars … (93.7%)".
- **The measurement:** the clause bag is 11,902 characters and the reseed prompt
  12,490 — **95.3%**. (Sum of `clauseTexts()` + `BUILDER_CLAUSES` against
  `renderSpawnPaths().reseed`.)
- **The gate:** a new `doesNotMatch` pin in `tests/prompt-budget.test.mjs`
  rejects an aggregate restatement in that module. It **failed on the old text**
  (`AssertionError … prompt-clause-budgets must not restate an aggregate size`,
  exit 1) and passes after the fix. The per-clause ceilings were already
  enforced there (`overBudget` / `loose` / `unbudgeted`); the aggregate never
  was, which is why it drifted.

### 3.3 `docs/remaining-debt-audit.md` quoted the gate and claimed the present census

- **Old text:** the R5 item said the tree-wide debt was "still pinned — as of
  Phase 5, 3 oversized files and 47 oversized functions"; three phase results
  said "the census now reports …"; two sections quoted
  `debt baseline ok: 3 oversized file(s) and 37 oversized function(s), 7
  inherited entries`.
- **The gate:** `node tests/debt-baseline.test.mjs` on this base prints
  `debt baseline ok: 2 oversized file(s) and 32 oversized function(s), 27
  inherited entries, shape gate green`. The doc was wrong on all three numbers,
  and every gate was green while it was.
- **The gate that now fails on the old text:** a `doesNotMatch` pin in
  `tests/debt-baseline.test.mjs` rejects a quoted gate line
  (`debt baseline ok: <n>`), a present-tense `the census now reports`, and
  `still pinned — as of`. It failed on the old doc (exit 1) and passes now.
- **Fix:** eight passages moved to past tense or to a pointer; the header now
  says the file is a phase record and names `scripts/source-debt.json` +
  `tests/debt-baseline.test.mjs` as the live authority; `docs/README.md`'s
  description of the file says the same. The phase narratives and their dated
  measurements are kept — they are the evidence behind the budget gate's
  design, not a second source for today's census.

### 3.4 `tests/declaration-surface.test.mjs` restated its own corpus

- **Old text:** "There are 190 declaration files and 718 declared names here".
- **The run:** `declaration surface test ok: 263 files, no orphan declaration`.
  The count had drifted by 73 files with the gate green.
- **Fix:** the sentence no longer carries a count; the run prints it. This is
  the same failure mode the file exists to catch, one level up.

---

## 4. The coupling the brief assumed, and the one that exists

`tests/declaration-surface.test.mjs` is the only declaration gate on this base
(wired inside `test:contracts`). It requires every `export declare
(function|const)` name to be bound or re-exported by the sibling `.mjs`. Every
prune above removed its declaration in the same commit and the gate is green
(263 files). It does **not** check arity, types, or the reverse direction, which
is what `spike/declaration-surface-2026-10-23` measured and left as its own
scope.

The brief's `tests/declaration-drift.test.mjs` (42 invisible exports, 35
unchecked barrel re-exports) **does not exist at `2e9cba9d`**; there was no
baseline constant to lower and none was invented. A reader who finds this
record after that test lands should lower its two ceilings by whatever this
commit removed — the record cannot do it from here.

---

## 5. Gates

All three run on the branch's final tree, this record included.

```
$ npm run --silent typecheck
TYPECHECK_EXIT=0

$ npm run --silent quality:shape
source shape ok: 90 source file(s) from 2e9cba9d…, no changed line over 160 characters
source budgets: 90 changed owned files … 4 inherited entries, 0 violations
test boot cost: 488 leaf commands, 479 start node (98.2%), ~15.3s of process boot
lint ok: 39 finding(s), all inherited — 39 recorded in scripts/lint-baseline.json
SHAPE_EXIT=0

$ npm test
NPM_TEST_EXIT=0
```

Plus the gate this change is coupled to:

```
$ node tests/declaration-surface.test.mjs
declaration surface test ok: 263 files, no orphan declaration
EXIT=0
```

The recipe-pilot matrix pins its evidence files by SHA-256, so the four files
whose bytes this commit changed (`server/bb-workflow-bridge.ts`,
`lib/execution-artifacts.mjs`, `lib/execution-route.mjs`,
`lib/bb-workflow-capabilities.mjs`) were re-recorded in
`tests/fixtures/recipe-pilot-matrix.json`. That is what the pin is for; the
rendered workflow source hashes did not move, which confirms the deleted
functions were not part of the rendered script.

---

## 6. What I did not do and why

- **Did not act on the brief's second gate.** `tests/declaration-drift.test.mjs`
  does not exist at the base commit (§0, §4). Nothing was invented to stand in
  for it.
- **Did not touch `components/ui/**` (24 reader-less exports) or
  `hooks/useBrowserDimmingModal.ts`.** The hook's own docstring states these
  files are kept byte-identical to the host app's shared-UI seam, which the app
  injects over at build time; knip's "unused" claim is about *this* repository
  only, and an out-of-repo consumer cannot be verified from here. Deleting an
  export in that seam is a cross-repo change, not noise removal.
- **Did not delete the 20 exports whose only reader is a test.** A test is a
  reader, and several of these are the subject of a behavioural test rather than
  a text pin: `TrackPanel` (`tests/explore-panel-state.test.mjs` loads and calls
  it), `ISOLATED_WORKTREE_BENEFIT` (a sentinel injected by
  `tests/preset-environment-control.test.mjs`), `TEXT_STATE`/`TEXT_BODY`
  (design-token vocabulary), `BUILD_PATH_CLAUSES`/`TRACK_PATH_CLAUSES` (prompt
  fixtures), `CardMetaRows`/`ReadMissPill`/`WorkerHistoryList` (UI contract
  tests). Removing the symbol would delete the test's subject — a different
  decision from removing noise, and not one this brief asked for.
- **Did not un-export the ~170 TypeScript exports that are local to their file.**
  They have no `.d.mts` to drift, so there is no coupled gate and no behavioural
  change; it would be 120+ files of churn that no gate can score as progress.
  This is the remaining surface debt, and it is measurable: knip reports 179
  unused exports / 113 unused exported types after this change.
- **Did not delete the two knip "unused files".** Both have readers knip cannot
  see (an extensionless import; a documented manual repro script).
- **Did not rewrite `docs/remaining-debt-audit.md` into a short record.** Its
  phase narratives are the evidence for why the budget gate looks the way it
  does (each defect and the mutation test that proved the repair). What was
  wrong was the present-tense census claims and the quoted gate output; those
  are gone and pinned. The file is 1,900+ lines, but it no longer claims to be
  today's numbers.
- **Did not change `FEATURES.md`.** No user-facing feature, capability, or
  output shape changed: the deleted code was unrendered, uncalled, or a
  duplicate construction of a value that is now built once.
- **Did not touch `skills/` or `data/stelow`.** The only data-adjacent file
  changed is `tests/fixtures/recipe-pilot-matrix.json` (evidence hashes, §5).
- **Did not push, merge, tag, or release.** The branch is local.
