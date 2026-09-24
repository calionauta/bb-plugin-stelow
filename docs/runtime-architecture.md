# Server runtime architecture

`server.ts` exports the RPC contract and the plugin entrypoint. The active
implementation is `server/plugin-runtime.ts`. It runs migrations, constructs
capability modules, registers RPC and CLI handlers, schedules background work,
and installs disposal callbacks. The root is still large: it is 6,321 lines
at the time of this note, and its CLI `run` method is about 2,000 lines.
Treat it as an extraction target rather than a finished composition root.

The existing capability seams include `server/runtime/platform.ts` for host
tool installation and update status, `server/runtime/research-artifacts.ts`
for research artifacts, `server/runtime/mentions.ts` for composer mentions,
`server/runtime/reconciler.ts` for periodic card reconciliation, and
`server/runtime/flow-metrics.ts` for board metrics. Most card lifecycle,
RPC dispatch, and CLI command bodies remain in `server/plugin-runtime.ts`.

`tests/plugin-startup.test.mjs` invokes the plugin with a fake BB host and
checks migrations, selected RPC and CLI dispatch, scheduled callbacks, and
disposal registration. Capability modules have focused tests. The startup
harness does not cover every registered RPC or CLI branch. Source budgets
report inherited oversize files and functions, and fail if that debt grows.

The `integration/app-slices-master-20260924` worktree holds a pending merge
with `origin/master`. Its `server.ts` conflict represents newer master
behavior that has not yet been mapped into these modules. That worktree is
not a validated integration result; do not publish it as one.
