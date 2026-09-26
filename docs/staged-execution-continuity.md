# Stelow staged execution continuity

Last verified: 2026-09-24

This file is the durable continuation record for the centralized Stelow stage
execution work. It records implementation state, validation state, known gaps,
and the next safe actions. It is not a release record and does not authorize a
commit or push.

## Source plans

The two planning files are temporary source documents outside the repositories:

- `/tmp/opencode/stelow-centralized-stage-execution-plan.md`
  - status: **closed as a scoped architecture and execution tranche**;
    implementation and release are not complete
- `/tmp/opencode/stelow-bb-workflows-all-stages-plan.md`
  - status: **closed as a disposition-complete scoped plan**; all 33 original
    Definition-of-Done lines have explicit completed, waived, deferred, or
    not-applicable dispositions

Plan closure is not an implementation-completion claim. Deferred capabilities
and release blockers remain open in the sections below.

## Repositories and worktrees

### Upstream source of truth

- Path: `/home/deploy/repos/stelow`
- Branch: `main`
- Last observed HEAD: `138a8ef`
- State: dirty, uncommitted
- Owns: `stages.yaml`, recipes, schemas, execution contract, transition guards

### Active plugin worktree

- Path: `/home/deploy/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_cegycg7mxt-1/bb-plugin-stelow`
- Branch: `bb/implemente-o-plano-tmp-opencode-stelow-centraliz-thr_cegycg7mxt`
- State: dirty, uncommitted
- Owns: BB adapter, RPC, card control plane, run ledger, UI, vendored catalogs

## Completed implementation

### Canonical upstream contract

- `stages.yaml` is the hand-edited source for 17 stage identities, order,
  routes, tools, gates, artifacts, transitions, and execution profiles.
- `SKILL.md` frontmatter carries execution metadata; the validator requires it
  for all 28 skills.
- Recipes, task DAGs, conditions, failure policies, human boundaries, output
  schemas, capabilities, partitions, write policies, and fallbacks exist.
- `recipes.schema.json` and `stages.schema.json` are validated with Draft 2020-12.
- `transitions.md`, `stage-catalog.json`, and `recipe-catalog.json` are generated
  and checked for drift.
- Intent routes and review-mode skips were corrected so they do not invent edges
  outside the canonical graph.
- Stage artifact requirements are machine-readable and enforced by `stelow advance`.
- The execution skill handoff was corrected to `execution -> verification`.

### BB plugin control plane

- Generated catalog loaders replace manual stage lists in runtime consumers.
- Native execution uses the official server-side BB Workflows CLI bridge.
- Run ledger persists project, thread, recipe, source hash, source text, args,
  workspace identity, native run ID, normalized status, resume lineage, preview,
  errors, and dedupe state.
- Stage preflight happens before stage/state mutation.
- Duplicate normal starts are refused; reconciliation can recover missing stage
  entries without starting duplicate runs.
- `needs_input` is durable and marker-bound to the card question.
- Resume creates a child run and preserves the parent boundary.
- Native runs use unique staging directories and require validated artifact
  registration before success.
- Workspace-writing `scope-batch` is refused natively until file claims,
  isolation, parent merge, and parent verification are proven.
- Status, stop, resume, and card execution UI are wired through the production
  `ExecutionAdapter` seam; the raw bridge is injected behind
  `createBbWorkflowAdapter`. The source-occurrence contract test proves these
  call sites exist, not that a live BB run completed the lifecycle.
- Native refusal is resolved before stage mutation as an explicit
  `coordinator-sequential` route; it records one durable card trail and does
  not fabricate a native run, status handle, resume handle, or cancel operation.
- `resolveExecutionRoute()` is the pure route classifier for native,
  coordinator-sequential, and hard-refused outcomes.
- The `startExecutionRun` RPC remains an explicit native-only escape hatch;
  it does not masquerade as a coordinator fallback and is not used by normal
  stage entry.

### Scope UI

- Scope progress uses the shared workflow-like segmented primitive.
- Cards with more than 12 scopes use an honest aggregate ratio rather than a
  truncated segment rail.
- Scope elapsed time and total wall-clock elapsed time are displayed.
- The card prioritizes the explicitly executing scope name.
- The open card keeps the full `ScopesList` with each scope's own tasks,
  dependencies, status, evidence, conditions, and elapsed time.

