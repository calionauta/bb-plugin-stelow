# Stelow audit repair plan — 2026-10-23

**Type:** technical repair plan, shaped like a `spec-tech` (typed scopes,
sequencing principles, observable acceptance criteria, per-scope contract).
**Derived from:** `2026-10-23-stelow-audit.md` (Part I = findings, Part II = the
split decision this plan obeys).
**Date:** 2026-10-23
**Status:** planned, not approved. No scope executes until the owner approves it;
`apiVersion` of the plan is this file, not a `stelow.json`.
**Superseded in its numbers:** `2026-10-23-premise-recheck.md`. Against `origin/master`,
0 of the 43 acceptance criteria below survive and three scopes lose their central
finding; read this file for intent and that one for fact.
**Not normative once executed.** Every acceptance criterion here is meant to
become a test named in its `test_map`. When a scope lands, the test is the
authority and this file becomes history — so deleting `docs/audits/` later loses
nothing that still runs.
**Shape note.** The `[SCOPE-N]` blocks and the task tables follow the Stelow
tech-planning format because an executor parses them; that is also why their
rows are long. A table row cannot wrap, so the 160-column rule applies to this
file's prose, not to its tables.

## 0. Context and constraints

### 0.1 What this plan is built on

Measured facts, not opinions. The audit's own numbers are cited only where the
sequencing depends on them; everything else is a pointer.

| Fact | Value | Why it shapes the plan |
|---|---|---|
| Findings needing a decision | 3 blockers, 8 single-source violations, 6 state-honesty items, 2 claim defects, 6 token items, 5 noise items, 1 declaration-surface question | 8 scopes, below the ceiling of 9 |
| `check:pin-provenance` | exits **1** today | SCOPE-1 is not optional and is first |
| `bash data/stelow schema artifacts` | exits **2**, verb unknown | the boundary guard is one test away |
| Research/explore cacheable prefix | **7.5% / 9.9%** | SCOPE-6 is the only scope with a hard number to move |
| `npm run test:fast` | green | the plan's baseline; no scope starts on red |
| Repo visibility | **public** | outward-facing text changes are release-typed and reviewed |

### 0.2 Constraints the plan inherits (non-negotiable)

- **No agent self-certification.** The agent that writes a change does not write
  its test. New-behaviour tests come from a human-described case or a fresh
  context that red-teams them (`AGENTS.md`, `stelow-workflow-testing-ai-code`).
  This plan authors the *criteria*; it does not author the assertions.
- **Targeted in-loop, full in CI.** Each scope runs its own bands; `npm test`
  runs at close, not per edit.
- **Sync-owned paths are upstream-first.** `skills/` and `data/stelow` may not be
  hand-edited. Any fix that lands there is an upstream change plus a sync —
  SCOPE-1.4 and the orchestrator-skill item are therefore *upstream work items*,
  not host patches.
- **Never push to `master`.** Branch → PR → squash. Feature commits stay
  separate from fixes; the release PR accumulates.
- **A user-facing change carries its `FEATURES.md` entry in the same commit.**
  Each scope below states whether it changes user-visible behaviour.
- **Size discipline.** A file over 400 lines or a function over 50 is a flag,
  not a quota: split behaviour, never compress it (`AGENTS.md`).

### 0.3 Scope of this plan

**IN:** every finding in Part I of the audit, the fourth boundary instrument
(the verb contract), the boundary gate script, and the token/noise work the
audit ranked.

**OUT, deliberately:**

- Merging the two repositories — decided against in Part II, with falsifiable
  triggers. Revisit only if one of those triggers fires.
- Completing the scope-batch feature. The plan's default is deletion (YAGNI);
  resurrection requires the bootstrap to be reachable in one task.
- Porting `data/stelow` to TypeScript.
- Any new user-facing feature. This plan removes risk; it adds no surface.

## 1. Identified scopes

| # | Scope | Type | Risk | Covers | Depends on |
|---|---|---|---|---|---|
| 1 | Boundary contract | feature | 4 | B1, B2, S2, S3, fourth instrument, release gate | — |
| 4 | Claims, lock, reconciler cost | feature | 4 | B3, claim defects, merge-lock model, poll cost | — |
| 2 | Facts with one owner | feature | 3 | S4, S5, S6 | 1 |
| 3 | State honesty | feature | 3 | `--force`, restore, phantom wait, failed read, `last_error`, mark-done | 2 |
| 5 | Clause integrity | optimization | 2 | S7, S8, `Required<Pick>` | 1 |
| 6 | Cache economy | optimization | 3 | reorder, `DONE_PROTOCOL`, 5 clauses, ceilings | 5 |
| 7 | Noise and prose | optimization | 2 | exports, stubs, orphans, aged prose, debt doc | — |
| 8 | Declaration surface | spike → feature | 4 | 257 `.d.mts` vs 270 `.mjs` | — |

Eight scopes. The audit's repair waves map onto them one-to-many: Wave 0 →
SCOPE-1, Wave 1 → SCOPE-2 + 3 + 5, Wave 2 → SCOPE-6, Wave 3 → SCOPE-4 + 7.
SCOPE-8 was not a wave; it is a question the audit raised and did not answer.

## 2. Sequence and why

```
day 1        SCOPE-1  ──┬── SCOPE-4
             SCOPE-8 spike (read-only, parallel)
             │        │
             ├─ SCOPE-2 ── SCOPE-3
             └─ SCOPE-5 ── SCOPE-6
                          SCOPE-7 (any time after 1)
```

