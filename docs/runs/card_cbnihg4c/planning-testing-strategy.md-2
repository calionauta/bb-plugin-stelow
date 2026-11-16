---
version: 1
product_type: software
generated_by: stelow-workflow-testing-ai-code
generated_at: 2026-09-30
task: planning-testing
recipe: planning-research
stage: planning
appetite: Complete
context: brownfield
repository: /home/deploy/repos/bb-plugin-stelow
plugin_version: 0.58.1
scope_map: scope-map.json#preset-env-kind-map
---

# Testing Strategy for the preset environment kind

Appetite is `Complete` (from the card context, not a default) and the product
context is **brownfield**: `bb-plugin-stelow` is a shipping BB plugin at
`0.58.1` with 332 wired `node:test` files, and this card adds a field to a
preset editor that already exists, wires a seed into three creation dialogs that
already exist, and rewrites two `FEATURES.md` sentences. `Complete` buys breadth
across unit, integration, behaviour and security; brownfield buys a regression
obligation over every path the change touches and a hand-mutation loop over
mutation tooling.

Two repository facts constrain the strategy before any test is written, and both
were verified in this run rather than recalled:

1. **There is no test framework.** `package.json` declares no runner dependency.
   Everything is `node:test` + `node:assert/strict`, with TypeScript sources
   loaded under test by `node --experimental-strip-types --import
   ./tests/register-ts-source.mjs` — a resolver hook that maps extensionless and
   `.js`→`.ts` specifiers the way the bundler does. Two pure-logic tests
   (`tests/component-rule-seams.test.mjs`, `tests/execution-rule-seams.test.mjs`)
   already import `.ts` modules directly through that hook, so the new mapper
   test has a working precedent rather than a theoretical one.
2. **An unwired test file fails the build.** `tests/suite-wiring.test.mjs` reads
   every `tests/*.test.mjs` and fails if its path is absent from `package.json`
   scripts. So "add a test file" and "wire the file into an npm script" are one
   change, and a test dropped in without the script is a red build, not a silent
   orphan.

## Tech Stack

- Language: TypeScript 5.9 (`strict`, `noEmit`) + React 19 JSX, ESM, Node 22
- Unit / behaviour: `node:test` + `node:assert/strict`; TS via
  `--experimental-strip-types` + `tests/register-ts-source.mjs`
- Component execution: `ts.transpileModule` + host stub object, the pattern
  `tests/preset-execution-picker.test.mjs` already uses to *call* a `.tsx`
  component's returned element tree without React or a DOM
- Coverage: none configured. `c8`/`vitest` are absent by design, and adding
  either forks the runner `suite-wiring` depends on. Adequacy is argued from
  hand-mutation evidence instead — see the loop below
- Lint / shape / architecture: `oxlint`, `scripts/check-source-shape.mjs` +
  `scripts/check-source-budgets.mjs` (400-line files, 50-line functions, ledger
  in `scripts/source-debt.json`), `dependency-cruiser`
- Security: `npm audit --omit=dev --audit-level=high` (no SAST in CI)
- CI: `.github/workflows/ci.yml` — `typecheck → quality:shape → quality:report →
  architecture → test → security:production`, on Node 22

## Coverage and Risk Targets

| Path Type | Instances in this card | Required Evidence |
|---|---|---|
| Critical | The pure seed mapper (`env-seed-mapper`); `savePreset`'s client-side kind validation; `selectCardEnvironment` precedence | Hand-mutation per invariant, all three known kinds plus unrecognised plus omitted; negative case asserting the RPC is never called; explicit regression pin that `card-environment.mjs:1-11` is unchanged |
| Standard | The kind control's form writes and disabled states; the list `Pill`; the three dialogs' `defaultEnvironment` prop | Exact-args assertion on what `upsertPreset` receives; reference-stability assertion across two reads; `disabled={busy}` and the built-in disabled condition; `min-h-11` + `cursor-pointer` counted, not string-matched |
| Experimental | The composer re-seed defence (a `seeded-once` ref standing against a host rule this plugin does not own); the non-Git and exploratory-workspace silent fallbacks | Behavioural re-derivation of the documented SDK rule, plus a named-and-recorded limitation in `FEATURES.md` — **not** a test asserting a fallback the host owns |
| Regression | Everything this card edits inside already-tested code: `preset-manager-form.tsx`, `preset-manager-list.tsx`, the three creation dialogs, five echoed copy sites, `FEATURES.md` | Full `npm test` green; the two debt-baseline ceilings re-earned rather than raised; the exact strings pinned at `tests/server-github-issue-flow.test.mjs:108,127` updated in the same commit as the copy |

