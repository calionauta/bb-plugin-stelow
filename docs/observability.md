# Observability — the action log

Maintainer guide for the plugin's own flight recorder. Read this before adding a
new recorded event, changing a cause code, or answering "why did this card do
that?" with a hand-joined query.

## Why it exists

Measured over six weeks (15 Sep → 27 Oct) before the recorder existed:

| Signal | n | What it could not answer |
|---|---|---|
| CLI failures (`cli-errors.jsonl`) | 1,435 (908 `stelow`) | denominator: nothing recorded successes |
| `bb stelow done refused` | 88 comments | which reason, in which card, after how long |
| Spawn loop on 26 Oct | 189 threads, 150 restarts | one card, one cause, no row |
| Runs failed "without a reason" | 10 of 15 | the host's raw payload was discarded |
| Reconciler observation loop | 26 identical comments in 45 min | the tick itself was invisible |
| Expired questions | 32 | how long each waited before expiring |
| UI errors | 81 `toast` call sites | none left a server-side trace |

The facts existed in six places — `comments`, `card_stage_events`,
`execution_runs`, `verification_runs`, `publication_events`, BB's own event
log — and answering one question meant joining them by hand. BB already records
what the *agent* did and what failed *externally*; it cannot record what the
*plugin* decided.

## The shape

One append-only table, `action_log`, in the plugin's `data.db`
(`lib/action-log.mjs`). Four layers, one writer:

| layer | question | examples |
|---|---|---|
| `intent` | who asked | `rpc.call`, `cli.call`, `ui.error` |
| `decision` | what the plugin chose | `stage.entered`, `card.updated`, `worker.spawn`, `run.retry`, `question.*`, `inbox.*` |
| `effect` | what happened outside the plugin DB | `run.finished` |
| `environment` | what the world was doing | `host.read-miss` |

`surface` is `rpc`, `cli`, `tick`, `hook`, `watcher` or `system`. Both the kind
catalog and its layer/surface are declared in `lib/action-kinds.mjs`; the writer
refuses an unknown kind, outcome or actor, and a malformed cause. Adding an
event is one line there plus the assertion that emits it.

A **cause** is a dotted code (`done.audit-trail`, `run.no-reason`), never a
sentence. There is no cause allow-list: the shape is enforced, the vocabulary
is a convention, and a typo is a new series rather than a refusal. That is
deliberate — a closed cause list would need an entry per condition a gate can
name, and the catalog is edited at the seam anyway — but it means a cause is
only as trustworthy as grep. Prose lives in `detail` (≤ 2 KB JSON), on the card,
or in the comment the event points at.

## Two rules that keep it readable

1. **A repeat is one row.** Deduplication keys on `(kind, outcome, cause, card)`
   inside a 10-minute window and increments `occurrences` / `last_at`. This is
   what turns the 150-restart loop and the 26-comment reconcile loop into one
   row each. It only applies when a cause is present: two unrelated successful
   RPCs are not "the same event", so they stay two rows.
2. **The detail is evidence, not a copy of the database.** No prompts, no file
   contents, no assistant text. RPC inputs are never recorded — the card id is
   enough to join. A detail over the cap is replaced by its size.
3. **A folded row keeps the worst duration, the latest detail, and prints both
   moments.** The duration of a row with `occurrences > 1` is the slowest
   occurrence (MAX), not the one that created the row — a 5.7 s reconcile pass
   must not read 12 ms. `detail` moves to the latest occurrence, so a tick that
   starts failing a different phase tomorrow does not show today's list. The
   text form prints `first→last` so a condition that stopped an hour ago cannot
   look live; the card shows the last moment, because that is the question the
   reader has.

Logging never blocks the action it records: the lib validates and throws (a
programmer error, red in tests); `server/runtime/action-log-runtime.ts` catches,
reports once per distinct message, and returns `null`. `STELOW_ACTION_LOG=0`
disables writes without a redeploy; readers keep working.

## Where it is recorded

