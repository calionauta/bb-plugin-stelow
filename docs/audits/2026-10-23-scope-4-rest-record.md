# SCOPE-4 record — claims, lock, and the reconciler's cost

**Type:** execution record for `SCOPE-4` of `2026-10-23-stelow-audit-repair-plan.md`.
**Date:** 2026-10-23
**Branch:** `fix/claims-lock-rest-2026-10-23`, based on `origin/master` @ `2e9cba9d`.
**Status:** 4.3 done, 4.5 done (documented-divergence branch), 4.6 deferred.

## What the repair agent left behind

The worktree held one commit and one staged change, no unstaged work:

- `f653075f` — task 4.3, *renew a supervised holder's claim and report takeovers*.
  Complete on its own terms: the reconcile tick slides the lease of holders the
  host still supervises, `acquireScopeClaims` returns `stolen[]`,
  `claimScopeBatchRun` and `scopeStartGate` carry it, the CLI leaves one trail
  comment. Not re-opened here.
- Staged on top of it: `lib/scope-merge.mjs` (+32 lines, one docstring section)
  and `tests/lock-protocol-contract.test.mjs` (+72 lines, three assertion
  blocks). That is task 4.5.

## 4.5 — decision: finish the documented-divergence branch

The task's done criterion offers two outcomes: *the merge lock uses the claim
table*, or *the divergence is documented with its consequence*. The residue is
the second, and 4.AC-5 maps it to `tests/lock-protocol-contract.test.mjs`, the
file it edits. So the change is justifiable from the commit message, the audit
finding ("The merge lock is an in-memory `Set` — a different failure model for
the same concept") and the code, which is the test for reconstruction:

- The rejected option is argued from the actual key shapes — the claims table is
  keyed by `(workspace, file)` and the lock by `batch`, so a claims row would
  need a synthetic file path that then surfaces in the card's room and in
  `liveClaimsForWorkspace` as a claim no user made. That is checkable and true
  of the code in front of this record.
- Every factual claim the docstring makes was verified, not assumed:
  `withScopeMergeLock` and `mergeScopeBatchRun` (`server/scope-batch.ts:243`)
  both release in a `finally`; `lib/scope-merge.mjs` has no imports at all, so
  "no database dependency" holds; `scopeWorkspace` accepts `effectiveCheckout`;
  `liveClaimsForWorkspace` returns `file_path`.

Nothing was rewritten to make a test pass. The three blocks pin the three
consequences the docstring states: process-local (a second module instance is
not refused), no expiry (an unreleased lock wedges its batch), and no file
exclusivity (a held merge lock neither refuses a claim nor appears in the
registry).

## Red proof — each block seen failing before it was trusted

The residue arrived green, so each guarded behaviour was inverted in turn and
reverted (`git diff` clean afterwards). Excerpts are the assertion messages
that fired:

1. **Process-local.** `mergeLocks = (globalThis.__mergeLocks ??= new Set())`,
   simulating a cross-process promise. Fired: `a second module instance is not
   refused: cross-process exclusion is not promised`.
2. **No expiry.** The second acquisition deletes the key, simulating a lock that
   self-expires. Fired: `a second attempt is refused while the first is
   unreleased`.
3. **No file exclusivity.** `acquireScopeClaims` refuses while a merge lock is
   held, simulating the unification into the claims table. Fired: `the merge
   lock does not refuse a file claim`.

Each mutation produced a distinct failure, so no block is vacuous and none of
them share one assertion.

## Gates — exits, not adjectives

Baseline before the work, from the worktree:

| Command | Exit |
|---|---|
| `npm run --silent typecheck` | 2 (fake — see below) |
| `node tests/lock-protocol-contract.test.mjs` | 0 |

The typecheck red was the install, not the code: `pele@1.8.0` is a declared
dependency absent from the shared `node_modules`, producing `Cannot find module
'pele'` at `server/runtime/platform.ts:145`. The worktree's `node_modules` was a
symlink to the main checkout, so `npm ci` would have followed it and emptied
another thread's install; the symlink was removed first, then `npm ci` ran
locally (12 s, warm cache).

Close, from the worktree:

| Command | Exit |
|---|---|
| `npm run --silent typecheck` | **0** |
| `npm run --silent quality:shape` | **0** |
| `npm test` | **0** |

`quality:shape` reports 23 changed owned files and no line over 160 characters.
The three function-budget entries it lists are inherited at baseline
(`finishScope#1` 51, `mergeScopesAtomically#1` 71, `runScopeCommand#1` 83 of 87);
none were introduced here. Lint sits at its recorded 39 inherited findings.

## 4.6 — deferred, with the reason

*Poll skips unchanged idle edges; concurrency is capped* was not attempted, and
it is not small. `reconcileLiveCards` (`server/runtime/reconciler.ts:64`) fires
`void deps.syncThreadState(row.id)` and `void deps.scopeProgress.sync(row.id)`
per live card, unawaited and uncapped — the cap is a limiter plus its own test.
The skip is larger: the artifact-tree rescan is not in the reconciler at all, it
is downstream in `card-detail-artifacts.ts` / `research-artifacts.ts`, so "the
idle edge has not changed" needs a change signal plumbed from the artifact
writer. That is two modules outside SCOPE-4's touched file set, a known
integration point, and 4.AC-6 owns its own test map entry. Landing it in the
same commit as a lock-model docstring would make neither reviewable.

## Limitations and non-claims

- **4.1 is still open, and that matters.** This record documents the failure
  model of a lock whose only production caller is the dormant batch path
  (`server/scope-batch.ts:250`, reached from tests only). If 4.1 resolves toward
  deletion, this docstring and its three blocks go with it — they are written so
  that deleting them is one revert, not a rewrite.
- Cross-process merge exclusion is still not provided. The docstring says so; it
  does not add it.
- No `FEATURES.md` entry: nothing user-facing changed. No user-visible string,
  route or card surface is touched.
- `docs/audits/` is untracked on this branch, so the plan and the audit this
  record cites do not resolve in-tree; they live in the working checkout. The
  directory is meant to be deletable, so nothing else depends on them.
- Not pushed, not merged, not tagged. `server/scope-batch.ts` was read and not
  edited, per the standing product decision on the dormant batch protocol.

## What a human should look at first

The docstring's premise: 4.5 justifies why the merge lock stays out of the
claims table, and the lock's only caller is the batch path whose deletion 4.1
has not yet decided. Sequence 4.1 before merge, or accept that this documents a
lock that may be removed.