The `environment_label` divergence (`managed` for composer paths, `worktree` for
the same preset started by GitHub import, CLI split, research fan-out, or
respawn) is classified **Experimental, recorded, not tested as a flip.** It is a
property of `lib/tracks.mjs:94-100` and `server/workers.ts:103`, both OUT of this
card. A test asserting one label would pin the divergence as intended behaviour;
`FEATURES.md` names it as a known limitation instead, which is the honest place
for it.

## Test Scopes

| Scope | Type | Required Evidence | TDD? |
|---|---|---|---|
| `env-seed-mapper` | `test-unit` | `new-worktree` → the exact `{type:'host', workspace:{type:'managed-worktree', baseBranch:{kind:'default'}}}`; `project-default` → `undefined`; unrecognised and `null` → `undefined` (no throw); two calls return the **same reference** per kind; a module-level constant asserted `Object.isFrozen`. Import the SDK shape by indexed access, not by an unexported name | Yes — the mapper is pure and total, the one place TDD pays |
| `env-seed-mapper` | `test-regression` | `selectCardEnvironment` and `environmentFallbackNotice` unchanged: the existing `tests/card-environment.test.mjs` assertions stay byte-identical, and a seed that *is* honoured still returns `null` notice | No — characterise the existing file |
| `env-kind-control` | `test-unit` | What the control writes into `form.environmentKind`; the built-in disabled condition and the help text naming the cascade; the unrecognised stored value renders unchecked and its seed is treated as off; the off state sends the field **explicitly** so the RPC `.default()` cannot silently downgrade a worktree preset | No — a `.tsx` seam, test-after on the extracted rule |
| `env-kind-control` | `test-unit` (negative) | An out-of-enum kind in `savePreset` sets one reader-facing message naming both states and `upsertPreset` is **never called** — asserted on the recording rpc double, not on the error text's wording | No |
| `form-extractions` | `test-regression` | `tests/preset-ui.test.mjs` composition pins re-earned against the extracted `PresetManagerFormBody` / `PresetManagerPresetRow`; `scripts/source-debt.json` gains both waivers in `debt-baseline.test.mjs`'s print order and **lowers** both ceilings in the same commit | No |
| `preset-list-indicator` | `test-unit` | The `Pill` renders when `environmentKind === 'new-worktree'` and renders nothing otherwise; it is a **sibling** of the truncating meta span, not a descendant — the assertion is on structure, because a `Pill` inside `truncate` compiles, passes typecheck, and is never seen | No |
| `composer-seed-wiring` | `test-unit` | Per kind, what `defaultEnvironment` each of the three dialogs passes: seeded for worktree, prop **absent** for `project-default` (asserted as `undefined`/not-in-props, not as an equal object); the seed is captured once per mount, so a second read with a changed preset still returns the first reference — this is what makes AC 3 testable without mounting the host composer | No |
| `composer-seed-wiring` | `test-integration` | All three dialogs widen the `preset` prop to carry `environmentKind` and forward `defaultEnvironment` to `experimental_NewThreadComposer` — three counts, one per dialog, so one dialog silently dropped fails | No |
| `features-doc-truth` | `test-contract` | `FEATURES.md:1012-1013` and `:1206-1207` no longer assert "Stelow never re-picks it" / "stays a preset field"; the five echoed copy sites updated; the two exact-string pins at `tests/server-github-issue-flow.test.mjs:108,127` moved in the same commit. `doesNotMatch` regression pins for the withdrawn claims | No |
| whole card | `test-regression` | `npm test` green across all 332 files; `suite-wiring` green (a new file is wired or the build is red); `quality:shape` green with both ceilings lowered, not raised | No |
| whole card | `test-security` | Out of the card's own risk class, but the CI baseline applies unchanged: `npm audit --omit=dev --audit-level=high`. No new dependency is introduced, so the production audit surface is unchanged by construction — asserted by the audit itself, not by a new test | No |

## Method: hand-mutation, not a mutation tool

Full mutation tooling (Stryker, PIT, go-mutate) is **not adopted**, and the
reason is specific rather than principled: the oracles here are hand-written
`assert.deepEqual` on exact args and reference identity, so a mutant-survivor
loop would mostly re-report a test suite already known to be small. The decision
flow stops at step one — invert or remove the guarded behaviour, and require the
test to fail:

| # | Hand mutation | Test that must go red |
|---|---|---|
| 1 | Make the mapper return a fresh object literal per call instead of the frozen constant | Reference-stability assertion in `env-seed-mapper` |
| 2 | Seed `{type:'project-default'}` for the off state instead of omitting | The omitted-props assertion in `composer-seed-wiring` |
| 3 | Drop the `seeded-once` ref so the dialog re-seeds on every render | The second-read assertion (AC 3) |
| 4 | Make the built-in disabled condition read `!preset.id` | The built-in disabled case |
| 5 | Move the list `Pill` inside the `truncate` span | The structural sibling assertion |
| 6 | Delete the client-side kind validation in `savePreset` | The never-called-RPC negative case |
| 7 | Rename the stored enum value in the mapper's output | The exact-shape assertion in `env-seed-mapper` |