| Position | Scope | Principle | Justification |
|---|---|---|---|
| 1 | SCOPE-1 | P0 + P3 (risk 4) | The boundary contract is the enabling guard: every later scope ships through it. It also stops live bleeding — research/explore currently have no working artifact writer. |
| 2 | SCOPE-4 | P3 (risk 4) | Highest residual risk, and its output is a decision ("delete or resurrect"), so anything built before it may sit on dead code. Front-loaded, not deferred to the end. |
| 3 | SCOPE-2 | P2 (key enabler) | SCOPE-3 cannot be honest about "which stage is the card in" while six regexes disagree. One reader first. |
| 4 | SCOPE-3 | P6 (dependency) | Consumes the single reader from SCOPE-2; without it, "the badge lies" fixes would be per-call-site patches. |
| 5 | SCOPE-5 | P6 (dependency) | S7/S8 change *what* the prompt contains, so the cache numbers in SCOPE-6 must be measured after it, not before. |
| 6 | SCOPE-6 | P3 (risk 3) + return | Biggest measurable win (7.5% → ~79% prefix on two tracks) and the only scope whose success is a number. Runs after 5 because both touch the same clause table. |
| 7 | SCOPE-7 | P5 (nice-to-have) | Real, cheap, and safe to land at any point — so it lands when nothing else is in flight, to keep diffs auditable. |
| — | SCOPE-8 | P3 (risk 4) → spike first | A 257-file question. The spike is read-only and can start on day 1; the execution waits for SCOPE-7 to reduce the same file set. |

**Rules that hold across the sequence:**

- `[MAX_ITERATIONS]` defaults to 3. SCOPE-1, 4 and 6 get 5 — each has an
  integration point that can fail in a way tests catch late.
- A discovered task that grows into its own delivery unit is **escalated as a new
  scope**, never absorbed. The ceiling of 9 has one free slot for exactly that.
- No scope opens while the pin gate is red after SCOPE-1. That gate is the
  plan's own floor.

## 3. Detailed sequence per scope

Each scope contract is written inline as JSON. At execution time the executor
writes it to `scopes/scope-N.json` next to the state dir, unchanged; it is the
machine contract, and these blocks are its source.

---

### SCOPE-1: Boundary contract

```
[SCOPE-1] Boundary contract
[TYPE] feature
[MAX_ITERATIONS] 5
[TARGET_FILES]
- data/stelow-source.json
- server/runtime/helper-script.ts
- server/runtime/track-prompts.ts
- server/runtime/artifact-registration.ts
- server/runtime/cli/cli-done-build.ts
- lib/workflow-moves.mjs
- scripts/check-pin-provenance.mjs
- tests/helper-verbs.test.mjs (new)
Dependencies: none
[INTEGRATION-POINTS]
  inbound:  runHelper (every helper call), the build done gate, CI
  outbound: upstream calionauta/stelow (pin, verbs, catalog)
[CAN-DEPLOY-INDEPENDENTLY] true
```

**Goal.** Make the upstream boundary executable instead of documented: a pin
that names a released commit, a declared verb set proven against the pinned
binary, and one script that fails closed when any of the four instruments is red.

**Scope DoD.** `npm run check:pin-provenance` and `test:upstream-drift` are both
green on a clean checkout; the suite fails when a declared verb does not exist in
the vendored helper; research/explore have a working artifact writer again;
`npm run stelow-audit` runs the four instruments and exits non-zero on any red.

| # | Task | Components | Risk | Done Criterion | Order Rationale |
|---|------|-----------|------|---------------|-----------------|
| 1.1 | Re-pin to a released upstream ref and re-sync | `pin`, `data/` | LOW (2) | `check:pin-provenance` exits 0; pin is an ancestor of upstream `main`; drift gate green | P3: everything else is built on this pin |
| 1.2 | Restore the worker's manifest writer; take `artifact-registration.ts` off the build path | `track-prompts`, `cli-done-build` | LOW (2) | A card that produces an audit artifact reaches done; no code path calls an unproven verb | P3: live breakage — research/explore lost their only writer |
| 1.3 | Declare `HOST_HELPER_VERBS` and prove it against the pinned helper | `helper-script`, `tests/helper-verbs` | LOW (2) | A verb the helper does not know fails the suite with the helper's own error text | P-1: the fail-observed guard for the whole boundary |
| 1.4 | Record the manifest owner decision (worker writes `state.md`, or upstream ships the verb) | `pin`, upstream | MEDIUM (3) | One owner stated in the Record; no half-state survives | P3: the same mistake as 1.2 if left implicit |
| 1.5 | Conformance: empty `any_of` and the 5th verb agree with the helper | `workflow-moves` | HIGH (4) | Parity test covers both on one state fixture; projection and helper return the same verdict | P3: a semantic inversion tests never catch by accident |
| 1.6 | `stelow-audit` release gate script wired to CI | `scripts/`, `ci.yml` | LOW (2) | Exits non-zero when any instrument is red; CI runs it | P0: the gate that makes the other tasks stay true |
| 1.7 | Upstream fix: the orchestrator skill must stop teaching `stelow.json` edits | `skills/` (upstream), sync | MEDIUM (3) | No synced skill tells a worker to write a file the guard does not read; pin advances through the release path | P6: sync-owned, so it is upstream work first and a sync second |

**Task 1.7 note.** `skills/` is synced from upstream and cannot be hand-edited.
The task is: fix the section in `calionauta/stelow`, cut a release, dispatch the
sync, and re-advance the pin through the same path 1.1 uses. The audit's S1 costs
4,997 tokens per spawn across 10 stages *and* teaches bypassing the only guard,
which is why it is a task in the boundary scope rather than a prose cleanup in
SCOPE-7.

