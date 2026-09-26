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

# Second integration: master 0.51.6 and 0.51.7

Base: `8561376` (release 0.51.5) · integrated: master `485640b` (0.51.7), four
commits ahead. Both are the same area of the product — what a reader gets when
they open a pending question's document — which is why the conflict list is
short and the shape work is not.

## The three conflicts

| File | Nature | Resolution |
| --- | --- | --- |
| `server.ts` | whole file | Took the refactor's seven-line entry again. Master's `artifactInherited` schema field and the two per-option provenance branches moved into the slices that own them (below). Nothing was lost: master's only other `server.ts` hunk in this range is the one that computes them. |
| `components/detail/build-detail-body.tsx` | master's re-declared type block | Took the refactor's version, which imports `ViewerFile` from `build-detail-view.ts` instead of declaring it. Master's `optionLabel` field went into `build-detail-view.ts`, where the type now lives; the `optionLabel={view.viewerFile?.optionLabel}` prop on the dialog applied cleanly. |
| `package.json` | union of one test chain | Strict union again: the branch's `answer-door-contract` plus master's `option-anchor` and `option-section-wiring` all run. `version` took master's 0.51.7. |

Four files auto-merged and were reviewed rather than trusted:
`FEATURES.md` (both entries intact), `lib/question-form.mjs` (master only
rewords a comment on the rule that was already there), and
`tests/gate-ask-evidence.test.mjs` — whose `serverSource` already reads
`server/runtime/ask-artifacts.ts`, so master's new provenance pins resolve
against the ported code instead of a 4000-line `server.ts`. The remaining
twelve files are master-only and needed no resolution.

## Where each master behavior now lives

- **A document an option never attached is marked** (0.51.6). Both paths that
  put a document on an option it did not bring: the sibling inheritance and the
  stage-manifest recovery. `server/runtime/ask-artifacts.ts` (`resolveAskOptions`)
  decides and `server/contracts.ts` declares it, so the card path and the live
  question path cannot disagree — the thread path already applied the same rule
  in `lib/question-form.mjs`.
- **An option opens at its own section** (0.51.7). `lib/option-anchor.mjs` finds
  the section by words, never by substring (substring containment lands the
  anchor on the document's own H1); `components/detail/option-section.tsx` lifts
  it above the document, because the rendered headings carry no ids to scroll
  to. The label's path is the part a merge can silently break, so it is pinned
  end to end in `tests/option-section-wiring.test.mjs`: the row → `openAskArtifact`
  → viewer state → the dialog → the section.

## Shape work the merge required

Master's 0.51.7 hunk pushed `components/conversation/question-batch.tsx` to 507
lines, past its recorded ceiling of 486. Rather than raise the ceiling (a
ceiling may be lowered, never raised), the option row family was split out:

- `components/conversation/batch-options.tsx` — the option row, the option list,
  and the inline preview, plus the row's two halves (`OptionDocument`,
  `OptionPickControl`) so no function arrives over the 50-line budget.
- `components/conversation/batch-types.ts` — the question shapes, declared once
  for both modules. Without it the row and the stepper would import each other's
  types, and the architecture gate's no-cycle rule would fail the merge.
- `scripts/source-debt.json` lost two entries as a consequence:
  `question-batch.tsx` as a file (now 353) and `question-batch.tsx:BatchOptionRow`
  (now under budget). The pins that named the moved code were re-pointed at its
  new owner with their assertions kept: `option-section-wiring` (now counting the
  named type across both modules), `question-decision-surface` (the preview
  threshold and its two disclosure shapes), `question-form-artifact-provenance`
  (the shared-brief control), and `gate-ask-evidence` (the outline treatment).

## A failure this merge did not cause

`tests/interface-contrast-schema-parity.test.mjs` fails on the branch tip,
before this merge: the asset sync in `36c96ca` overwrote the hand-tightened
`data/stelow-assets/schemas/interface-contrast.json` with upstream's copy, which
at the pinned `d76c84b` still declares `items: { type: "object" }` for
`fixedConstraints`, `evidence`, and `options`. The parity test is doing its job —
the runtime validator in `lib/interface-contrast.mjs` requires the fields the
published schema no longer names.

`data/stelow` is sync-owned, so the fix belongs in `calionauta/stelow` (tighten
`schemas/interface-contrast.json` there, pin the new commit, re-sync). Hand-editing
the vendored file would be undone by the next sync, and editing the test would
delete the guard that caught this. It is not a merge question, and this branch
cannot land until upstream carries the fix.
