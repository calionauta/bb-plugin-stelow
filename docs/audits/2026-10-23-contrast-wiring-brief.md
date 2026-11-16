# Make the derived contrast questions actually reach a card

**Type:** feature brief, fresh context. Load `/skill:stelow-workflow-coding-standards`
(KISS, one owner per fact, fail fast, file/function budgets).
**Base:** `origin/master` (now 0.89.0). Branch `feat/contrast-wiring-2026-10-23`, own worktree.

## What already exists and must not be rebuilt

`lib/contrast-model.mjs` (merged, #418) already derives questions from a matrix:
invariants throw naming the id; empty cells, a shared affordance and an unhandled
state return questions that each carry `id`, `premise`, `options`, `reversal_cost`.
Read that module and its test first - it is the contract.

What is missing is everything that would make a card ASK such a question. Three
layers, in dependency order. Do them in this order and stop at the first that
cannot be finished honestly.

## Layer 4 (do this first): somebody must produce the matrix

No stage emits a contrast matrix, so the derivation has nothing to consume. Make
the contrast an ARTIFACT, exactly like every other artifact in this repo:

- A markdown file under the card's state dir, written by the WORKER (there is no
  helper verb for artifacts; `bash data/stelow schema artifacts` exits 2). One
  writer for `state.md`, unchanged.
- The file carries the matrix in a fenced block that `lib/contrast-model.mjs` can
  parse back, so the round trip is mechanical rather than interpretive.
- Where it belongs: the stage that decides scope (read `docs/audits/` records and
  the workflow `stages.yaml` for the stage that owns planning). State your choice
  and why in the record; do not invent a new stage.

## Layer 2: the question schema must carry the premise

`ask_contracts` today has options and no premise, so a derived question would lose
the cell it came from the moment it becomes a question. Extend the contract with
`premise` (the exact `place|state` or `artifact:line`) and `reversal_cost`
(`low|medium|high` plus one sentence). Migration must be additive and fail closed:
an older row without a premise still loads, and a NEW question cannot be created
without one.

## Layer 3: rewind must invalidate by premise

An answer whose premise cites a cell or an artifact that no longer exists after a
rewind is not an answer, it is a stale decision. Derive staleness from the premise
- do not add a flag a human has to remember to set. This is the same class as the
restore defect fixed in `card-restore-pending.mjs`: read that module's approach and
follow it.

## Gaps to close on the way

- `docs/audits/2026-10-23-scope-3-record.md` does not exist. Write it from
  `git log --stat fix/state-honesty-2026-10-23` and the diff - from evidence, never
  from memory. It must name the red proofs and the gate exits, like its siblings.

## Acceptance criteria

1. **Round trip.** A matrix written as the artifact parses back to the same model;
   mutating one cell in the file changes exactly one derived question.
2. **A card asks a derived question.** With the wiring in place, a card whose
   matrix has a blank cell gets a question whose premise names that cell. Prove it
   at the layer you can test without a live worker (the ask creation path), and say
   plainly in the record what still needs a live card to prove.
3. **No premise, no question.** The creation path refuses a question without one,
   naming the missing field.
4. **Rewind invalidates.** An answer whose premise no longer exists reads as stale
   after a rewind, and one whose premise survives does not.
5. **Additive migration.** A row written before this change still loads.
Each with a red proof: disable the check, watch the named assertion fail, restore.

## Boundaries

- No new dependency. No UI work beyond what the existing surfaces already render.
- Never edit `skills/` or `data/stelow`; the helper owns `state.md`.
- Fresh worktree: `npm ci`, or symlink the main checkout's `node_modules` and run
  `npm rebuild better-sqlite3` (a missing binding shows as
  `Could not locate the bindings file`, which is the install, not your change).
  An incomplete install also shows `Cannot find module 'pele'`.
- A `.mjs` imported from TypeScript needs its `.d.mts` in the same commit.
- Gates with exit codes in the record: `typecheck`, `quality:shape`, `npm test`.
- Never push, merge, tag or release.

## Deliverable

`docs/audits/2026-10-23-contrast-wiring-record.md`: the stage you chose and why, the
artifact shape, the schema change and its migration, the staleness derivation, the
five red proofs, the exits, and "what I did not do and why" - including, explicitly,
what still requires a live card to prove.

Report under 250 words: which layers landed, the stage chosen, the red proofs, the
three exits, and the one thing a human must run to see it end to end.