Every one of the seven is red-proofed before the corresponding implementation
lands; a test never observed failing is rejected, not filed. Because the
implementation and its tests are same-turn work, the suite is **authored by a
fresh subagent given the acceptance criteria alone** — the circular-validation
rule in `AGENTS.md` and the TDFlow finding (human-written 94.3% vs
self-generated 68%) both point the same way.

## CI/CD Gates

```yaml
GATES:
  full_suite:
    condition: "npm test exits non-zero"
    action: BLOCK
    rationale: "332 brownfield files; a preset-field change touches shared editor and dialog code"

  test_wiring:
    condition: "any tests/*.test.mjs absent from package.json scripts"
    action: BLOCK
    rationale: "enforced by tests/suite-wiring.test.mjs — a test outside the suite is a hope, not a guard"

  red_proof:
    condition: "any of the 7 hand mutations leaves the suite green"
    action: BLOCK
    rationale: "SWE-Mutation / ACL 2026: LLM suites are routinely never observed failing"

  source_shape:
    condition: "PresetManagerFormView or PresetManagerList above its ledger ceiling, or a new >50-line function or >400-line file unrecorded"
    action: BLOCK
    rationale: "both functions sit exactly at 73/74; the feature's own edit would trip tests/debt-baseline.test.mjs"

  typecheck_and_architecture:
    condition: "tsc --noEmit non-zero, or depcruise reports a cycle / lib-reaching-into-host"
    action: BLOCK
    rationale: "the mapper must live in lib/ and stay host-neutral, or it is untestable without React"

  contract_truth:
    condition: "FEATURES.md or a pinned copy string still describes the pre-control product"
    action: BLOCK
    rationale: "a documented example of output the code no longer produces is a second source of truth"

  security_findings:
    condition: "npm audit --omit=dev --audit-level=high reports > 0"
    action: BLOCK
    rationale: "unchanged surface this card, but the existing production gate still applies"

  flaky_rate:
    condition: "> 5% across repeated runs of the touched test files"
    action: WARN
    rationale: "no wall-clock, no shared mutable state, no order dependence is permitted in these tests"
```

**No coverage threshold and no a11y suite are invented here.** This repository
has no coverage tool and no a11y runner, and adding either is a stack decision
this card does not own. What replaces a11y tooling for this card is three
concrete, already-enforced pins: `min-h-11` and `cursor-pointer` counted on the
new control (precedent `tests/decision-routers-ui.test.mjs:89-92`), the
`focus-within` treatment inherited by construction from the reused
`isolated-worktree-check.tsx`, and `tests/card-design-tokens.test.mjs` failing on
a new type size. Any of those pins copied as a bare string match would pass on
broken logic; each is written as a count or a structure so a refactor that
inverts it fails.

## Anti-Patterns

- ❌ Grepping the form for the literal `new-worktree` — it pins the one string
  this spec says is wrong, passes on broken logic, and breaks on the vocabulary
  fix
- ❌ Presence tests (source-text existence with no behavioural consequence)
  outside the `server.ts`/`app.tsx` pins the house rules already allow
- ❌ A test that only asserts the mapper returns *something* for a worktree kind;
  the exact shape is the contract
- ❌ Asserting `defaultEnvironment` deep-equals the frozen constant while missing
  the *omitted* case — the omission is the load-bearing half of the off state
- ❌ Snapshot tests for the `.tsx` element tree; this repo has none and they
  would pass on a wrong control
- ❌ More than 3 mocks per test, or mocks for plain objects
- ❌ A 100%-coverage target; adequacy is not the goal
- ❌ The same agent authoring both the implementation and its tests
- ❌ Raising a `source-debt.json` ceiling instead of earning it
- ❌ Suite growth without pruning: each added test names the regression it catches
- ❌ A test file added without its `package.json` entry

## Assumptions recorded

`product_type: software` and `appetite: Complete` were read from the card
context and the approved spec, not defaulted. Scope risk levels are assigned
from `scope-map.json` (approved, seven slices) and the acceptance criteria in
`plans/spec-product.md`; no scope was invented, and the two known divergences
(`environment_label` per path, silent exploratory-workspace substitution) are
classified as recorded limitations rather than tested behaviour, because the code
that produces them is out of this card.

## Hand-off (workflow mode)

```
stage          : planning
description    : Tech planning. Typed scopes + sequencing.
status         : done
artifacts      : runs/exec_nyrqy19d/plans/testing-strategy.md
next-candidate : plan-gate
gate           : none
rework-on      : scope
```

Written to the run directory, not the card `plans/`, matching
`stack-research.md` in this same run — the coordinator's alignment step reads both
and promotes what it keeps. No state file, gate, or completion record was
modified by this run.
