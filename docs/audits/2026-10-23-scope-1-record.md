# SCOPE-1 record — boundary contract

**Scope:** SCOPE-1 of `2026-10-23-stelow-audit-repair-plan.md`
**Date:** 2026-10-23
**Branch:** `fix/boundary-contract-2026-10-23` (from `origin/master` 75851ae6)
**Status:** done except one task that cannot be done in this repository (§6).

## 1. Baseline, captured before any edit

| Command | Exit | Note |
|---|---|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | 39 inherited findings, baseline clean |
| `npm run test:workflow-facts` | 0 | |
| `npm run test:contracts` | 0 | |
| `npm run check:pin-provenance` | 0 | **B1 already green on master** |
| `npm run test:upstream-drift` | 0 | |

## 2. What the audit asked for, and what the tree actually held

The audit measured branch `fix/context-policy-parity` with uncommitted work. Its
two blockers are not both true of `origin/master`, and checking that first
changed the work:

| Finding | On `origin/master` | Consequence for the plan |
|---|---|---|
| B1 pin is a branch tip | **false** — `data/stelow-source.json` pins `e7d87e7`, the squash-merged release commit; the gate exits 0 | task 1.1 needed no edit; the audit's `e1c03cb` was the pre-squash ref of the branch it measured |
| B2 host calls `artifacts add` | **false** — `server/runtime/artifact-registration.ts` does not exist, and `git grep "writes the artifact manifest" origin/master` finds nothing | tasks 1.2 and 1.4 had nothing to revert; the class is guarded instead of patched |
| S2 empty `any_of` inverted | **true** | fixed |
| S3 the fifth transition verb dropped | **true, in three places** | fixed where it mattered, pinned where it did not |
| S1 skill teaches `stelow.json` | **true** — `skills/stelow-workflow-orchestrator/SKILL.md:328` | upstream task, not done (§6) |

This is the plan's own rule working: *the authority is the gate, not the prose*.
Two of the three blockers were a branch that no longer exists.

## 3. Commands run, with exits

| Command | Exit | Note |
|---|---|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | no new finding |
| `npm run quality:shape` | 0 | shape, budgets, boot cost, lint baseline |
| `npm run test:workflow-facts` | 0 | 18 stages, no dead ends |
| `npm run test:contracts` | 0 | |
| `npm run test:runtime-seams` | 0 | includes the moves/helper parity |
| `npm run test:declaration-surface` | 0 | 264 files |
| `npm run test:upstream-hygiene` | 0 | now includes the gate's own verdict tests |
| `npm run test:helper-sync` | 0 | now includes verbs + boundary parity |
| `node tests/source-pins-guard.test.mjs` | 0 | 28/28 — unchanged, after a guard was removed (§5) |
| `npm run architecture` | 0 | no dependency violations |
| `npm test` | 0 | full suite |
| `npm run stelow-audit` | 0 | **GREEN — 4 instruments** |
| `node scripts/stelow-audit.mjs --offline` | 0 | 3 PASS + "provenance not verified (--offline)" |

## 4. Red proofs (each guard was seen failing on the old behaviour)

| # | Reverted | The assertion that failed |
|---|---|---|
| 1 | `TRANSITION_KINDS` back to four verbs | `the host validates every transition verb the helper accepts` — actual `[accept, next, reject, rework]`, expected five |
| 2 | the empty-disjunction branch in `policyConditionHolds` | `a rule with no any_of fires when its conjunction holds` |
| 3 | the funnel in `runHelper` | `the refusal names the bug` — bash's `unknown subcommand` came back instead |
| 4 | (guard later deleted) a synthetic `runHelper(["artifacts","add"])` in `server/scopes.ts` | `these call sites pass a verb that is not declared: server/scopes.ts → artifacts` |

Proof 4 validated a guard that was then removed on purpose — see §5. Each fix was
restored from a byte copy and the suite re-run green between proofs.

## 5. Files touched