| # | Point | What lands |
|---|---|---|
| 1 | RPC registration (`action-log-rpc.ts`) | one row per invocation: name, card, duration, outcome — all 120+ methods at once. A handler answering `{ ok: false }` is `refused`/`rpc.refused`, not `ok`: otherwise a refused Retry is indistinguishable from a successful one |
| 2 | CLI dispatch (`cli-dispatch.ts`) | one row per verb, including `help` and unknown commands; `reason` on `CliResult` separates refusal from crash |
| 3 | `updateCard` (`card-state.ts`) | field-level before/after for status, stage, activity, `last_error` |
| 4 | stage ledger (`card-ledger.ts`) | `from`/`to` plus a derived cause |
| 5 | worker spawn (`workers.ts`) | preset + reason; deduped by cause |
| 6 | 45 s card tick (`reconciler.ts`) | heartbeat: frequency, duration, partial outcome |
| 7 | reconcile pass (`execution-reconcile.ts`) | heartbeat for the execution pass |
| 8 | auto retry (`execution-auto-retry.ts`) | refused / started / launch-failed with the closed reason |
| 9 | run transitions (`execution-reconcile-run.ts`) | terminal state; on failure, the raw host payload |
| 10 | ask lifecycle (`cli-ask.ts`, `question-answer-log.ts`) | asked / answered / persisted / expired with dwell, from BOTH doors (the CLI wait and answering on the card) |
| 11 | inbox (`inbox.ts`, `inbox-recorders.ts`) | opened and resolved, per rule and reason |
| 11b | 45 s card tick (`reconciler.ts`) | heartbeat plus the names of the phases that threw (`outcome: partial`) |
| 12 | client errors (`reportClientError`, `client-error-report.ts`) | uncaught render/window/promise failures, with a message fingerprint as the cause |
| 13 | host read misses (`read-streak-wiring.ts`) | one row when a card's state read crosses the 6-tick outage threshold |

Deliberately not recorded: prompt bodies, file contents, assistant text, and a
tick that changed nothing (the heartbeat already says the tick ran).

## Reading it

```bash
bb stelow log --since 7d                       # table, newest first
bb stelow log --card card_x --since 6w         # one card
bb stelow log --kind run.finished --cause run.no-reason --json
bb stelow log --card card_x --replay           # six histories merged by time
bb stelow storage                              # rows / events / oldest, beside worktrees
bb stelow gc --apply                           # prunes 30d / 50k rows and says how many
```

The card's **Activity** section (`cardActivity` RPC) is the same rows on
demand: closed by default, loaded by a button, because the answer is a database
read the reader has not asked for yet.

The operator loop built on these commands — the weekly sweep, the triage table,
and the LLM audit prompt with its independent-verify pass — is in
`docs/observability-triage.md`; the saved workflow is
`.bb/workflows/observability-review.js`.

Retention is 30 days / 50,000 rows, pruned by `gc --apply` — the command that
already deletes. Dry runs prune nothing.

## Known gaps (next, in cost order)

1. **Validation rejections never reach the wrapper.** BB validates against the
   contract before calling the handler, so the recorder covers handler throws,
   not schema refusals; the warn's missing field path is filed upstream
   ([get-bb/bb#6373](https://github.com/get-bb/bb/issues/6373)).
2. **A caught error shown as a toast is not a row.** `reportClientError` covers
   what escapes React and the window; the ~80 explicit `toast` call sites are
   handled errors the reader is already told about, and instrumenting them one
   by one would be a second copy of the message. If a toast ever hides a
   failure worth trending, record it at the catch site with its own cause.
3. **A mismatched published bundle is a fallback, not a row.** BB ignores a
   prebuilt dist built with another SDK and loads from source, so the plugin
   never observes it from the inside; the warn is the host's, and the fact is
   a build-pipeline detail rather than a card fact.

## Upstream proposals (Phase 4)

One ask is filed, one turned out to be already handled by the host.

1. **Name the field on an RPC validation refusal.** Filed as
   [get-bb/bb#6373](https://github.com/get-bb/bb/issues/6373). BB logs
   `rpc cardDetail failed: rpc input validation failed` with no path, so the
   operator knows a request was rejected and not which key was wrong. The host
   already computes `issues[].path` in `validateRpcValue` and drops it one frame
   later in the warn line; the ask is to keep it (and the received key names,
   never the values) in the message.
2. **The marketplace artifact lag is already a fallback, not a failure.**
   `dist/server.js built with SDK X, running SDK Y` appeared 5 times
   (20–22 Sep). Current BB (0.46.1) checks `server.meta.json`, and on a
   mismatched or stale bundle it logs and **loads from source**
   (`ignoring prebuilt dist/server.js … loading from source`), rebuilding the
   app bundle the same way. So no upstream ask: the warn is the price of a
   correct fallback, and refusing the boot would be worse. The plugin's own
   `npm run build` writes `server.meta.json`, which is what makes the check
   possible.

## Verification

`tests/action-log.test.mjs` covers the lib contract (closed vocabulary,
dedupe window, cap, retention, replay ordering), `tests/action-log-runtime.test.mjs`
covers the never-throw recorder, the kill switch and the RPC boundary wrapper,
`tests/action-log-wiring.test.mjs` covers the CLI dispatch and every
`bb stelow log` refusal, and `tests/action-log-ui-signals.test.mjs` covers the
message fingerprint, `reportClientError`, and the read-streak row. The behavioral rule to preserve: removing the recorder
must not change any decision — a missing row is a missing answer, never a
refused card.