**Acceptance criteria**

| # | Observable outcome | Test |
|---|---|---|
| 1.AC-1 | The pin names a commit reachable from upstream `main` | `tests/pin-provenance.test.mjs` |
| 1.AC-2 | No production path calls a verb the pinned helper rejects | `tests/helper-verbs.test.mjs` (new) |
| 1.AC-3 | A card that produces an artifact reaches `done` | `tests/runtime-cli-done-gates.test.mjs` |
| 1.AC-4 | `any_of: []` yields the same verdict from projection and helper | `tests/workflow-moves.test.mjs` |
| 1.AC-5 | All five transition verbs are projected or refused with a named reason | `tests/workflow-moves.test.mjs` |
| 1.AC-6 | The gate exits non-zero on a red instrument, zero on a green tree | `tests/release-gate.test.mjs` (new) |
| 1.AC-7 | No synced skill instructs a write the helper's guard does not read | `tests/skills-instruction-contract.test.mjs` (new) |

**NFRs.** `error_handling`: the gate reports *which* instrument failed and its
exit code, never a generic failure. `observability`: the verb test prints the
helper's stderr verbatim. `rollback`: each task is independently revertible; the
pin revert is content-neutral. `security`: no new credential or network path —
the gate is offline by design.

```json
{
  "acceptance_criteria": [
    "The pin names a commit reachable from upstream main",
    "No production path calls a verb the pinned helper rejects",
    "A card that produces an artifact reaches done",
    "any_of: [] yields the same verdict from projection and helper",
    "All five transition verbs are projected or refused with a named reason",
    "The gate exits non-zero on a red instrument, zero on a green tree",
    "No synced skill instructs a write the helper's guard does not read"
  ],
  "verify_commands": ["npm run test:helper-sync", "npm run test:upstream-drift",
                      "npm run test:workflow-facts", "npm run test:contracts",
                      "npm run check:pin-provenance"],
  "target_files": ["server/runtime/helper-script.ts",
                   "server/runtime/track-prompts.ts", "lib/workflow-moves.mjs"],
  "test_map": {
    "tests/helper-verbs.test.mjs": ["No production path calls a verb the pinned helper rejects"],
    "tests/pin-provenance.test.mjs": ["The pin names a commit reachable from upstream main"],
    "tests/runtime-cli-done-gates.test.mjs": ["A card that produces an artifact reaches done"],
    "tests/workflow-moves.test.mjs": ["any_of: [] yields the same verdict from projection and helper",
                                      "All five transition verbs are projected or refused with a named reason"],
    "tests/release-gate.test.mjs": ["The gate exits non-zero on a red instrument, zero on a green tree"],
    "tests/skills-instruction-contract.test.mjs": ["No synced skill instructs a write the helper's guard does not read"]
  },
  "baseline": { "npm run check:pin-provenance": 1 }
}
```

**FEATURES.md:** no entry. This scope restores intended behaviour and adds a
gate; nothing new is offered to a user.

---

### SCOPE-4: Claims, lock, and the reconciler's cost

```
[SCOPE-4] Claims, lock, and reconciler cost
[TYPE] feature
[MAX_ITERATIONS] 5
[TARGET_FILES]
- server/runtime/scope-start-gate.ts
- server/runtime/claim-coordination.ts
- lib/scope-merge.mjs
- lib/scope-retry.mjs
- server/runtime/reconciler.ts
Dependencies: none
[INTEGRATION-POINTS]
  inbound:  scope start gate, the 45 s reconciler timer
  outbound: SQLite claims table, worktrees
[CAN-DEPLOY-INDEPENDENTLY] true
```

**Goal.** One ownership protocol for claims, and a reconciler that costs what the
work costs. B3 is decided by a rule, not by taste: **the scope-batch bootstrap is
dead code unless it is reachable from a user action in one task.**

**Scope DoD.** Either the scope-batch path reaches `claimScopeBatchRun` from a
user action with a test proving it, or `lib/scope-merge.mjs`, `lib/scope-retry.mjs`
and the `scope_retry_ledger` table are deleted with the tests that only serve
them; claims renew; a steal is announced; a swallowed release failure surfaces;
the poll skips unchanged idle edges and its concurrency is capped.

| # | Task | Components | Risk | Done Criterion | Order Rationale |
|---|------|-----------|------|---------------|-----------------|
| 4.1 | Decide B3 by reachability: delete or wire the bootstrap | `scope-start-gate`, `scope-merge`, `scope-retry` | HIGH (4) | A test starts a batch from a user action, or the modules and table are gone | P3: everything else in this scope assumes an answer |
| 4.2 | `--ttl` is honoured or removed from the docs | `claim-coordination` | LOW (2) | Setting a TTL changes expiry; the doc matches behaviour | P6: smallest honest fix, unblocks 4.3 |
| 4.3 | Claims renew while held; a steal is announced | `claim-coordination` | MEDIUM (3) | A claim held past the TTL is still exclusive; a steal writes `stolen[]` plus a trail comment | P3: silent theft is the failure that loses work |
| 4.4 | A failed release surfaces instead of being swallowed | `claim-coordination` | MEDIUM (3) | Releasing a claim that is not held reports failure to the caller | P-1: the bug exists because nothing observed it |
| 4.5 | One failure model for the merge lock | `scope-merge` | MEDIUM (4) | The merge lock uses the claim table, or the divergence is documented with its consequence | P3: two models for one concept is the audit's S-class defect |
| 4.6 | Poll skips unchanged idle edges; concurrency is capped | `reconciler` | MEDIUM (3) | An idle card triggers no artifact-tree scan; concurrent syncs respect the cap | P5: cost, not correctness |

