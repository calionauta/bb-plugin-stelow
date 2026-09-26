# Integration: app slices into master

The refactor branch reduced `server.ts` to a seven-line entry over bounded
runtime slices. Master, meanwhile, shipped five user-facing feature sets. This
records how the two were joined, because the interesting part is not the file
list: it is **which module ended up owning each behavior**, and the two places
where the refactor had silently dropped a behavior master still depended on.

Base: `1f968be` (merge base) · integrated: `78723c6` (merge of `3f409d7` +
`4218752`, master 0.51.3).

## The nine conflicts, and what each one actually was

| File | Nature | Resolution |
| --- | --- | --- |
| `lib/build-gates.mjs` | import-adjacent | master's `scopeSufficiencyRefusal` + `intent`/`hasScopeMap` kept; the refactor's removal of the dead `SYNC_REDIRECT` and of the unused `stage` parameter kept. The header's documented gate order was updated to name the new gate, because that comment is the contract the tests pin. |
| `package.json` | union of two `test` chains | Resolved as a strict union: every test file both sides ran still runs (240 + 217 → 281 reachable, 0 lost). `version` took master's 0.51.3. New group `test:scope-batch` inserted in master's position. |
| `server.ts` | whole file | Took the refactor's seven-line entry and ported master's behavior into the slices (below). |
| `server/execution-advance.ts` | whole file | Took the refactor's composition root; master's three hunks moved into `execution-advance-preflight.ts` and `execution-advance-types.ts`. |
| `server/execution-lifecycle.ts` | whole file | Took the refactor's composition root; master's `boundaryVersions` dep, `resumeArtifactRoot`, and the answered-boundary check moved into the resume slice. |
| `server/execution-reconcile.ts` | whole file | Took the refactor's composition root; master's boundary validation, human stop, interface route note, and field-level artifact failures moved into the boundary and artifact slices. |
| `server/scopes.ts` | import only | Both sides added an import to the same spot; master's `scope-batch` gates had already auto-merged into the body. |
| `tests/card-lifecycle-contract.test.mjs` | whole file | Took the refactor's nine-line aggregator. Master's answer-door pins did not die with it: they were re-homed in `tests/answer-door-contract.test.mjs`, aimed at the module that owns the doors. |
| `tests/refresh-discipline.test.mjs` | helper | The refactor's function-marker slicer kept, now calling master's shared `sourceBetween` helper instead of its private copy. |

## Where each master behavior now lives

- **Answer ports.** `server/runtime/question-answers.ts` owns both doors. The
  native-boundary port is a `BoundaryPortReader` passed at call time, bound by
  the execution layer through the same `deferred` seam pattern the GitHub
  automation already used. A door with no bound port behaves exactly as it did
  before native runs existed.
- **`bb stelow answer`.** `server/runtime/cli/cli-answer.ts`. It parses argv in
  `lib/question-answer-recording.mjs` and calls the two door implementations the
  RPC contract calls — the verb owns no recording rule.
- **Scope-map approval and freshness.** `server/scope-map-reader.ts`: one reader
  for the advance gate (`scopeMapApproved`), the detail projection
  (`scopeXray`), and the raw map, so "approved" cannot mean two things.
- **BB Workflows dependency.** `server/runtime/workflow-dependency.ts` with three
  contracted RPCs in `platform-rpc-contract.ts`. The status decision is pure and
  the subprocess is injected; the runner deliberately does **not** isolate `HOME`
  (an isolated run would report "not installed" forever).
- **Human stop / interface contrast / boundary contract.** The reconcile slices
  that own each rule (`execution-reconcile-artifacts.ts`,
  `execution-reconcile-boundary.ts`), plus the shared boundary helpers in
  `server/execution-boundary.ts`.
- **scriptOutcome.** Unchanged in `server/bb-workflow-bridge.ts`; the durable
  boundary contract it returns now comes from one field list in the generated
  script.

## Two behaviors the refactor had dropped

These are the ones a mechanical conflict resolution would have lost, because
they were not conflicts — they were already missing on the refactor side.

1. **Archive and delete no longer stopped the card's owned native runs.** The
   refactor's `card-lifecycle.ts` had lost `stopOwned(...)`, so archiving a card
   reported success while a native workflow kept running against a card the
   board called archived, and deleting it erased the rows of a run still in
   flight. Both calls are back, and both refusals are pinned.
2. **The native-boundary answer path was unwired.** `routeAnswerContinuation`
   and `resumeAfterAnswers` existed and were tested, but nothing called them
   from the answer door, so a boundary answer was answered as an ordinary worker
   continuation. Now wired, and three behavior tests cover the routing, the
   refusal, and the unbound-port case.

## Shape work the merge required

- `server/scopes.ts` (403) → `createScopeProgressSync` moved to
  `server/scope-progress-sync.ts`: the watch answers "did the scopes move", a
  different question from "what are this card's scopes".
- `server/scope-batch.ts` (403) → the two CLI gates moved to
  `server/scope-batch-gates.ts`: the gates decide whether one command may
  proceed; the coordinator mutates batch state.
- `ExecutionRunsSection` lost its recorded ceiling through a real split
  (`RunActions`, `ExecutionRunRow`).
- `lib/interface-contrast.mjs`'s route table and `lib/execution-run-ledger.mjs`'s
  two UPDATEs are now derived from one declaration each, which removed the
  column/argument duplication as well as the long lines.
- Master's nine new oversized functions are recorded in
  `scripts/source-debt.json` with their exact sizes. They are master's new code,
  not inherited legacy; splitting all of them belongs to a phase, not to a merge.
- The shape gate now exempts `.bb/workflows/*.js` by path, in one visible line:
  those files are prompt artifacts, and the only way to shorten a prompt line is
  to cut the prompt in half.
- Master's `server.ts`-rooted regex pins were re-pointed at the owning module
  with the assertions kept. `recipe-pilot-matrix.json` records the renderer by
  SHA, so the rendered-source and evidence hashes were refreshed after the
  bridge was restructured — the matrix is evidence, and it now matches the bytes.

## Known state after this merge

`origin/master` moved past the merge base while the integration ran: 0.51.4
(`fix: an option's control names the document it opens`) and 0.51.5
(`fix: the question surface stops hiding the decision`) landed after 0.51.3.
Both touch `components/conversation/question-batch.tsx` and `lib/question-form.mjs`
and add two test files, so a follow-up merge of master into this branch is
required before it can land. `tests/suite-wiring.test.mjs` fails on any test
file that is not named in an npm script, so that merge must also wire
`question-decision-surface` and `question-form-artifact-provenance`.

The reload reports the host's installed plugin version, not this worktree's; the
bundle was verified with `grep dist/` instead.