## Capability disposition

A capability is **resolved** only for the boundary named in the evidence
column. Host compilation, contract tests, and deterministic unit tests are not
agent-execution evidence. A **waived** capability remains unavailable and must
keep its refusal or fallback route. `B-PILOTS-1` remains a release blocker even
when a narrower contract is resolved.

| Capability or boundary | Disposition | Evidence and exact limit | Named waiver | Release blocker |
|---|---|---|---|---|
| Static capability inventory and negotiation | **Resolved at the pure/unit boundary** | `lib/bb-workflow-capabilities.mjs` is a local, hard-coded declaration. `tests/execution-adapter.test.mjs` and `tests/execution-route.test.mjs` prove known boolean-true requirements, unknown/non-boolean refusal, malformed-container refusal, and coordinator routing. These tests do not dynamically interrogate a live BB worker. | None for this bounded result | `B-PILOTS-1` before a true declaration is treated as live-host evidence |
| Artifact-only `fanout` at the BB engine boundary | **Resolved by live evidence** | Run `wfr_71c80819-04e9-4903-b230-e140747076d8` validated and ran two concurrent artifact-only workers. Both calls succeeded, their execution windows overlapped, and each wrote a separate non-empty receipt under the probe's thread-storage artifact root. The probe's workspace status hash stayed `a6811603f04eaa47ddeef56ce60e902990bd93b8c4ed838fc43bd254e90e7cf0`; it did not run a workspace-writing recipe. | None for this bounded engine capability | None for the direct engine capability; `B-PILOTS-1` remains for the Stelow production renderer and lifecycle pilots |
| Generated Stelow renderer dispatch | **Resolved at dispatch boundary; artifact receipt remains open** | Run `wfr_961d3615-f28e-4a92-ad04-f94d4f086cb8` used the sanitized renderer source and recorded three successful calls with three structured outputs. The run did not use the card control plane or leave registered artifacts. | None for dispatch | `B-PILOTS-1` for artifact persistence/registration, partial failure, and lifecycle evidence |
| Local execution ledger and normalized state machine | **Resolved at the unit boundary** | `lib/execution-run-ledger.mjs` persists local/native identities and validates transitions; `tests/execution-run-ledger.test.mjs` covers ownership, invalid terminal transition, completion dedupe, and terminal cancellation. This is not a live native run. | None for this bounded result | `B-PILOTS-1` for live reconciliation evidence |
| `status`, `cancel`, and `resume` | **Adapter contract resolved; live BB behavior is waived** | `server/bb-workflow-bridge.ts` implements CLI operations, and `tests/execution-adapter.test.mjs` proves wrapper normalization, refusal-before-run, and source-occurrence wiring only. The ledger test proves local cancellation. No generated recipe was resumed, stopped, or reconciled live. The `result()` contract method has no production `adapter.result()` call and is not claimed as a live path. | `W-NATIVE-LIFECYCLE-EVIDENCE-1` | `B-PILOTS-1` for live stop/resume/status/reconciliation evidence |
| `human-input` | **Emulation contract resolved; live/native behavior is waived** | The adapter normalizes `needs_input`; production code persists a marker-bound card question and creates a native child run on answer; `tests/execution-deep-link.test.mjs` pins question focus and run-row fallback. No generated recipe exercised the live question/resume cycle, and BB does not own the question here. | `W-NATIVE-HUMAN-INPUT-1` | None while recipes inherit the emulated boundary; `B-PILOTS-1` for a live human-wait recipe |
| `hidden-workers` | **Resolved by live engine evidence** | The two workers in `wfr_71c80819-04e9-4903-b230-e140747076d8` created official Workflows threads `thr_nr4mgc8znh` and `thr_zci3dtbpss`. Both report `originPluginId: "workflows"`, `visibility: "hidden"`, a lifecycle owner, and archived state after completion. This proves the direct Workflows-worker boundary, not a generated Stelow recipe. | None for this bounded result | None for the direct worker boundary; `B-PILOTS-1` remains for production-renderer evidence |
| `per-call-model` | **Resolved negative capability** | `lib/bb-workflow-capabilities.mjs` reports `false`; no current generated recipe requires it, and the renderer has no task-level model override path. | None | None while no recipe requires it; a future requirement must remain blocked until support is implemented and behavior-tested |
| `per-call-permission` | **Resolved negative capability** | `lib/bb-workflow-capabilities.mjs` reports `false`; every generated recipe uses `inherit`; `tests/execution-adapter.test.mjs` and `tests/execution-route.test.mjs` reject or reroute unsupported requirements rather than downgrading silently. | None | None while no recipe requires per-call permission |
| `isolated-workspace` and `file-claims` | **Resolved negative capabilities; native workspace use remains waived** | The report is `false` for both. `tests/execution-route.test.mjs` proves missing claims/isolation route sequentially, and its all-true negative probe still refuses workspace writing and `scope-batch`. No claim ledger, per-scope isolation, or parent merge is implemented for native workers. | `W-SCOPE-NATIVE-1` | `B-SCOPE-1` |
| Native `scope-batch` fan-out | **Waived; not complete** | Native fan-out stays disabled in both `lib/execution-route.mjs` and `server/bb-workflow-adapter.ts`. Real file claims, release/cleanup, transitive partition proof, isolated workspaces, parent merge, parent verification, and mutation-killing behavior tests are still absent. Host validation and artifact contracts do not count as a native pilot. | `W-SCOPE-NATIVE-1` | `B-SCOPE-1` |
| Synthetic sequential `ExecutionAdapter` | **Waived architecture non-goal** | The existing card coordinator is the real sequential owner. It receives no fabricated run, status, resume, cancel, or result identity; `tests/execution-dispatch-contract.test.mjs` pins route-before-mutation ordering. | `W-SEQUENTIAL-SYNTHETIC-1` | None; adding a second lifecycle owner would reopen the architecture decision |
| Native Workflows deep link | **Waived; card-local route resolved** | `lib/execution-deep-link.mjs` accepts only local `exec_...` identities, and `tests/execution-deep-link.test.mjs` covers all six states plus unsupported/native-id refusal. Native IDs and preview directives remain evidence only. | `W-NATIVE-DEEPLINK-1` | None; native navigation is not required for card-local continuity |

