# Server runtime architecture

The server has two different boundaries. The package entry, `server.ts`, is a
seven-line composition root. It re-exports the canonical RPC contract and
default plugin from `server/plugin-runtime.ts`; capability code must not import
the entry.

`server/plugin-runtime.ts` is still a large transitional runtime. It composes
the extracted capability slices and registers their handlers, but it also
retains card, question, artifact, publication, and CLI orchestration code. The
architecture below records both the recovered seams and that remaining debt;
it does not claim that every capability is fully extracted.

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
entrypoint, one canonical contract, the absence of upward imports, and the
wiring of extracted runtime capabilities. `tests/runtime-composition.test.mjs`
executes lifecycle events, scheduler cleanup, worker skill isolation, RPC
registration, CLI help, and preview disposal. The full suite also checks every
RPC method has a handler and exercises representative success, refusal, and
disposal paths.

The shape gate compares changed source with `origin/master` and applies the
same boundary to the budget gate. It reports inherited debt separately only
when the current file is no larger than its base version. Moving oversized code
into a new file does not reset that debt.

The remaining technical debt is concrete: `server/plugin-runtime.ts` is still
roughly 10.3k lines, and the budget check currently rejects 26 of its
functions. It also retains substantial RPC and CLI behavior beyond composition. New
capabilities must use an explicit seam rather than growing that file. The
budget check is authoritative; the current failures are listed in the branch
review rather than waived in this document. The extracted modules listed above
are real architecture, not a claim that the transition is complete.

## Portable blueprint evidence

The upstream pattern is documented in
[`calionauta/stelow/docs/host-plugin-blueprint.md`](https://github.com/calionauta/stelow/blob/main/docs/host-plugin-blueprint.md#14-host-runtime-composition-and-lifecycle-slices),
section 14, “Host runtime composition and lifecycle slices.” It records the
portable contract mirrored here: capability-owned contracts and lifecycle,
explicit dependency injection, migrations before registration, named
schedules, idempotent disposal, and the rule that hot reload must not stop live
worker threads.