**Acceptance criteria**

| # | Observable outcome | Test |
|---|---|---|
| 4.AC-1 | A batch either starts from a user action or does not exist | `tests/scope-batch-wiring.test.mjs` |
| 4.AC-2 | A claim held past its TTL stays exclusive to its holder | `tests/scope-claims-contention.test.mjs` |
| 4.AC-3 | A steal is recorded, not silent | `tests/card-claims.test.mjs` |
| 4.AC-4 | Releasing a claim that is not held reports failure | `tests/claims-lifecycle.test.mjs` |
| 4.AC-5 | The merge lock has one documented failure model | `tests/lock-protocol-contract.test.mjs` |
| 4.AC-6 | An unchanged idle edge causes no rescan; syncs above the cap wait | `tests/runtime-reconciler.test.mjs` |

**NFRs.** `error_handling`: a lost claim is reported to the caller, never
inferred from absence. `observability`: every steal and every failed release
leaves an openable trail comment. `rollback`: deletion of the dormant path is
revertible by revert, not by migration surgery. `security`: the claims table
stays the only arbiter; no in-memory lock may grant exclusivity.

```json
{
  "acceptance_criteria": [
    "A batch either starts from a user action or does not exist",
    "A claim held past its TTL stays exclusive to its holder",
    "A steal is recorded, not silent",
    "Releasing a claim that is not held reports failure",
    "The merge lock has one documented failure model",
    "An unchanged idle edge causes no rescan; syncs above the cap wait"
  ],
  "verify_commands": ["npm run test:scope-batch", "npm run test:inbox",
                      "npm run test:reconciler", "npm run test:contracts"],
  "target_files": ["server/runtime/claim-coordination.ts",
                   "server/runtime/reconciler.ts", "lib/scope-merge.mjs"],
  "test_map": {
    "tests/scope-batch-wiring.test.mjs": ["A batch either starts from a user action or does not exist"],
    "tests/scope-claims-contention.test.mjs": ["A claim held past its TTL stays exclusive to its holder"],
    "tests/card-claims.test.mjs": ["A steal is recorded, not silent"],
    "tests/claims-lifecycle.test.mjs": ["Releasing a claim that is not held reports failure"],
    "tests/lock-protocol-contract.test.mjs": ["The merge lock has one documented failure model"],
    "tests/runtime-reconciler.test.mjs": ["An unchanged idle edge causes no rescan; syncs above the cap wait"]
  }
}
```

**FEATURES.md:** yes if 4.1 deletes a documented capability — the entry for
scope batches must lose it in the same commit. If 4.1 wires it, the entry stays
and gains the condition under which a batch can start.

---

### SCOPE-2: Facts with one owner

```
[SCOPE-2] Facts with one owner
[TYPE] feature
[MAX_ITERATIONS] 3
[TARGET_FILES]
- lib/workflow-state.mjs
- server/runtime/board-read.ts
- server/runtime/card-seams.ts
- lib/artifact-manifest.mjs
- lib/stage-skips.mjs
Dependencies: SCOPE-1
[INTEGRATION-POINTS]
  inbound:  panel, board, `bb stelow advance`
  outbound: state.md, the transition catalog
[CAN-DEPLOY-INDEPENDENTLY] true
```

**Goal.** Four facts get one reader each, and the panel and the helper stop
disagreeing: current stage, the artifact manifest, whether `context` runs, and
the state-dir path.

**Scope DoD.** `current_stage` has one exported reader and zero ad-hoc regexes;
one resolution rule decides which `artifacts:` block is authoritative, and both
readers apply it; the timeline path and the move path answer "does `context`
run" identically for the same state.

| # | Task | Components | Risk | Done Criterion | Order Rationale |
|---|------|-----------|------|---------------|-----------------|
| 2.1 | One exported `currentStage(stateDir)`; migrate call sites | `workflow-state`, `board-read`, `card-seams` | MEDIUM (3) | Two unanchored regexes deleted; 7 call sites use the reader | P2: the enabler for SCOPE-3 |
| 2.2 | `board-read` resolves the state dir through the ownership resolver | `board-read` | LOW (2) | No hand-built path remains in the module | P6: same fact, same owner as 2.1 |
| 2.3 | One manifest resolution rule; refuse a second block | `artifact-manifest` | MEDIUM (3) | Both readers return the same list for a file with two blocks; writing a second block fails | P3: two readers returning two lists is data loss, not drift |
| 2.4 | Both paths receive `quality`/`explorationCount` | `stage-skips` | MEDIUM (3) | Panel and `advance` agree on `context` for the same state | P3: the panel currently promises a move the helper refuses |
| 2.5 | Golden fixture: one state, three surfaces, one answer | `tests/` | LOW (2) | The fixture fails if any surface diverges | P-1: the guard that keeps the three from drifting again |

**Acceptance criteria**

| # | Observable outcome | Test |
|---|---|---|
| 2.AC-1 | One reader yields the current stage; no module re-derives it | `tests/workflow-state-resolution.test.mjs` |
| 2.AC-2 | The state dir comes from the ownership resolver | `tests/workflow-lineage.test.mjs` |
| 2.AC-3 | Two readers, one manifest list | `tests/artifact-manifest.test.mjs` |
| 2.AC-4 | Panel and `advance` agree on whether `context` runs | `tests/stage-skips.test.mjs` |
| 2.AC-5 | One state fixture produces one answer on three surfaces | `tests/workflow-state-identity.test.mjs` |