The non-capability release blockers remain independent of the table above:

- `B-PILOTS-1`: direct BB artifact fan-out and hidden workers are proven, and
  the production renderer now completes a generated `execution-audit` graph.
  Sanitized run `wfr_961d3615-f28e-4a92-ad04-f94d4f086cb8` recorded three
  successful calls and three structured outputs. Corrected run
  `wfr_0089d253-fecc-4b2a-8162-84f512ace334` also completed with three
  successful calls, clean prompts, and three non-empty artifacts. Both used
  pilot/thread-storage roots rather than the production card receipt path, so
  release still needs artifact persistence/registration, a real
  partial-failure run, live status/stop/resume/reconciliation evidence, and a
  needs-input/resume run if a human-wait recipe is claimed. The earlier zero-call
  runs remain negative evidence of the `$schema` compatibility defect; the
  matrix now pins current renderer bytes instead of only source-hash shape.
- `B-PIN-1`: `data/stelow-source.json` pins `73b13581...`, but that immutable
  commit does not contain the vendored recipes, schemas, execution contract, or
  generated catalogs. A truthful authorized upstream commit and exact resync are
  required before release evidence is valid.
- `B-REVIEW-1`: both upstream and plugin worktrees are dirty. No commit, push,
  PR, tag, or release is authorized by this record.

## Validation completed

### Plugin

Green:

- `npm run typecheck`
- `npm test` (144 wired test files, including the adapter, route, ledger,
  artifact, migration, deep-link, fresh-install, and sync contracts)
- `node tests/persisted-card-migration.test.mjs`
  - cold install, all legacy review-mode upgrades, reopen, bounded retry,
    archive, delete refusal/owned-state cleanup, and unknown old stage;
- `node tests/execution-deep-link.test.mjs`
  - six normalized states, local ledger identity, question fallback, stable
    subpaths, and refusal for native/unsupported identities;
- `node tests/fresh-install.test.mjs`
  - marketplace entries, first-boot reads, package coverage, and fresh-safe
    migrations;
