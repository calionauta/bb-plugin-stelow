# Server runtime architecture

The server has two different boundaries. The package entry, `server.ts`, is a
seven-line composition root. It re-exports the canonical RPC contract and
default plugin from `server/plugin-runtime.ts`; capability code must not import
the entry.

`server/plugin-runtime.ts` is the plugin's own composition root. It builds the
runtime core and the five wiring layers and registers their handlers; it holds
no card, question, artifact, publication, or CLI behavior, and no data — the
one fallback constant that once sat beside its wiring moved to the module that
owns the shape. The architecture below records the recovered seams and the debt
that remains outside them.

## Contract composition

`server/rpc-contract.ts` composes the public contract from these existing
fragments:

- `server/card-rpc-contract.ts` and `server/card-detail-rpc-contract.ts` for
  card reads, writes, board state, and detail projections.
- `server/lifecycle-rpc-contract.ts` for card lifecycle, questions, worker
  actions, and workflow actions.
- `server/execution-contract.ts` for the durable native-run lifecycle.
- `server/platform-rpc-contract.ts` for platform, tool, update, preview, and
  CLI support methods.
- `server/github-issues.ts`, `server/inbox.ts`,
  `server/artifacts-publication.ts`, `server/workspaces-recovery.ts`, and
  `server/decision-api.ts` for their feature-local contracts.

`composeRpcFragments` rejects duplicate method names. Startup registers one
handler for every composed method through `bb.rpc.register`.

## Capability map

The runtime constructs these modules and spreads or delegates their handlers:

- `server/cards.ts` exposes `createCardStore` and `createCardsServer` for
  card storage, board reads, creation, lifecycle, and detail seams.
- `server/presets.ts` composes preset accessors, assignment, CRUD handlers,
  and worker-facing preset resolution.
- `server/inbox.ts` owns the inbox contract, migrations, recording,
  resolution, reads, and per-kind presentation boundary.
- `server/workers*.ts` owns worker spawn, respawn, retry, history, migration,
  and lifecycle data. `createWorkers(...).dispose()` cancels host-owned retry
  and deferred-respawn timers; it does not stop a live BB thread.
- `server/drafting.ts` owns draft execution and completion-note drafts.
- `server/decision-api*.ts` owns the decision router contract, migrations, and
  API seams.
- `server/github-issues.ts` owns GitHub tables, import claims, automation,
  matching, the scheduler entry point, and all GitHub handlers.
  `server/github-status.ts` owns the status shape the board's GitHub column
  reads, including the one value every unavailable answer falls back to.
- `server/artifacts-publication*.ts` owns publication history, commit diff,
  push terminals, and confirmed Git operations.
- `server/workspaces-recovery*.ts` owns evidence-led exploratory checkout
  recovery and recovery-audit creation.
- `server/execution-native.ts`, `server/execution-lifecycle.ts`,
  `server/execution-reconcile.ts`, and `server/execution-advance.ts` own
  native launch, durable run state, reconciliation, and stage advance
  respectively.
- `server/worktree-cleanup.ts` owns confirmed worktree removal.

The `server/runtime/` directory owns cross-capability host adapters:

- `server/runtime/composition.ts` assembles the shared card, preset, and inbox
  dependencies and owns lifecycle, scheduler, skill-visibility, RPC, CLI, and
  preview-disposal registration.
- `server/runtime/lifecycle-startup.ts` runs core and execution migrations and
  registers the named plugin-update schedule.
- `server/runtime/thread-lifecycle.ts` maps thread events to live-card
  synchronization and registers the startup catch-up pass.
- `server/runtime/reconciler.ts` owns the 45-second claim, scope-progress,
  severity, and live-card reconciliation timer.
- `server/runtime/pending-questions.ts` projects host interactions and durable
  recovery questions into pending card questions.
- `server/runtime/card-preview.ts` adapts the portable
  `lib/preview-runtime.mjs` process owner to card workspace selection.
  `server/runtime/platform.ts`, `server/runtime/plugin-update.ts`,
  `server/runtime/research-artifacts.ts`, `server/runtime/flow-metrics.ts`,
  `server/runtime/cli-registry.ts`, and `server/runtime/cli-dispatch.ts`
  isolate their respective runtime seams.
- `server/runtime/mentions.ts` registers the board and file mention
  providers.

Pure policy stays in `lib/`; the server modules are host adapters and
composition boundaries.

## Startup and registration order

`server/runtime/lifecycle-startup.ts` is the first runtime seam. It constructs
the update checker, registers `stelow-plugin-update-check`, and runs
`runPluginMigrations` followed by `runExecutionMigrations` before the runtime
registers the public contract.

The remaining runtime then follows this order:

1. Construct storage, card, preset, inbox, worker, drafting, preview, platform,
   and research capability objects.
2. Construct execution and cleanup capabilities with explicit dependencies.
3. Register thread lifecycle handlers, reconcile live cards once, and start
   the execution and general reconciliation timers.
4. Construct decision, GitHub, and publication capabilities.
5. Register the composed RPC contract, the `stelow` CLI, and mention
   providers.
6. Register agent skill visibility for Stelow worker threads.

Named background schedules are host-owned. Capability schedulers do not run
while their feature kill switch is disabled.

## Disposal and hot reload

Disposal is deliberately narrower than uninstall:

- `preview.dispose()` stops preview processes and dev servers started by this
  plugin instance.
- The execution reconciliation interval and `startReconciler` interval are
  cleared.
- Worker retry and deferred-respawn timers are cancelled through
  `workers.dispose()`.