**NFRs.** `error_handling`: an unreadable state file yields "unknown", never a
guess and never zero. `observability`: the reader names the file and line it
read when a state is malformed. `rollback`: mechanical — the old call sites are
restored by revert. `security`: no new path traversal surface; the resolver is
the only way to a state dir.

```json
{
  "acceptance_criteria": [
    "One reader yields the current stage; no module re-derives it",
    "The state dir comes from the ownership resolver",
    "Two readers, one manifest list",
    "Panel and advance agree on whether context runs",
    "One state fixture produces one answer on three surfaces"
  ],
  "verify_commands": ["npm run test:workflow-lineage", "npm run test:contracts",
                      "npm run test:research", "npm run typecheck"],
  "target_files": ["lib/workflow-state.mjs", "server/runtime/board-read.ts",
                   "lib/artifact-manifest.mjs", "lib/stage-skips.mjs"],
  "test_map": {
    "tests/workflow-state-resolution.test.mjs": ["One reader yields the current stage; no module re-derives it"],
    "tests/workflow-lineage.test.mjs": ["The state dir comes from the ownership resolver"],
    "tests/artifact-manifest.test.mjs": ["Two readers, one manifest list"],
    "tests/stage-skips.test.mjs": ["Panel and advance agree on whether context runs"],
    "tests/workflow-state-identity.test.mjs": ["One state fixture produces one answer on three surfaces"]
  }
}
```

**FEATURES.md:** yes if the panel's "next stage" hint changes for a card whose
configuration has `quality`/`explorationCount` — that is a visible correction.

---

### SCOPE-3: State honesty

```
[SCOPE-3] State honesty
[TYPE] feature
[MAX_ITERATIONS] 3
[TARGET_FILES]
- lib/question-gate.mjs
- server/runtime/pending-questions.ts
- server/runtime/runtime-core.ts
- server/runtime/card/restore.ts
Dependencies: SCOPE-2
[INTEGRATION-POINTS]
  inbound:  ask gate, card restore, thread lifecycle
  outbound: inbox badge, question events, card status
[CAN-DEPLOY-INDEPENDENTLY] false
```

**Goal.** No wait without a live question behind it, no badge that outlives its
cause, no question that disappears because a read failed.

**Scope DoD.** `--force` either respects the substance floor or the floor is
removed and the docstring says so; restore closes what it withheld; a terminal
card never shows a waiting hero; an unreadable source yields "unknown"; a
recovered thread carries no stale error; "mark done" has one writer.

| # | Task | Components | Risk | Done Criterion | Order Rationale |
|---|------|-----------|------|---------------|-----------------|
| 3.1 | Resolve `--force` vs the substance floor; align docstring and test | `question-gate` | HIGH (4) | One behaviour, stated once, and the test asserts it rather than certifying a contradiction | P3: a test that pins the bug is worse than no test |
| 3.2 | Restore closes what it withheld, or names the exit | `restore` | HIGH (4) | After restore, the badge is clear and a new worker is not blocked by a question it did not ask | P3: reproduced by the auditor |
| 3.3 | Terminal status filters the waiting surface | `pending-questions` | LOW (2) | A done card with zero open questions shows no waiting hero | P6 |
| 3.4 | Failed read returns "unknown", not empty | `pending-questions` | MEDIUM (3) | `null` on failure, `[]` on genuinely empty | P-1: "unknown is not zero" gets a guard |
| 3.5 | `markThreadRunning` clears `last_error` on every track | `runtime-core` | LOW (2) | research/explore show no eternal error after recovering | P6: the build already does this |
| 3.6 | One "mark done" writer | `runtime-core` | MEDIUM (3) | One call site; the other route is deleted | P6 |

**Acceptance criteria**

| # | Observable outcome | Test |
|---|---|---|
| 3.AC-1 | A forced probe respects the floor, or the floor no longer exists and the docstring says so | `tests/question-substance.test.mjs` |
| 3.AC-2 | After restore, no badge and no blocker from a withheld question | `tests/runtime-card-restore.test.mjs` |
| 3.AC-3 | A terminal card shows no waiting hero | `tests/runtime-pending-questions.test.mjs` |
| 3.AC-4 | An unreadable source yields "unknown" | `tests/pending-questions.test.mjs` |
| 3.AC-5 | A recovered thread shows no stale error | `tests/runtime-thread-lifecycle.test.mjs` |
| 3.AC-6 | Exactly one writer marks a card done | `tests/terminality-contracts.test.mjs` |

**NFRs.** `error_handling`: "unknown" is a first-class answer on every read
path. `observability`: every withheld-then-closed question leaves a trail line.
`rollback`: behaviour changes are revertible per task. `security`: none — but a
`--force` that bypasses a floor is a policy hole, so the decision in 3.1 is
recorded in the Record.

```json
{
  "acceptance_criteria": [
    "A forced probe respects the floor, or the floor no longer exists and the docstring says so",
    "After restore, no badge and no blocker from a withheld question",
    "A terminal card shows no waiting hero",
    "An unreadable source yields unknown",
    "A recovered thread shows no stale error",
    "Exactly one writer marks a card done"
  ],
  "verify_commands": ["npm run test:question-substance", "npm run test:question-state",
                      "npm run test:inbox", "npm run test:card-details"],
  "target_files": ["lib/question-gate.mjs", "server/runtime/pending-questions.ts",
                   "server/runtime/runtime-core.ts"],
  "test_map": {
    "tests/question-substance.test.mjs": ["A forced probe respects the floor, or the floor no longer exists and the docstring says so"],
    "tests/runtime-card-restore.test.mjs": ["After restore, no badge and no blocker from a withheld question"],
    "tests/runtime-pending-questions.test.mjs": ["A terminal card shows no waiting hero"],
    "tests/pending-questions.test.mjs": ["An unreadable source yields unknown"],
    "tests/runtime-thread-lifecycle.test.mjs": ["A recovered thread shows no stale error"],
    "tests/terminality-contracts.test.mjs": ["Exactly one writer marks a card done"]
  }
}
```