- `node tests/workflow-skills-sync.test.mjs`
  - 133 files synced from the pinned upstream commit and idempotent on the
    second run;
- `npm pack --dry-run --json`
  - 628 entries; all 12 recipe files, 5 output schemas, the recipe schema,
    and both generated catalogs are present in the package;
- `npm run build:reload`
- `git diff --check`
- bundle inspection for the scope progress implementation
- 2026-09-24 native fan-out probe and focused review
  - `wfr_71c80819-04e9-4903-b230-e140747076d8`: two successful concurrent
    artifact-only calls, two non-empty thread-storage artifacts, and no
    workspace-status change;
  - `wfr_f8b32f88-5408-4f2d-a441-03a0df5b162c` and
    `wfr_d82b2778-3a66-4d2d-8489-17f1712a0f6b`: earlier false-positive
    production-renderer evidence, retained as the regression that motivated
    schema sanitization;
  - `wfr_961d3615-f28e-4a92-ad04-f94d4f086cb8`: sanitized renderer run with
    three successful calls and three structured outputs;
  - `wfr_0089d253-fecc-4b2a-8162-84f512ace334`: corrected renderer run with
    three successful calls, clean prompts, and three non-empty artifacts;
    production receipt registration and lifecycle evidence remain pending;
  - `node tests/execution-adapter.test.mjs`,
    `node tests/execution-route.test.mjs`,
    `node tests/recipe-pilot-matrix.test.mjs`, and `npm run typecheck`

### Upstream

Green:

- `npm run typecheck`
- `npm run verify:execution`
- focused stage-model, lifecycle, transition, and artifact tests
- 50 artifact/transition fixture tests in 5 files
- 41 additional focused tests in the latest capability/transition pass
- production adapter source-occurrence contract test (not live lifecycle proof)
- execution route behavior tests
- CLI/native/coordinator dispatch-order contract test
- `generate-stage-catalog.py --check` after the packaging-link repair
- the four previously failing packaging suites: 4 files and 233 tests passed
- full upstream `npm test`: 29 files and 647 tests passed
- `git diff --check`

## Known pending gaps

### Resolved — fallback semantics

The production lifecycle now uses `ExecutionAdapter` for native run, status,
resume, and cancel. The raw BB bridge is injected behind that seam, and
`tests/execution-adapter.test.mjs` pins the call-site occurrences and wrapper
contract. That test is not a live native lifecycle pilot.

Fallback is intentionally **not** a synthetic sequential `ExecutionAdapter`.
The existing card coordinator owns the stage, artifacts, questions, and
advancement. `resolveExecutionRoute()` now decides before stage mutation:

- native route: use the BB Workflows adapter;
- coordinator-sequential route: record one durable trail and let the existing
  coordinator continue;
- refused route: stop before mutating `state.md` or the card stage.

`tests/execution-dispatch-contract.test.mjs` is a source-order topology pin:
it proves that route resolution appears before the helper mutation and that
the coordinator/native markers follow it in the CLI block. It does not execute
either branch or independently prove that the durable coordinator trail is
written before mutation.

The coordinator route does not claim native durability, resume, or cancel
semantics. A real selectable sequential adapter remains a future capability
until it implements the complete durable lifecycle contract.

### P1 — scope-batch native execution (`B-SCOPE-1`)

Native fan-out remains intentionally disabled. The current host has no proven
`file-claims` or per-scope isolated-workspace implementation. The route remains
`coordinator-sequential`, and this is contextual waiver
`W-SCOPE-NATIVE-1`, not a safety waiver. A complete native scope-batch path
still needs:

- real claim acquisition and release;
- transitive partition proof;
- isolated workspaces or explicit sequential proof;
- parent merge;
- parent test/verification;
- cleanup and retry semantics;
- behavior tests that fail if any guard is removed.

### P1 — real low-risk recipe execution pilots (`B-PILOTS-1`)

The 12-recipe matrix proves host compilation and current artifact contracts.
The direct engine probe separately proves safe artifact fan-out, structured
results, overlapping worker calls, and hidden Workflows threads. The production
renderer also now has a live generated-recipe dispatch result: sanitized
`execution-audit` run `wfr_961d3615-f28e-4a92-ad04-f94d4f086cb8` dispatched
both root tasks and the join, with three successful calls and three structured
outputs. The earlier zero-call runs were false positives caused by passing the
unsupported `$schema` metadata key; the renderer now strips that metadata and
the matrix test compares all recorded source hashes with current renderer bytes.

