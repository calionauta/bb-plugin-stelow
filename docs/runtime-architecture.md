# Server runtime architecture

`server.ts` is a seven-line composition root. It exports the canonical RPC
contract and delegates startup to `server/plugin-runtime.ts`.

## Current composition

`server/plugin-runtime.ts` constructs the host-facing capabilities and passes
their handlers to `bb.rpc.register`:

- `server/cards*.ts` owns card contracts, reads, creation, and detail seams.
- `server/preset*.ts` owns preset persistence and card preset access.
- `server/drafting.ts` owns draft command behavior and completion-note drafts.
- `server/inbox.ts`, `server/decision-api.ts`, `server/github-issues.ts`, and
  `server/artifacts-publication.ts` own their feature contracts, migrations,
  handlers, and schedules.
- `server/execution-native.ts` owns adapter selection and native run launch.
- `server/execution-lifecycle.ts` owns run ownership, cancellation, answers,
  and resume boundaries.
- `server/execution-reconcile.ts` owns periodic status and artifact reconciliation.
- `server/execution-advance.ts` owns stage preflight, route dispatch, and CLI
  advance behavior.
- `server/worktree-cleanup.ts` owns cleanup preview and confirmed removal.
- `server/runtime/platform.ts` owns tool status/install probes, update state,
  model discovery, and preview RPC delegation. Probe subprocesses receive an
  explicit environment that excludes daemon credentials.
- `server/runtime/research-artifacts.ts` owns research and exploration
  artifact discovery and validation.
- `server/runtime/flow-metrics.ts` owns completed-card flow aggregation and
  current attention signals.
- `server/runtime/mentions.ts` and `server/runtime/reconciler.ts` own mention
  provider registration and periodic reconciliation.

Execution migrations run during startup. Reconciliation runs once after
startup and on a named interval; the timer is cleared on disposal. Worker
threads are never stopped by plugin disposal, because hot reload is not
uninstall.

## Contract and test topology

RPC contract fragments are composed in `server/rpc-contract.ts`. Startup tests
assert that every contract method has a handler and exercise representative
success, refusal, and disposal paths. The execution and worktree modules also
have focused behavior tests. The source-shape checker compares changed source
lines with `origin/master`; it has no inherited-baseline exemption. The budget
checker applies the same branch comparison and reports inherited debt only
when the current file is no larger than the base version.

## Known integration boundary

Merge commit `0795f04` brought current `origin/master` behavior into this branch,
including the centralized execution modules and their UI-facing contract fields.
The branch is merge-tree clean against the fetched `origin/master` tip.

The remaining large runtime entrypoint is real technical debt. The full
capability split and line-budget cleanup are not complete: the source-shape gate
currently reports 322 changed lines over 160 characters, all in
`server/plugin-runtime.ts`. The budget checker also reports the 6,434-line runtime,
numerous oversized runtime or handler functions, and the expanded 2,084-line
lifecycle contract test. Copy detection does not exempt debt
when old oversized code is moved into a new extraction slice. This note is
therefore not a claim that the runtime is fully decomposed or that
`npm run quality:shape` is green.
