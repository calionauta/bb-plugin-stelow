# Contrast wiring record — the matrix becomes an artifact, the premise becomes a fact

**Type:** feature record for the contrast wiring brief of 2026-10-23 (layers 4,
2 and 3 in dependency order).
**Branch:** `bb/contrast-wiring-artifact-schema-staleness-thr_n2fqj6kwe5` (the
brief's name was `feat/contrast-wiring-2026-10-23`), based on `origin/master`
`b70f1e5a` (release 0.89.0).
**Status:** all three layers landed. The creation path is proven with SQLite and
real files; **no live card has run it**, and §6 says exactly what that leaves
unproven.
**Reuses, does not rebuild:** `lib/contrast-model.mjs` and
`tests/contrast-model.test.mjs` (#418). The only change to that module is one
additive export (`assertContrastModel`), so an artifact can be refused without
deriving questions it would discard; the derivation, the floor and the two-output
split are untouched and the original test is green.

## 1. Layer 4 — somebody produces the matrix

### 1.1 The stage: `scope`, and why not `interface`

`skills/stelow-workflow-orchestrator/stages.yaml` gives each stage an `artifacts`
list, and the stage that decides scope is `scope` (order 70): *"Owns the approved
Scope Map for feature routes. Shape may propose candidate slices; this stage
finalizes the map"*, artifacts `[scope-map.json]`, `next: [interface]`.

The matrix belongs there because its questions ARE scope decisions: a blank cell
asks "missing feature, or deliberately absent?" and a shared affordance asks
"one feature, or one per place?" — what the product includes, which is what the
Scope Map answers. `interface` was the tempting alternative (its phase is also
`planning`) and it is wrong for a concrete reason: it already owns
`interfaces/contrast.json`, an artifact with its own exact schema
(`validateInterfaceContrastReceipt`: `route`, `briefStatus`, `disposition`,
versions). Naming a place×state matrix after that artifact would put two
different documents behind one name and one schema that fits neither.

No new stage was invented. `scope`'s description says narrow mechanical refactors
may bypass it, which matches the artifact: a feature route earns a matrix, a
one-line fix does not.

### 1.2 The artifact

`lib/contrast-artifact.mjs` (+ `.d.mts`) owns the shape:

````
<state dir>/contrast-matrix.md          ← CONTRAST_ARTIFACT
# Contrast matrix
…one paragraph saying a blank cell is a question, not a typo…
```stelow-contrast
{ "places": [...], "states": [...], "cells": { "cart|paid": ["edit"] } }
```
````

| Decision | Why |
|---|---|
| Markdown with a fenced block, not JSON alone | The worker's deliverable is read by a person and by the host. The prose states the rule the derivation enforces; the fence is what the host parses. |
| `stelow-contrast`, not a plain `json` fence | A draft may legitimately carry a `json` example. A parser that takes "the first JSON block" takes the example. Pinned by the decoy case in the test. |
| JSON inside the fence | No new dependency may be added for this, and JSON is the one carrier that round-trips the model exactly — key order, arrays and numbers included. YAML would need a parser and a normalisation story. |
| `parseContrastArtifact` validates through `assertContrastModel` | An artifact that is not a matrix is refused by the model's own invariants (`place "checkout" declares no affordance`), not by a parser shrug. A draft gets the sentence about what is missing. |
| `CONTRAST_ARTIFACT` imported by `lib/state-dir-files.mjs` | `bb stelow playbook` is how a worker learns the file exists. One owner for the name: a second spelling is a worker writing a file nobody parses. |
| Registered as a `conditional` state-dir file | The card earns it (`scope` may be bypassed); reporting it missing would train the worker to ignore the verdict that is real. |

**Registration gap, stated:** the stage catalog
(`data/stelow-stage-catalog.json`) is generated from upstream `stages.yaml` and is
sync-owned, so `scope.artifacts` does not yet list `contrast-matrix.md`. Adding it
there is an upstream change plus a sync (AGENTS.md: fix upstream, let the sync
propagate), not a hand edit here. Until it lands, the host names the file through
the state-dir registry, which is the same path that names `scope-map.json` — the
worker is told the exact file, which is the part that matters for the round trip.

## 2. Layer 2 — the question schema carries its premise

### 2.1 The columns, additively

`server/core-migrations.ts` (`createQuestionTables`) now runs:

```
ensureColumns(db, "ask_contracts", [["premise", "TEXT"], ["reversal_cost", "TEXT"]])
```

Both nullable, no rebuild, no default that could lie about a legacy row.
`tests/fixtures/migration-appended-columns.json` gained an `ask_contracts` entry,
so a fresh install is checked for the columns and `tests/core-migrations.test.mjs`
fails if the ALTER is ever deleted — the v0.61.0 boot-refusal failure class the
fixture's own header describes.

### 2.2 Fail closed on the new path, tolerant on the old one

`recordDerivedQuestions(db, rows)` is the **creation path for a derived
question**:

- `premise` mandatory: `derived question "d1" has no premise — a derived question
  must name the cell (place|state) or artifact (artifact:<path>:<line>) it came
  from; a question without one cannot be checked or invalidated by a rewind`.
- a premise that is present but unreadable is refused separately, carrying the
  grammar's own sentence (`has an unreadable premise: premise: …`), because a
  stored premise that resolves to nothing is worse than none.
- `reversal_cost` mandatory: a level (`low|medium|high`) plus the one sentence
  saying why.
- validation runs over the whole batch **before** the transaction opens: half a
  derived ask is worse than none, because the half that landed is the half a
  reader finds.

`contract_id` is `NOT NULL` in the table it grew out of, and a derived question
answers no checklist contract — the row stores `''`, the same empty-string
convention `split_proposals.question` already uses, and every reader treats falsy
as none.

Legacy paths are untouched: `recordAskContracts` writes the old columns only,
`consumeAskContract` keeps its signature and its `string | null` return, and
`questionPremises` returns `premise: null, reversalCost: null` for a row written
before the columns existed. `tests/ask-contracts.test.mjs` now runs
`ensureColumns` over the pre-premise table instead of pre-declaring the new
columns, so the test proves the migration is what makes the new reader load an
old row.

### 2.3 The composition the brief asked for

`recordContrastAsks(db, { cardId, artifact, askedAt, makeId })` parses the
artifact, derives its questions, and records each one with `premise` and
`reversal_cost`. That is the ask creation path for a derived question: a card
whose `contrast-matrix.md` has a blank cell gets a row whose premise names that
cell.

## 3. Layer 3 — a rewind invalidates by premise, derived

`lib/premise-staleness.mjs` (+ `.d.mts`), pure, with the filesystem handed in:

- **Grammar.** `place|state` or `place|state|affordance`, `+`-joined for several
  cells; `artifact:<workspace-relative path>:<line>` for a decision that rests on
  a document (1-based line, the number an editor shows). An unreadable premise
  throws naming itself, so it can be refused at the door rather than stored.
- **Three-valued verdict.** `{stale:true, missing}` when an observed ref is gone;
  `{stale:false, checked}` when every observed ref survives; **`null`** when
  nothing could be observed. `null` is not "not stale": an unreadable matrix or
  artifact must never accuse a decision, so a card mid-rewrite cannot mark every
  answer stale through an error.
- **Observers.** `cellObserver(model)` answers whether the matrix still declares
  the coordinate (a filled cell is not a missing cell — filling it is what
  answering did); `artifactObserver(read)` answers whether the file still has the
  cited line; `observeFromCard({ stateDir })` composes both against the card's
  own state dir.

**Derived, never flagged** — the same discipline as restore
(`lib/card-restore-pending.mjs`): the verdict is a comparison made at read time
against the card's live files, so nobody has to remember to set it, and a stored
flag cannot go stale. The repo has no `rewind` verb (a drag refuses one,
`lib/card-move.mjs`), so "after a rewind" is modelled as what it produces: the
matrix file changed and the row's premise no longer resolves.

**Where it lands:** `lib/question-contracts.mjs` gains
`consumeAnsweredContract(db, cardId, question, { consumedAt, observe })`. When the
premise is gone the declaration is **not consumed** (a stale decision must not
satisfy a checklist contract) and the verdict comes back to the caller. Both
answer doors resolve the observation once, from the card's current state dir
(`server/runtime/wiring/gate-surfaces.ts`), and
`lib/question-answer-recording.mjs` — extracted from the door so the trail rule is
testable on its own — writes the decision plus one factual line:
`Stale decision: its premise no longer exists (cart|paid), so this answer no
longer rests on …`. `server/runtime/question-answers.ts` stays under the 400-line
hard limit (394).

## 4. The five red proofs (AC 1 twice)

Five acceptance criteria, one red proof each; AC 1 has two halves that fail
independently, so it is proved twice. Each mutation was applied to this branch,
the named test run, and the file restored (verified byte-identical against a
pre-mutation copy).

| AC | Mutation | Failing assertion (verbatim) |
|---|---|---|
| 1a — round trip | `renderContrastArtifact` writes the model without `states` | `Error: contrast model: cell "cart\|empty" names state "empty", which the model does not declare` — the parse-back assertion cannot even be evaluated |
| 1b — one cell, one question | `contrastArtifactQuestions` drops `empty-cell` questions | `AssertionError: mutating one cell in the file derives exactly one question` (actual `0`, expected `1`) |
| 2 — a card asks a derived question | `contrastAskDeclarations` stops emitting `premise` | `Error: derived question "askc_1" has no premise — …` from `recordContrastAsks`, i.e. the wiring refuses to record a question that lost its cell |
| 3 — no premise, no question | the explicit `if (!premise)` refusal in `derivedRow` is disabled | `AssertionError: a derived question without a premise is refused, naming the missing field` (actual `… has an unreadable premise: premise: a premise cannot be empty`, expected `/derived question "d1" has no premise/`) |
| 4 — rewind invalidates | `cellObserver` reports every cell as present | `AssertionError: a cell the rewound matrix no longer declares reads stale` (actual `{stale:false,missing:[],checked:1}`, expected `{stale:true,missing:['cart\|paid'],checked:1}`); at the door, `not ok 2 - a premise the rewind removed is trailed as a stale decision` |
| 5 — additive migration | the `ensureColumns` call removed from `core-migrations.ts` | `not ok 2 - a fresh install gets every column the appends create`: `ask_contracts.premise exists on a fresh install…`; with the migration also removed from the legacy fixture, the reader fails `SqliteError: no such column: premise` |

AC 1 has two halves because "round trip" and "exactly one question" fail
independently: a renderer that drops a field breaks the first, a derivation that
filters a kind breaks the second.

## 5. Gates

| Command | Exit |
|---|---|
| `node tests/contrast-model.test.mjs` (unchanged contract) | 0 |
| `node tests/contrast-artifact.test.mjs` | 0 |
| `node tests/contrast-asks.test.mjs` | 0 |
| `node --experimental-strip-types --import ./tests/register-ts-source.mjs tests/answer-premise-staleness.test.mjs` | 0 |
| `node tests/ask-contracts.test.mjs` | 0 |
| `node --experimental-strip-types --import ./tests/register-ts-source.mjs --test tests/core-migrations.test.mjs tests/migration-statement-hashes.test.mjs` | 0 |
| `node tests/declaration-surface.test.mjs` | 0 (273 declaration files) |
| `npm run typecheck` | 0 |
| `npm run quality:shape` | 0 (17 changed owned files; no changed line over 160 characters; 39 inherited lint findings, none new; boot cost 493/502 leaf commands = 98.2% under the 99.8% ceiling) |
| `npm test` | 0 |

## 6. What I did not do, and why — including what a live card must still prove

- **No live card asked a derived question.** `recordContrastAsks` is the ask
  creation path and is proven against real SQLite and a real state dir, but
  **nothing calls it yet**: the worker's `bb stelow ask` carries no premise, and no
  host verb materialises the artifact. What remains for a live card: a `scope`
  worker writes `contrast-matrix.md`, and a caller passes that artifact to
  `recordContrastAsks` (or the ask surface grows `--premise` so a worker-driven
  derived ask reaches `recordDerivedQuestions`). Until then the matrix derives
  questions that the card does not yet ask.
- **No CLI flag, no new verb.** Adding `--premise`/`--reversal-cost` to
  `bb stelow ask` was considered and dropped: `createAskCommand` has no test
  harness in this repo, so the flag would have shipped untested — worse than the
  gap it closes. The seam is ready for it (`recordDerivedQuestions` is the
  boundary), and the flag belongs with its own test.
- **No UI work.** Nothing renders the premise or a premise-staleness flag yet;
  the only visible trace is the trail line every answered session already shows.
  A badge or a card-detail row for "this decision's ground is gone" is a design
  change, not wiring.
- **No read surface for an already-recorded answer.** `questionPremises` and
  `stalenessOfAnswered` are the read half of layer 3 (both exercised in
  `tests/contrast-asks.test.mjs`), but no card-detail field consumes them: the
  enforcement today is at the answer boundary, where the contract is not consumed
  and the trail names the premise. Listing past answers as stale is the next wire,
  and it is UI work.
- **The stage catalog was not edited.** `data/stelow-stage-catalog.json` is
  generated from upstream `stages.yaml`; declaring the artifact there requires an
  upstream change, a release, and a sync (`docs/skills-sync-notes.md`). The
  host-side registry names the file in the meantime.
- **`skills/` and `data/stelow` were not touched**, so no worker prompt tells the
  `scope` stage WHAT to put in the matrix beyond the file's own paragraph. A
  methodology sentence ("record the places you are deciding between, crossed with
  the states that matter") belongs upstream.
- **No `premise` on generic asks.** Legacy contract asks keep working without a
  premise, on purpose: the additive rule is "a derived question cannot exist
  without one", not "rewrite every question ever asked". Retrofitting premises
  onto existing rows would be a guess about cells nobody recorded.
- **One unrelated finding, handed off:** while writing
  `docs/audits/2026-10-23-scope-3-record.md` from evidence, two of its acceptance
  criteria turned out to have no guard (`3.AC-3` terminal-card filtering,
  `3.AC-5` running-path `last_error`). That record names the mutations and the
  green results; fixing them belongs to its own commit, not to this branch.