That run did not use the card control plane and did not leave registered
artifacts. The renderer also had a second prompt-construction defect: nested
double quotes around the artifact-path expression produced a leading `NaN` in
worker prompts. The renderer now uses a valid single-quoted expression inside
that generated prompt. The post-fix pilot
`wfr_0089d253-fecc-4b2a-8162-84f512ace334` completed with three successful
calls, clean prompts, and all three non-empty artifacts under its pilot root.
It still used host thread storage rather than the production card receipt path,
so release needs artifact registration through `.registered.json`, a real
partial-failure pilot, and live status/stop/resume/ledger reconciliation
evidence. A needs-input/resume run is required only if a human-wait recipe
remains a release claim.

### P1 — immutable execution-asset provenance (`B-PIN-1`)

`/home/deploy/repos/stelow` is behind `origin/main` by two commits, but the
origin-only version, changelog, and coding-standard content is already present
in the dirty worktree. No pull, reset, merge, commit, tag, or release was
performed.

The execution contract and assets are still uncommitted upstream. The plugin's
`data/stelow-source.json` names immutable commit
`73b13581cb5e116c1c582a4f36b83d555f429af7`, but that commit does not contain
`recipes/`, `schemas/`, `references/execution-contract.md`, or the generated
catalogs now vendored locally. Therefore the current pin is not truthful for
those assets.

After explicit owner authorization and an upstream commit, the only supported
repair is:

1. update the plugin pin to the exact authorized upstream commit;
2. run `node scripts/sync-stelow-assets.mjs` against that commit;
3. run `npm run reload` in the live checkout;
4. rerun sync, idempotence, package, and fresh-install validation.

No synthetic commit ID or local-only pin may be recorded as release evidence.

### Resolved — plan document closure

Both temporary plans now carry explicit final dispositions. The all-stages
plan classifies its 33 original Definition-of-Done lines as 29 completed, 3
deferred, and 1 not applicable. The centralized plan classifies its 31 scoped
and general items as 29 completed and 2 deferred. No unsafe item is silently
checked. Deferred implementation and release blockers are listed separately
from plan-text closure.

### Resolved — persisted-card migration evidence

`tests/persisted-card-migration.test.mjs` now supplies persisted fixtures and
behavior checks for the full compatibility matrix: cold install, every legacy
review-mode upgrade, reopen, bounded retry, archive, delete, and unknown old
stage IDs. The test preserves immutable card ownership and checkpoints,
requires archive before delete, confines cleanup to state owned by the card,
and keeps unknown stages inspectable without inventing a skill or transition
contract.

The delete case is intentionally a host-boundary contract pin rather than a
fake in-process RPC test: it checks the archived-only refusal, owner-bound
state removal, and row deletion through the composed server capability. A
live installed-database upgrade exercise remains optional hardening, not a
substitute for the committed
fixture matrix.

### Resolved — deep-link/run evidence

The ledger's local `exec_…` identity is the only in-app navigation key. The
pure `lib/execution-deep-link.mjs` contract maps queued/running to the run row,
needs_input to the live card question when present (with an honest run-row
fallback during question sync), and succeeded/failed/cancelled to run history.
Native run IDs and preview directives remain displayed evidence and are never
substituted into the route. Unknown states and non-local identities return no
route. The UI router uses the same local-run parser, and
`tests/execution-deep-link.test.mjs` covers all six states, both question
fallback paths, tracked and event-plus-run subpaths, and refusals.

### Resolved — recipe pilot/validation coverage

`docs/recipe-pilot-matrix.md` and
`tests/fixtures/recipe-pilot-matrix.json` now record every generated recipe.
On 2026-09-23, all 12 rendered sources passed the real
`bb workflows validate` host compiler. On 2026-09-24, a direct safe
artifact-only Workflows run proved the host fan-out engine and hidden workers,
but the rendered fan-out-shaped `execution-audit` and non-fanout `setup-recon`
runs both completed with zero calls and empty outputs. The deterministic matrix
test still exercises context-sensitive positive and negative artifact contracts
for every output, records route, failure, permission, and human-wait behavior,
and pins the exact catalog, renderer, route, capability, and artifact-validator
bytes; it does not reinvoke the host compiler or prove task dispatch. Generated
artifact recipes therefore remain unexecuted, and the direct engine proof is
not substituted for them.