**FEATURES.md:** yes. Three visible corrections (no phantom wait, no eternal
error badge, restore behaves as documented) belong in the same commit as the
behaviour, not in a later "docs" pass.

---

### SCOPE-5: Clause integrity

```
[SCOPE-5] Clause integrity
[TYPE] optimization
[MAX_ITERATIONS] 3
[METRIC] rendered clauses declared in TRACK_PATH_CLAUSES = all of them
[TARGET_FILES]
- server/runtime/track-prompts.ts
- lib/prompt-clause-budgets.mjs
Dependencies: SCOPE-1
[INTEGRATION-POINTS]
  inbound:  spawn, restart, reseed
  outbound: prompt bytes
[CAN-DEPLOY-INDEPENDENTLY] true
```

**Goal.** Every clause the renderer emits is declared, bounded, and read through
its parameter — so deleting one breaks a test instead of passing the suite.

**Scope DoD.** `cardOwnerRules` and `reviewProtocol` are declared; deleting any
declared clause fails the prompt path contract; `userInputContract` is either a
parameter or gone, and its promise in the docstring is true or the promise is
removed; a missing mandatory clause is a compile error.

| # | Task | Components | Risk | Done Criterion | Order Rationale |
|---|------|-----------|------|---------------|-----------------|
| 5.1 | Declare the two emitted-but-undeclared clauses | `track-prompts` | LOW (2) | Deleting either fails the suite | P-1: cheap guard, zero tokens |
| 5.2 | `userInputContract`: parameter, or delete the field | `track-prompts`, `runtime-core` | LOW (2) | No dead field; the most expensive clause has one source | P6 |
| 5.3 | `Required<Pick<…>>` on the shared prefix | `track-prompts` | LOW (2) | A missing mandatory clause fails `typecheck` | P2: makes the next omission a compile error |

**Acceptance criteria**

| # | Observable outcome | Test |
|---|---|---|
| 5.AC-1 | Every rendered clause is declared; deleting one fails the suite | `tests/prompt-path-contract.test.mjs` |
| 5.AC-2 | The shared prefix cannot omit a mandatory clause (compile error) | `tests/prompt-composition.test.mjs` |
| 5.AC-3 | No declared-but-unread prompt field remains | `tests/spawn-path-registry.test.mjs` |

**NFRs.** `error_handling`: a missing clause is a build failure, not a silent
short prefix. `observability`: the budget test prints the clause list it counted.
`rollback`: trivial. `security`: none.

```json
{
  "acceptance_criteria": [
    "Every rendered clause is declared; deleting one fails the suite",
    "The shared prefix cannot omit a mandatory clause (compile error)",
    "No declared-but-unread prompt field remains"
  ],
  "verify_commands": ["npm run test:prompt", "npm run test:source-shape",
                      "npm run typecheck"],
  "target_files": ["server/runtime/track-prompts.ts", "lib/prompt-clause-budgets.mjs"],
  "test_map": {
    "tests/prompt-path-contract.test.mjs": ["Every rendered clause is declared; deleting one fails the suite"],
    "tests/prompt-composition.test.mjs": ["The shared prefix cannot omit a mandatory clause (compile error)"],
    "tests/spawn-path-registry.test.mjs": ["No declared-but-unread prompt field remains"]
  }
}
```

**FEATURES.md:** no. No user-visible surface changes; the prompts get honest, not
different.

---

### SCOPE-6: Cache economy

```
[SCOPE-6] Cache economy
[TYPE] optimization
[MAX_ITERATIONS] 5
[METRIC] cacheable prefix on research/explore spawns: 7.5%/9.9% → target ≥75%
[TARGET_FILES]
- server/runtime/track-prompts.ts
- lib/prompt-clause-budgets.mjs
- lib/prompt-clauses.mjs
Dependencies: SCOPE-5
[INTEGRATION-POINTS]
  inbound:  spawn, restart, reseed
  outbound: provider prompt cache
[CAN-DEPLOY-INDEPENDENTLY] true
```

**Goal.** Move the two tracks from a 7.5%/9.9% cacheable prefix to roughly the
build track's 90%, without losing a clause that changes behaviour.

**Scope DoD.** The prompt budget test reports a cacheable prefix ≥75% for
research and explore; `DONE_PROTOCOL` no longer contradicts the research/explore
track contract; advisory clauses live in the playbook file; every ceiling in
`CLAUSE_CHAR_CEILINGS` matches the new sizes (no ceiling loosened to pass).

| # | Task | Components | Risk | Done Criterion | Order Rationale |
|---|------|-----------|------|---------------|-----------------|
| 6.1 | Reorder track prompts: interpolation to the tail | `track-prompts` | HIGH (4) | Prefix ≥75% on both tracks for the same fixture | P3: biggest win, highest blast radius — measure before and after |
| 6.2 | Split `DONE_PROTOCOL` into track-specific halves | `prompt-clauses` | MEDIUM (3) | Research/explore prompts no longer contain Build-only instructions | P3: they currently contradict the track contract |
| 6.3 | Move the 5 advisory clauses into the playbook file | `prompt-clauses` | MEDIUM (3) | Each clause is reachable from the playbook; the prompt loses ~730 chars per build spawn | P6 |
| 6.4 | Lower the ceilings to the new sizes | `prompt-clause-budgets` | LOW (2) | Budget test passes with tightened ceilings; no ceiling raised | P-1: a budget that loosens to fit is not a budget |

