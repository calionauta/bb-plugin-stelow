# CONTRAST record — the matrix, and the questions that fall out of it

**Scope:** the contrast brief of 2026-10-23. `lib/contrast-model.mjs` and its
derivation, pure lib, no wiring.
**Date:** 2026-10-23
**Branch:** `feat/contrast-questions-2026-10-23`, from `origin/master` 358d68d5.
**Status:** model, derivation, floor and six red proofs done. Wiring to the ask
surface is absent on purpose (section 6).

## 0. The premise, checked before it was built on

The brief points at `docs/audits/2026-10-23-scope-3-record.md`. **That file does
not exist in this checkout** — not on this branch, not on `origin/master`, not on
any other local branch (`git ls-tree -r origin/master --name-only -- docs/audits`
returns scope 1, scope 2, scope 2-s4, 4, 5, 6 and 7 — there is no 3). So the two
question-machinery
defects the brief calls "already fixed" were verified in code instead of read in
prose, and both are real:

- **the substance floor is not forceable.** `decideAskGate` in
  `lib/question-gate.mjs` runs `questionSubstanceGate` *before* the `if (!forced)`
  block, so `--force` cannot reach it; the comment says why in one line
  ("a probe that can be forced through is a probe that will be").
- **a restore no longer reopens a question it withheld.**
  `reactivateRestorePending` in `lib/card-restore-pending.mjs` returns
  `questionsReopened: 0` with `questionsWithheld` counted, and the docstring
  names the fresh-worker `superseded` resolution that made reopening a badge
  that vanished a second later.

Neither module was touched. The record is stated here because the next reader
will look for scope-3 and not find it, and "the brief said it was fixed" is not
evidence.

## 1. The model

```js
{
  places: [{ id, affordances: [affordanceId] }],
  states: [stateId],
  cells: { "place|state": [affordanceId] },
}
```

Small and flat on purpose: its job is to be read as a table by a worker and by a
person, not to model the product. Nothing nests beyond that, and both holders are
lists, so a model stays diffable.

| Rule | Why |
|---|---|
| An absent cell key and `[]` are the same fact | two tools writing the same hole must ask the same question; pinned by `assert.deepEqual` in the test |
| `\|` separates coordinates, `+` joins cells, `*` means every place, `contrast:` opens an id | so one premise resolves to exactly one cell, and one id to one question |
| none of those characters may appear **inside** an id | `a\|b` as a place id makes `a\|b\|paid` name two cells at once; refused at the door (`part`), not derived into a question |
| a cell is a set | listing the same affordance twice is the same cell, not two |

The control fixture — every cell filled, no affordance exposed by two places —
derives nothing. Every other case in the test deviates from it by exactly one
fact, so a question that appears is the question that fact asked.

## 2. The three invariants (throw, naming the id)

A model that breaks one is refused before it can ask anything. The refusal is the
boundary between "this is a matrix" and "this is a draft".

| # | Invariant | Message names |
|---|---|---|
| 1 | a place declares no affordance | the place: `place "checkout" declares no affordance — a place where nothing can be done is a hole, not a place` |
| 2 | a cell uses an affordance that appears in no place | the affordance and the cell: `affordance "pay-freely" appears in no place — cell "cart\|paid" uses it, but no place declares it` |
| 3 | a cell uses an affordance its own place does not declare | the cell, the affordance, the place: `cell "cart\|paid" uses affordance "confirm", which place "cart" does not declare` |