Workspace-writing `scope-batch` has an explicit contextual waiver: native
fan-out remains deferred, no native pilot is simulated, and the required route
stays coordinator-sequential even when every capability is claimed. Artifact,
claim, and parent-verification preservation remains mandatory.

### Resolved — plugin execution-asset packaging

The plugin now carries the upstream execution contract instead of relying on
files that exist only in the source checkout. The pinned sync preserves older
copies when pre-catalog assets are absent, writes new recipe/schema assets
atomically, and vendors the generated stage/recipe catalogs plus the recipe
schema.

Packaging evidence is green: `npm pack --dry-run --json` reports 628 entries
and includes all 12 recipes, 5 output schemas, `data/stelow-recipes.schema.json`,
`data/stelow-stage-catalog.json`, and `data/stelow-recipe-catalog.json`.
`tests/fresh-install.test.mjs` separately checks the marketplace entry points,
first-boot reads, package `files` coverage, and fresh/upgrade-safe migration
order. This resolves plugin transport/packaging. The separate upstream
skill-copy/link debt is also resolved by the packaging phase recorded below.

## Plan closure boundary

Both temporary plans are closed as plan-text records, not as implementation or
release authorization: the centralized plan has 29 completed and 2 deferred
lines; the all-stages plan has 29 completed, 3 deferred, and 1 not-applicable
line. The capability table above is the current evidence disposition. Native
`scope-batch` remains fail-closed under `W-SCOPE-NATIVE-1`; no safety guard is
waived.

## Resolved — upstream skill packaging/link debt

The packaging repair removed 405 ignored physical copies, preserved the five
tracked skill-specific files, and fixed the generated execution-contract link.
`generate-stage-catalog.py --check`, the four previously failing packaging
suites (4 files, 233 tests), and full upstream `npm test` (29 files, 647 tests)
pass. The repair did not weaken a host-agnostic, link, or no-copies guard.

## Next safe sequence

1. Keep native `scope-batch` fan-out disabled until claims, isolation, parent
   merge, parent verification, cleanup/retry, and mutation-killing guard tests
   all pass.
2. Do not claim a release pin until an authorized upstream commit contains the
   canonical execution assets and the plugin is synced from that exact commit.
3. Fix the rendered-recipe zero-call success path, then record generated
   artifact success and partial-failure pilots if release is intended. The
   direct artifact fan-out and hidden-worker evidence already exists, but it
   does not close production-renderer evidence. Include live
   status/stop/resume/reconciliation; exercise needs-input/resume only if
   human wait is claimed. Never relabel host validation or direct engine
   probes as generated-recipe execution.
4. Run the final validation matrix below and review both dirty worktrees.
5. Commit, push, open a PR, tag, or release only after explicit user approval.

## Final validation matrix

The final validation phase is read-only except for the required plugin bundle
build/reload. `npm pack --dry-run` does not publish a package.

```bash
# Upstream: /home/deploy/repos/stelow
npm test
npm run typecheck
npm run verify:execution
npx vitest run tests/artifacts/artifact-schema.test.ts \
  tests/unit/artifact-flow-contract.test.ts \
  tests/unit/spec-frontmatter-contract.test.ts \
  tests/integration/skill-links.test.ts
git diff --check

# Plugin: active BB plugin worktree
node tests/recipe-pilot-matrix.test.mjs
node tests/execution-artifacts.test.mjs
npm test
npm run typecheck
npm run build:reload
npm pack --dry-run --json
git diff --check
```

Plan closure is authorized only when these commands are green and the final
report confirms that every Definition-of-Done line remains explicitly
dispositioned. Release remains blocked by `B-PIN-1`, `B-SCOPE-1`,
`B-PILOTS-1`, and `B-REVIEW-1`. Preserve unrelated dirty work and never weaken
a guard to make a test pass.