**Acceptance criteria**

| # | Observable outcome | Test |
|---|---|---|
| 6.AC-1 | Research and explore report a cacheable prefix ≥75% | `tests/prompt-cache-order.test.mjs` |
| 6.AC-2 | Research/explore prompts carry no Build-only completion instruction | `tests/prompt-budget.test.mjs` |
| 6.AC-3 | The advisory clauses are served from the playbook | `tests/playbook.test.mjs` |
| 6.AC-4 | Every ceiling is at or below the measured size | `tests/prompt-budget.test.mjs` |

**NFRs.** `error_handling`: a measured prefix below the floor fails the test with
both numbers. `observability`: the test prints chars, tokens and prefix per
track. `rollback`: per-task revert; the reorder is a pure move, so a revert
restores the old order exactly. `security`: none.

```json
{
  "acceptance_criteria": [
    "Research and explore report a cacheable prefix >= 75%",
    "Research/explore prompts carry no Build-only completion instruction",
    "The advisory clauses are served from the playbook",
    "Every ceiling is at or below the measured size"
  ],
  "verify_commands": ["npm run test:prompt", "npm run test:research",
                      "npm run test:fast"],
  "target_files": ["server/runtime/track-prompts.ts", "lib/prompt-clauses.mjs"],
  "test_map": {
    "tests/prompt-cache-order.test.mjs": ["Research and explore report a cacheable prefix >= 75%"],
    "tests/prompt-budget.test.mjs": ["Research/explore prompts carry no Build-only completion instruction",
                                     "Every ceiling is at or below the measured size"],
    "tests/playbook.test.mjs": ["The advisory clauses are served from the playbook"]
  }
}
```

**FEATURES.md:** no user-visible change. The token numbers quoted in
`docs/model-tier-economics.md` must be updated in the same commit — it carries
measured values, so it drifts the moment they move.

---

### SCOPE-7: Noise and prose

```
[SCOPE-7] Noise and prose
[TYPE] optimization
[MAX_ITERATIONS] 3
[METRIC] exports with no external reader: 275 → 0; orphan files: 2 → 0
[TARGET_FILES]
- lib/*.mjs, server/runtime/*.ts (prune only)
- docs/remaining-debt-audit.md
- prompt-cache-order.test.mjs, prompt-clause-budgets.mjs
Dependencies: SCOPE-1
[INTEGRATION-POINTS]
  inbound:  none
  outbound: none
[CAN-DEPLOY-INDEPENDENTLY] true
```

**Goal.** Delete what nothing reads, and stop restating numbers that a gate
already measures.

**Scope DoD.** knip reports zero unused exports; the stub `contextAskGate` and
the dead constants are gone or real; both orphan files are deleted; the three
aged prose claims match measurement; `remaining-debt-audit.md` points at
`check-source-budgets.mjs` instead of quoting values.

| # | Task | Components | Risk | Done Criterion | Order Rationale |
|---|------|-----------|------|---------------|-----------------|
| 7.1 | Prune unused exports, stub, dead constants | `lib/`, `server/` | MEDIUM (3) | knip clean; the stub is deleted or has a reader | P6: mechanical, but wide — do it in one pass |
| 7.2 | Delete the 2 orphan files | `components/`, `tests/fixtures` | LOW (2) | No reference remains | P5 |
| 7.3 | Correct the three aged prose claims | `tests/`, `lib/`, `docs/` | LOW (2) | Each claim matches the measured value or is deleted | P-1: prose that contradicts a gate teaches the wrong number |
| 7.4 | `remaining-debt-audit.md` points at the gate | `docs/` | LOW (2) | The doc names `check-source-budgets.mjs`; it no longer quotes ceilings | P5 |

**Acceptance criteria**

| # | Observable outcome | Test |
|---|---|---|
| 7.AC-1 | No export lacks an external reader | `npm run deadcode` |
| 7.AC-2 | No source file is orphaned | `tests/bundle-source-path.test.mjs` |
| 7.AC-3 | Documented numbers match the gate's numbers | `tests/prompt-budget.test.mjs` |
| 7.AC-4 | The debt doc defers to the gate | `tests/docs-index.test.mjs` + review |

**NFRs.** `error_handling`: pruning runs after a full `typecheck`, so a false
"unused" cannot delete a live contract. `observability`: the knip report before
and after goes in the Record. `rollback`: revert. `security`: none.

```json
{
  "acceptance_criteria": [
    "No export lacks an external reader",
    "No source file is orphaned",
    "Documented numbers match the gate's numbers",
    "The debt doc defers to the gate"
  ],
  "verify_commands": ["npm run deadcode", "npm run typecheck",
                      "npm run test:source-shape", "npm run lint"],
  "target_files": ["lib/", "docs/remaining-debt-audit.md"],
  "test_map": {
    "tests/source-shape.test.mjs": ["No source file is orphaned"],
    "tests/prompt-budget.test.mjs": ["Documented numbers match the gate's numbers"]
  }
}
```

**FEATURES.md:** no.

---

### SCOPE-8: Declaration surface

```
[SCOPE-8] Declaration surface
[TYPE] spike
[MAX_ITERATIONS] 3
[TARGET_FILES]
- types/ (257 .d.mts)
- tsconfig*.json
Dependencies: none
[INTEGRATION-POINTS]
  inbound:  tsc --noEmit
  outbound: consumer type-checking
[CAN-DEPLOY-INDEPENDENTLY] true
```