| File | Change |
|---|---|
| `lib/helper-verbs.mjs` (new) | the declared verb set, `isDeclaredVerb`, `undeclaredVerbRefusal` |
| `lib/helper-verbs.d.mts` (new) | declaration, so `server/` can import it (`typecheck` needs it — see §7) |
| `server/runtime/helper-script.ts` | refuses an undeclared verb before spawning, as a `HelperResult`, never a throw |
| `lib/transition-facts.mjs` | `annotate` is a transition kind: parser + validator |
| `lib/workflow-catalog.mjs` | `STAGE_TRANSITIONS` documents why it projects four MOVE verbs |
| `lib/workflow-moves.mjs` | empty disjunction matches the helper; `policyConditionHolds` exported for the parity test |
| `lib/audit-gate.mjs` (new) | the gate's verdict: plan, per-instrument result, summary, exit code |
| `scripts/stelow-audit.mjs` (new) | runs the instruments, not the verdict |
| `tests/helper-verbs.test.mjs` (new) | probe + funnel |
| `tests/boundary-parity.test.mjs` (new) | verb parity, annotate audited and never a move, policy semantics |
| `tests/audit-gate.test.mjs` (new) | fail-closed verdict, named failures, offline skips |
| `package.json` | `stelow-audit`, `test:helper-verbs`, `test:boundary`, `test:audit-gate`; wired into existing bands |
| `.github/workflows/ci.yml` | the gate replaces the standalone provenance step |

## 6. Task-by-task against the plan

| Task | Plan | Reality |
|---|---|---|
| 1.1 re-pin | re-pin to a released ref | **already green**; no edit. Baseline gate run is the evidence |
| 1.2 restore the worker writer | revert the host-writes-manifest prompt | **not applicable**; the line and the file are absent from master |
| 1.3 declare the verb set | one list, proven against the pin | **done**: 8 verbs, 10 call sites, probe + funnel. The source scan was removed (§7) |
| 1.4 record the manifest owner | one owner, no half-state | **implicit**: master has no host writer, so the worker owns it. Recorded here; no code to change |
| 1.5 conformance | empty `any_of`, fifth verb | **done and larger**: three sites, not one — validator kinds, parser regex, and the move projection, where annotate is excluded on purpose and pinned |
| 1.6 release gate | one script, four instruments, fails closed | **done**: pure verdict + thin runner + CI + 12 assertions |
| 1.7 upstream skill | replace the `stelow.json` bypass upstream | **not done**: needs a release in `calionauta/stelow` and a dispatch. Verified still present on master |

## 7. Deviations, and what they cost

- **The third guard was deleted.** A source scan over `server/` ("every literal
  helper call names a declared verb") is a source-text pin, and
  `tests/source-pins-guard.test.mjs` ratchets that class **down** — it failed the
  suite at 29 files against a ceiling of 28. The funnel keeps the behavioural
  half: an undeclared verb is refused at first execution, before the spawn, with
  a message naming the verb and the declared set. What is lost: a new call site is
  caught when it runs, not when it is committed. Given the choice between that
  and growing a pin class the repository is retiring, the repository wins — and
  the loss is named here rather than discovered later.
- **The gate runs four instruments, not the audit's "5 `gen:*:check`"** — those
  generators live upstream and are not vendored here. The gate covers what this
  repository can actually prove offline plus one network call.
- **`npm run stelow-audit --offline` does not skip anything.** npm consumes
  `--offline` as its own flag; the script documents `-- --offline`. The failure
  mode is the safe direction (the full gate runs), and it is documented in the
  script rather than left to be discovered.
- **A declaration file was needed** for `lib/helper-verbs.mjs`. That is SCOPE-8's
  debt showing up in practice: every `.mjs` `server/` imports needs a
  hand-written `.d.mts`. One more file to maintain by hand, and no test proves the
  declaration matches the implementation — the 264-file surface test only checks
  that files exist.

## 8. Limitations and non-claims

- The gate's fail-closed path was proven at the pure level and through the
  offline skip; it was **not** proven by breaking the pin for real (that needs a
  network-side manipulation and would leave the tree in a red state).
- The `any_of` fix has **no user-visible effect today**: every shipped policy
  carries a disjunction, which the parity test asserts. The fix is for the day one
  does not — and for the fact that the projection and the helper must answer the
  same question, not merely the same answer.
- The audit's S1 (the skill teaching `stelow.json`) is **still open**, still
  costs 4,997 tokens per spawn, and still teaches a write the guard does not
  read. It cannot be fixed from this repository.
- Scopes 4, 2, 3, 5, 6, 7 and 8 are **not started**.
