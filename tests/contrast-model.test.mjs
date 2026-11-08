import assert from "node:assert/strict";
import { assertQuestionFloor, deriveQuestions } from "../lib/contrast-model.mjs";

// The control the whole feature is measured against: a filled 2x3 matrix where
// every cell has an affordance and no affordance is exposed by two places. Every
// other case below deviates from this model by exactly one fact, so a question
// that appears is the question that fact asked.

function filledMatrix() {
  return {
    places: [
      { id: "cart", affordances: ["resume", "edit", "clear"] },
      { id: "checkout", affordances: ["add-item", "confirm", "request-refund"] },
    ],
    states: ["empty", "paid", "refunded"],
    cells: {
      "cart|empty": ["resume"],
      "cart|paid": ["edit"],
      "cart|refunded": ["clear"],
      "checkout|empty": ["add-item"],
      "checkout|paid": ["confirm"],
      "checkout|refunded": ["request-refund"],
    },
  };
}

function blank(model, key) {
  delete model.cells[key];
  return model;
}

function idsOf(questions) {
  return questions.map((question) => question.id);
}

function sorted(questions) {
  return [...questions].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

// 1. A filled matrix emits zero questions. This is the control: a derivation
// that asks about a complete matrix cries wolf, and the first question a reader
// cannot act on is the last one they read.
assert.deepEqual(deriveQuestions(filledMatrix()), [], "a filled matrix with no shared affordance asks nothing");

// 2. Blank one cell, get exactly one question naming that cell. The premise is
// the difference between a question and a complaint: it is the coordinate a
// reader opens and a later rewind fills.
const single = deriveQuestions(blank(filledMatrix(), "checkout|paid"));
assert.equal(single.length, 1, "one blank cell asks exactly one question");
assert.equal(single[0].id, "contrast:checkout|paid", "the id is the cell's coordinates");
assert.equal(single[0].premise, "checkout|paid", "the premise names the blank cell, not the matrix");
assert.equal(single[0].kind, "empty-cell", "a blank cell is reported as an empty cell");
assert.ok(single[0].options.length >= 2, "a blank cell carries at least two options");

// An absent key and an empty array are the same fact. If they were not, a
// matrix written by two different tools would ask different questions about the
// same hole.
const asEmptyArray = filledMatrix();
asEmptyArray.cells["checkout|paid"] = [];
assert.deepEqual(deriveQuestions(asEmptyArray), single, "an empty array and an absent key are one blank cell");

// Two blanks in two different columns are two questions, with distinct ids.
const twoBlanks = blank(blank(filledMatrix(), "checkout|paid"), "cart|empty");
const doubled = deriveQuestions(twoBlanks);
assert.equal(doubled.length, 2, "two blank cells ask two questions");
assert.deepEqual(
  new Set(idsOf(doubled)),
  new Set(["contrast:checkout|paid", "contrast:cart|empty"]),
  "the two questions carry distinct ids, one per cell",
);

// 3. A shared affordance yields the merge question, with both places in the
// premise. "affordance shared" is not a location; the two cells are.
const shared = filledMatrix();
shared.places[0].affordances.push("pay-button");
shared.places[1].affordances.push("pay-button");
shared.cells["cart|paid"].push("pay-button");
shared.cells["checkout|paid"].push("pay-button");
const merged = deriveQuestions(shared);
assert.equal(merged.length, 1, "a filled matrix with one shared affordance asks only the merge question");
assert.equal(merged[0].kind, "shared-affordance", "a shared affordance is reported as a merge question");
assert.equal(merged[0].id, "contrast:pay-button", "the merge question is keyed by the affordance");
assert.match(merged[0].premise, /cart\|paid\|pay-button/, "the premise names the cart cell that exposes it");
assert.match(merged[0].premise, /checkout\|paid\|pay-button/, "the premise names the checkout cell too, not a generic 'shared'");
assert.ok(merged[0].options.length >= 2, "the merge question carries at least two options");

// One place exposing an affordance in two of its own states is NOT a merge:
// the question is about two places, so a place counting itself twice must stay
// silent or every reusable affordance becomes a false alarm.
const reusedInPlace = filledMatrix();
reusedInPlace.cells["cart|paid"].push("resume");
assert.deepEqual(deriveQuestions(reusedInPlace), [], "one place exposing an affordance in two states is not a merge");

// A column blank everywhere is ONE hole, stated once. Asking once per place
// would be the same fact three times, which is how a control stops being read.
const deadColumn = blank(blank(filledMatrix(), "cart|refunded"), "checkout|refunded");
const dead = deriveQuestions(deadColumn);
assert.equal(dead.length, 1, "a fully blank column asks one question, not one per place");
assert.equal(dead[0].kind, "dead-state", "a fully blank column is reported as a dead state");
assert.match(dead[0].premise, /cart\|refunded/, "the dead-state premise names the column's cart cell");
assert.match(dead[0].premise, /checkout\|refunded/, "the dead-state premise names the column's checkout cell");

// 4. Invariants throw with the offending id; a blank cell returns and never
// throws. The split is the point: an unbuildable matrix is refused, an
// incomplete one is answerable.
const noAffordance = filledMatrix();
noAffordance.places[1].affordances = [];
assert.throws(
  () => deriveQuestions(noAffordance),
  /place "checkout" declares no affordance/,
  "a place with no affordance is refused, naming the place",
);

const dangling = filledMatrix();
dangling.cells["cart|paid"].push("pay-freely");
assert.throws(
  () => deriveQuestions(dangling),
  /affordance "pay-freely" appears in no place/,
  "an affordance no place declares is refused, naming the affordance",
);

const leaked = filledMatrix();
leaked.cells["cart|paid"].push("confirm");
assert.throws(
  () => deriveQuestions(leaked),
  /cell "cart\|paid" uses affordance "confirm", which place "cart" does not declare/,
  "an affordance declared by another place is refused, naming the cell and the place",
);

assert.doesNotThrow(() => deriveQuestions(blank(filledMatrix(), "cart|empty")), "a blank cell never throws");

// 5. No premise, no question. A place id carrying the separator makes a premise
// that names two cells at once, so the emitter refuses the model instead of
// emitting a question nobody can locate.
const brokenPlace = filledMatrix();
brokenPlace.places[0].id = "cart|paid";
assert.throws(
  () => deriveQuestions(brokenPlace),
  /"cart\|paid" contains "\|"/,
  "a place id carrying the separator is refused, naming the id and the character",
);

const brokenState = filledMatrix();
brokenState.states[1] = "paid+refunded";
assert.throws(
  () => deriveQuestions(brokenState),
  /"paid\+refunded" contains "\+"/,
  "the same guard covers states, not only places",
);

const unreadableKey = filledMatrix();
unreadableKey.cells["cart"] = ["resume"];
assert.throws(
  () => deriveQuestions(unreadableKey),
  /cell "cart" is not addressable/,
  "a cell key that is not place|state is refused rather than guessed at",
);

// The floor itself refuses a question without a premise, a decision with one
// option, and an option that is itself a question — each one is a way a derived
// question could stop being answerable.
const shaped = {
  id: "contrast:cart|paid",
  kind: "empty-cell",
  prompt: "cart offers nothing in paid — missing, or absent?",
  options: [{ id: "add", label: "Add an affordance here." }, { id: "record", label: "Record the absence." }],
  reversal_cost: { level: "low", why: "nothing depends on a blank cell yet." },
};
assert.throws(
  () => assertQuestionFloor({ ...shaped, premise: "" }),
  /has no premise/,
  "a question without a premise is refused as a complaint",
);
assert.throws(
  () => assertQuestionFloor({ ...shaped, premise: "cart" }),
  /is not a place\|state/,
  "a premise that names no cell is refused instead of emitted as a broken coordinate",
);
assert.throws(
  () => assertQuestionFloor({ ...shaped, premise: "cart|paid", options: [shaped.options[0]] }),
  /offers 1 options/,
  "a decision with one option is refused",
);
assert.throws(
  () => assertQuestionFloor({ ...shaped, premise: "cart|paid", options: [shaped.options[0], { id: "q", label: "Which one?" }] }),
  /is itself a question/,
  "an option phrased as a question is refused",
);
assert.throws(
  () => assertQuestionFloor({ ...shaped, premise: "cart|paid", reversal_cost: { level: "maybe", why: "?" } }),
  /needs a reversal_cost/,
  "a reversal cost outside low/medium/high is refused",
);
assert.deepEqual(assertQuestionFloor({ ...shaped, premise: "cart|paid" }), { ...shaped, premise: "cart|paid" },
  "a shaped question passes the floor and comes back unchanged");

// 6. Deterministic: the same model derives the same ids twice, and a model that
// lists its places and states in another order derives the same questions. Ids
// derived from position would pass the first half and fail the second.
function mixedMatrix() {
  const model = blank(filledMatrix(), "checkout|paid");
  model.states.push("expired");
  model.places[0].affordances.push("pay-button");
  model.places[1].affordances.push("pay-button");
  model.cells["cart|paid"].push("pay-button");
  model.cells["checkout|refunded"].push("pay-button");
  return model;
}

const first = deriveQuestions(mixedMatrix());
const second = deriveQuestions(mixedMatrix());
assert.deepEqual(idsOf(first), idsOf(second), "the same model derives the same ids twice");
assert.deepEqual(first, second, "the same model derives the same questions twice");
assert.deepEqual(
  new Set(idsOf(first)),
  new Set(["contrast:checkout|paid", "contrast:*|expired", "contrast:pay-button"]),
  "all three derived kinds are present, each with its own id",
);

const reordered = mixedMatrix();
reordered.places.reverse();
reordered.states.reverse();
assert.deepEqual(sorted(deriveQuestions(reordered)), sorted(first),
  "ids, premises and options do not depend on the order the model lists its places and states");

console.log("contrast model test ok: 6 acceptance criteria, 3 invariants, 3 derived kinds");