**Goal.** Answer one question with evidence: are 257 hand-written `.d.mts` for
270 `.mjs` load-bearing, generatable, or deletable?

**Scope DoD.** A written verdict with numbers — generated-vs-hand-written diff
size, `tsc` time and pass state for each option — and a decision, not a
recommendation to investigate.

| # | Task | Components | Risk | Done Criterion | Order Rationale |
|---|------|-----------|------|---------------|-----------------|
| 8.1 | Measure: generate declarations and diff against the hand-written set | `tsc`, `types/` | HIGH (4) | Numbers for all three options (keep, generate, delete) | P3: score 4, spike before implementation |
| 8.2 | Verify `declaration-surface.test.mjs` scope: names only, or signatures | `tests/` | LOW (2) | Stated whether a signature drift is currently detectable | P-1: measures whether the surface has a guard at all |
| 8.3 | Decide and record | — | LOW (2) | One option chosen with its cost and its rollback | P5: the decision is the deliverable, not the code |

**Acceptance criteria**

| # | Observable outcome | Test |
|---|---|---|
| 8.AC-1 | The Record states, per option, the diff size and `tsc` result | spike Record |
| 8.AC-2 | The test's actual coverage is stated (names vs signatures) | `tests/declaration-surface.test.mjs` |

**NFRs.** `error_handling`: the spike touches no product code. `observability`:
numbers in the Record, never estimates. `rollback`: none needed. `security`:
none.

```json
{
  "acceptance_criteria": [
    "The Record states, per option, the diff size and tsc result",
    "The test's actual coverage is stated (names vs signatures)"
  ],
  "verify_commands": ["npm run typecheck", "node tests/declaration-surface.test.mjs"],
  "target_files": ["types/"],
  "test_map": {
    "tests/declaration-surface.test.mjs": ["The test's actual coverage is stated (names vs signatures)"]
  }
}
```

**FEATURES.md:** only if the chosen option changes what a consumer can type — in
that case the version bump is `BREAKING CHANGE:` and the plan stops for a human
decision.

## 4. Execution protocol (applies to every scope)

The strap the executor follows, in the order it matters. Deviating is allowed;
skipping the Record is not.

1. **Baseline, before any edit.** Run every `verify_commands` entry once against
   the untouched tree and store the exit codes. A command that cannot run
   pre-change goes in Limitations, never in the baseline as a guess.
2. **Red proof.** Before implementing, run the mapped test that should change and
   record that it *fails*, with an excerpt. A guard never seen failing is
   untrusted; an acceptance criterion whose test was green before the work means
   the criterion is not measuring the work.
3. **Freeze.** Pin the acceptance text (`freeze_sha`) at the red moment. Never
   edit the frozen test to make it pass — re-freeze under a new sha, in its own
   commit, with the reason.
4. **Implement in task order.** The task table's `Order Rationale` is binding
   unless reality disagrees; when it does, the Record says why.
5. **Verify.** Scope's `verify_commands` green, then `npm test` once at close.
   Both go in the Record with exit codes, not adjectives.
6. **Record.** Files touched (from `git diff start_sha..HEAD`), commands with
   exits, baseline vs close comparison, red proof, freeze, limitations and
   non-claims. A ✅ without a Record is unearned.
7. **PR.** Branch → PR → squash. A `feat:` commit carries its `FEATURES.md`
   entry; a `docs:` commit never bumps. Never push to `master`, never merge the
   release PR on sight.

**Test authorship.** Criteria in this plan are written by the planner; the
assertions are written or red-teamed in a fresh context, or described by the
human for the critical cases (SCOPE-1's verb guard, SCOPE-2's golden fixture,
SCOPE-3's restore path). The implementing agent does not author the test that
certifies its own change.

**Escalation.** A discovered task that grows into a delivery unit becomes a new
scope (one slot free under the ceiling of 9). A scope that exhausts
`[MAX_ITERATIONS]` stops and escalates with its Record, not with a retry.

## 5. Dangers and uncertainties

| Risk | Probability × impact | What to avoid | Path forward |
|---|---|---|---|
| The re-pin (1.1) moves behaviour because the pin was carrying an unreleased fix | low × high | Assuming "content is identical" without diffing the helper | Diff `data/stelow` before and after; if it differs, that diff is itself a finding and SCOPE-1 grows a task |
| Deleting the scope-batch (4.1) removes something a user depends on | medium × high | Deciding by intuition | Decide by reachability: no user action reaches the gate → delete, and the deletion is a `feat:` commit naming the capability removed |
| Reordering prompts (6.1) changes behaviour through cache-priming side effects | medium × medium | Shipping both reorder and clause split in one commit | One task per commit; measure prefix after each |
| The declaration spike (8.x) ends in a rewrite that is larger than the audit | medium × medium | Starting the rewrite inside the spike | The spike's output is a decision with numbers; the rewrite, if chosen, is a new scope |
| The plan itself becomes a second source of truth | high × medium | Copying measured numbers into prose | Every criterion ends as a test; this file's §0.1 numbers are dated and cite the audit |

## 6. Summary

Eight scopes, two of them measurable by a number (prefix %, dead exports), one by
reachability (scope-batch), one by decision (declaration surface). The four that
matter most are the ones the audit called blockers: a pin that names a release, a
verb that exists, a protocol that starts, and a manifest with one owner — each
with a test that would have failed before the fix.

Main functional scope names: **Boundary contract**, **Claims/lock/reconciler**,
**Facts with one owner**, **State honesty**, **Clause integrity**, **Cache
economy**, **Noise and prose**, **Declaration surface**.