Invariant 2 runs over the whole model before invariant 3, because a dangling id
would otherwise be reported as a leak and the leak sentence ("this place does not
declare it") would be false when nobody does.

**Reading of invariant 2, stated so it can be argued with.** The brief says "an
affordance that appears in no place". With this shape, affordances are declared
*only* inside `places[].affordances`, so the only id that can appear in no place
is one a cell mentions and no place declares. That is what it checks. A place
that declares an affordance its cells never use is a different fact (an unused
declaration, not a dangling reference) and is not checked here — see section 6.

Boundary refusals, outside the three and also thrown: an id carrying reserved
punctuation, a cell key that is not exactly `place|state`, a cell naming a place
or state the model does not declare, duplicate ids, empty `places`.

## 3. The three derived questions (returned, never thrown)

| kind | id | premise | the decision |
|---|---|---|---|
| `empty-cell` | `contrast:cart\|paid` | `cart\|paid` | missing feature, or deliberately absent? |
| `dead-state` | `contrast:*\|paid` | every cell of the column, joined: `cart\|paid+checkout\|paid` | handle the state, or drop it from the model? |
| `shared-affordance` | `contrast:pay-button` | every cell that exposes it, `place\|state\|affordance`: `cart\|paid\|pay-button+checkout\|refunded\|pay-button` | one feature with one contract, or one per place? |

Phrasing rules, all enforced by `assertQuestionFloor` rather than by review:

1. **A premise is the cell**, `place|state` or `place|state|affordance`, joined by
   `+` for several. An empty premise is refused as *a complaint*; a premise that
   names no cell is refused rather than emitted.
2. **At least two options**, each with an id and a label. An option phrased as a
   question (label ends in `?`) is refused — an option states the decision it
   takes.
3. **`reversal_cost` is a level and a sentence**: `low | medium | high` plus why.
   Empty-cell is `low` (nothing runs on a blank cell today); a shared affordance
   is `medium` at two places and `high` above two, the sentence naming the count;
   a dead state is `high`, because the state may be reachable from outside the
   matrix (webhook, import, another card) and dropping it is a contract change.
4. **One hole, one question.** A column where no place offers anything is a
   *state* question and supersedes the empty-cell questions inside it, because
   three copies of the same fact is how a control stops being read. And one
   affordance in two places is one merge question regardless of how many places
   share it: the subject is the affordance, not the pair.

Ids and premises are the coordinates, sorted where several cells are involved, so
a model that lists its places and states in another order derives the same
questions — which is what makes an id something a later rewind can look up.

## 4. The six red proofs

Each mutation disables one check or one derivation and the test fails on the
assertion written for it. The module was restored from a green copy after every
run (`sha1 04c6e349` before and after).

| AC | Mutation | Failing assertion |
|---|---|---|
| 1 — filled matrix asks nothing | `questionsForState` returns an empty-cell question for a filled column | `a filled matrix with no shared affordance asks nothing` (actual `[{…}]`, expected `[]`) |
| 2 — blank one cell, one question | empty-cell derivation returns `[]` | `one blank cell asks exactly one question` (actual `0`, expected `1`) |
| 3 — both places in the merge premise | merge premise keeps only the first cell (`slice(0, 1)`) | `the premise names the checkout cell too, not a generic 'shared'` (actual `'cart\|paid\|pay-button'`) |
| 4a — invariants throw | invariant 1 removed from `readPlaces` | `a place with no affordance is refused, naming the place` (actual: invariant 2's sentence about `add-item`) |
| 4b — questions do not throw | `questionsForState` fails on an incomplete column | `a blank cell never throws` (`Error: contrast model: incomplete column` escaped `doesNotThrow`) |
| 5 — no premise, no question | reserved-punctuation guard removed from `part` | `a place id carrying the separator is refused, naming the id and the character` (actual: `cell "cart\|empty" names place "cart"`, i.e. refused for the wrong reason, downstream) |
| 6a — same model, same ids | emission order rotated by a module counter (`states.size > 1 && turn++ % 2`) | `the same model derives the same ids twice` |
| 6b — order-independent | merge place list left in model order instead of sorted | `ids, premises and options do not depend on the order the model lists its places and states` |

AC 4 has two proofs because it is two claims (invariants throw; questions do not).
AC 6 has two because determinism has two halves (same model twice; same model
reordered). The first attempt at 6a passed and was wrong: the mutation read
`states.length` on a `Set`, so it never fired — the short-circuit made the defect
inert. The recorded mutation uses `states.size` and does fail.

## 5. Gates

| Command | Exit |
|---|---|
| `node tests/contrast-model.test.mjs` (via `npm run test:contrast-model`) | 0 |
| `npm run typecheck` | 0 |
| `npm run quality:shape` | 0 (2 changed owned files; no changed line over 160 characters; 39 inherited lint findings, none new; boot cost 490/499 = 98.2% under the 99.8% ceiling) |
| `npm test` | 0 |

`tests/declaration-surface.test.mjs` passes over 271 declaration files with the
new `.d.mts`, so the declared names are bound by the module they describe.

## 6. What I did not do, and why

- **No wiring to the ask surface.** Not this scope, by the brief's own boundary:
  a `deriveQuestions` call feeding `ask_contracts` needs a matrix to exist on a
  card first, and that is the next brief's premise. This module is its contract.
- **No UI, no RPC, no schema migration, no prompt change, no new dependency.**
  The module is pure and takes a plain object.
- **No unused-declaration invariant.** A place may declare an affordance that no
  cell exposes. It is a real smell, but it is not one of the three the brief
  names, and inventing a fourth invariant would have made the emitted set depend
  on my reading rather than on the brief's. If it matters, it belongs in a
  separate recorded pass with its own red proof.
- **No reopening of the missing scope-3 record.** Reconstructing it would be
  prose written from memory of a document nobody can read; section 0 records what
  was actually verified in code instead.
- **No `FEATURES.md` entry.** Nothing user-facing ships yet: no surface reads the
  matrix, and an entry describing a derivation no user can reach would be a lie
  about the product. The entry belongs in the wiring scope, in the same commit as
  the surface that calls it.
- **No positional ids.** The obvious shortcut — numbering questions as they are
  emitted — passes a "same model twice" check and fails the moment a place is
  reordered, which is why AC 6 asserts both halves.
