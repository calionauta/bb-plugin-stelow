# Contrast as a table, and the questions that fall out of it

**Type:** feature brief, fresh context. Load `/skill:stelow-workflow-coding-standards`.
**Base:** `origin/master`. Branch `feat/contrast-questions-2026-10-23`, own worktree.

## The evidence this rests on

A real card this session asked THREE questions, and all three were environmental
(stash, switch branch, leave blocked). No design question appeared. The reason is
structural, not a lazy worker: the contrast between scopes and interfaces is
recorded as PROSE, and prose cannot tell a worker where a contradiction is. A
matrix can.

Meanwhile two defects in the question machinery were already fixed and are the
foundation you build on: `--force` no longer bypasses the substance floor, and a
restore no longer reopens a question it promised to hold. Read
`docs/audits/2026-10-23-scope-3-record.md` and the `question-gate` module before
designing anything.

## The job: pure lib, no wiring

**`lib/contrast-model.mjs`** - a matrix model and its derived output.

Model shape: `{ places: [{id, affordances: [ids]}], states: [ids], cells: {"place|state": [affordanceIds]} }`.
Keep it small and explicit; no nesting beyond that.

Two different outputs, and the difference is the point:

1. **Invariants** (throw, naming the id) - a place with no affordance; an
   affordance that appears in no place; a cell referencing an affordance the place
   does not declare.
2. **Derived questions** (return, never throw) - an empty cell (place has nothing
   in that state: missing feature, or deliberately absent?); the same affordance
   exposed by two different places (one feature or two?); a state that no place
   handles at all.

Every derived question MUST carry, or it is not emitted:

- `id` - stable, derived from its coordinates (`contrast:checkout|paid`);
- `premise` - `artifact:line` or `place|state|affordance`, the exact cell it came
  from, so a reader can check it and a later rewind can invalidate it;
- `options` - at least two, phrased as decisions, not as "what should I do?";
- `reversal_cost` - `low | medium | high`, with one sentence of why.

A question without a premise is a complaint. The floor must refuse it.

## Acceptance criteria (each must fail before the change)

1. **A filled matrix emits zero questions.** Every cell has an affordance and no
   affordance is shared: `deriveQuestions(model)` returns `[]`. This is the control
   that keeps the feature from crying wolf.
2. **Blank one cell, get exactly one question.** The returned question's `premise`
   names that cell, and its options are at least two. Blanking two cells gives two,
   with distinct ids.
3. **A shared affordance yields the merge question**, with both places in the
   premise, not a generic "affordance shared".
4. **Invariants throw, questions do not.** A place with no affordance throws with
   the place id; a matrix that merely has an empty cell returns a question and
   never throws.
5. **No premise, no question.** Feed a model whose cell cannot be addressed (e.g. a
   place id containing the separator) and assert the emitter refuses rather than
   emitting a question with a broken premise.
6. **Deterministic.** The same model derives the same ids twice.

Red proof for each: disable the check or the derivation and show the named
assertion failing, then restore.

## Boundaries

- **No UI, no RPC, no DB migration, no prompt change.** This is the model and its
  derivation. Wiring it to `ask_contracts` is a later scope, and the brief for it
  will read this module's contract.
- No new dependency. No edit to `skills/` or `data/stelow`.
- Fresh worktree: `npm ci` (about 2 min), or symlink the main checkout's
  `node_modules` and delete the symlink before committing. An incomplete install
  shows a fake `Cannot find module 'pele'` at `server/runtime/platform.ts:145` -
  that is the install, not your change. Same for a missing
  `better_sqlite3.node`: `npm rebuild better-sqlite3`.
- A `.mjs` imported from TypeScript needs its `.d.mts` in the same commit.
- Gates with exit codes in the record: `typecheck`, `quality:shape`, `npm test`.
- Never push, merge, tag or release.

## Deliverable

`docs/audits/2026-10-23-contrast-record.md` with the model, the three invariants,
the three derived question kinds and their phrasing rules, the six red proofs, the
three exits, and "what I did not do and why" (wiring to the ask surface is one of
them, by design).

Report under 250 words: the model shape you settled on, one example derived
question with its premise and options, the six proofs, and the three exits.