- Disposal never calls `threads.stop`; live worker threads survive hot reload.
  Startup reconciliation resynchronizes their cards instead.

`tests/plugin-startup.test.mjs` executes every registered disposer twice and
fails if disposal tries to stop a live thread. `tests/runtime-reconciler.test.mjs`
pins timer cleanup and closed-database behavior. These complement the
capability behavior tests; they do not replace them.

## Tests and current boundary

`tests/server-composition-root.test.mjs` pins the thin root, one default plugin
entrypoint, one canonical contract, the absence of upward imports, the
assembly order, and the rule that no surface is built inside the root.
`tests/runtime-wiring.test.mjs` executes the seams the root depends on — the
thread→card link, the workflow spawn prompt, the deferred wiring cycle — and
checks that each layer imports only the layers below it.
`tests/runtime-composition.test.mjs`
executes lifecycle events, scheduler cleanup, worker skill isolation, RPC
registration, CLI help, and preview disposal. The full suite also checks every
RPC method has a handler and exercises representative success, refusal, and
disposal paths. `tests/debt-baseline.test.mjs` pins the whole-tree size census
and the exact inherited set below; it fails when a number grows, when a new
oversized file appears, and when the gate starts or stops reporting an entry.

The shape gate compares changed source with `origin/master` and applies the
same boundary to the budget gate. It reports inherited debt separately only
when the current file is no larger than its base version. Moving oversized code
into a new file does not reset that debt.

The composition root is now 46 lines and owns no surface: it builds the runtime
core and the five wiring layers, in order, and nothing else.
`tests/server-composition-root.test.mjs` fails if it grows a module-level
constant, because a fallback parked beside the wiring is how a shape drifts
into a second copy.

The budget check reports no file or function over its limit among the changed
sources. Everything it still reports is inherited, and the gate prints it with
the baseline it matched so the number can be checked. The full inherited set is
thirteen entries across eight files:

| File | Entry | Lines (baseline) |
| --- | --- | --- |
| `server/github-issues.ts` | the file | 942 (942) |
| `server/github-issues.ts` | `createGithubAutomation` | 701 (709) |
| `server/github-issues.ts` | `runGithubMigrations` | 64 (64) |
| `server/github-issues.ts` | `createGithubAutomation/runSingleAutomationRule` | 53 (53) |
| `server/github-issues.ts` | `createGithubAutomation/listGithubCandidates` | 58 (58) |
| `server/github-issues.ts` | `createGithubAutomation/postGithubCompletion` | 59 (59) |
| `server/runtime/cli/cli-bundle-writer.ts` | `writeBundle` | 68 (104) |
| `server/runtime/cli/cli-review-subject.ts` | `deliverableSubject` | 69 (66) |
| `server/runtime/cli/cli-split.ts` | `reportSplit` | 61 (59) |
| `server/runtime/workflow-seeding.ts` | `seedWorkflow` | 72 (74) |
| `components/creation/create-build-dialog.tsx` | `useCreateBuildSubmit` | 65 (65) |
| `lib/trackable-evidence.mjs` | `evidenceConditions` | 74 (74) |
| `tests/server-cards.test.mjs` | `callback#4` | 82 (84) |

Those predate the extraction. `reportSplit` shows the caveat below in practice:
it is accepted as inherited while two lines over its matched baseline.

### Debt the gate cannot see

Both gates compare against the merge base, so they only see files this branch
touched. Oversized code in an unchanged file is invisible to them.
`tests/debt-baseline.test.mjs` is the census that covers the rest: it walks
every owned file, records each one over 400 lines and each function over 50,
and pins them to a ratchet. Paying debt down lowers a number there; nothing
raises one without a deliberate edit.

Today the whole-tree census is five oversized files and fifty-six oversized
functions, of which the diff-scoped gate reports one file and five functions.
The two named areas of remaining work are:

- `server/github-issues.ts` — 942 lines, with `createGithubAutomation` at 701
  (a 40-line `createCardFromGithub`, a 39-line `saveAutomationRule`, and 41-line
  issue-linking seams inside it), plus 229 lines of
  `useGithubDialogState` and the dialog components under `components/github/`,
  none of which this branch has touched.
- the decision API — `createDecisionApi` at 319 lines with an 84-line
  `setDecisionPoint`, and `createDecisionApiSeams` at 271 with a 55-line
  `vetAutoContinue`. `server/decision-api.ts` sits exactly on the 400-line file
  limit, so any addition to it is a violation the moment it is edited.

One caveat, because the gate is a heuristic and not a lineage record: when a
function has no same-named baseline it is matched to the most similar function
in the base tree, and that match alone can waive it. `deliverableSubject` in
`server/runtime/cli/cli-review-subject.ts` is currently waived that way — its
real ancestor was named differently on `master`, and the match it scored
against is an unrelated function. So "inherited" means "not worse than something
comparable", not "provably relocated and shrunk", and a change that grows one of
these may still be accepted. New capabilities must use an explicit seam rather
than growing an existing file.

## Portable blueprint evidence

The upstream pattern is documented in
[`calionauta/stelow/docs/host-plugin-blueprint.md`](https://github.com/calionauta/stelow/blob/main/docs/host-plugin-blueprint.md#14-host-runtime-composition-and-lifecycle-slices),
section 14, “Host runtime composition and lifecycle slices.” It records the
portable contract mirrored here: capability-owned contracts and lifecycle,
explicit dependency injection, migrations before registration, named
schedules, idempotent disposal, and the rule that hot reload must not stop live
worker threads.
