/**
 * The contrast matrix: places crossed with states, and the questions a blank
 * cell asks.
 *
 * A card's contrast between scopes and interfaces was recorded as prose, and
 * prose cannot tell a worker WHERE the contradiction is. A matrix can. Every
 * place (a screen or a surface) is crossed with every state it can be in, and
 * each cell holds the affordances a reader can act on there. The matrix is
 * deliberately small — `{ places: [{ id, affordances }], states, cells }` and
 * nothing nested beyond that — because its job is to be READ as a table, not to
 * model the product.
 *
 * Two outputs, and the difference between them is the point:
 *
 * - INVARIANTS throw, naming the id. They say the thing is not a matrix yet:
 *   a place with no affordance (there is nothing to do there), an affordance a
 *   cell uses that no place declares (it exists nowhere), an affordance a cell
 *   uses that its own place does not declare (it leaked in from another place).
 *   A model that breaks one is refused before it can ask anything.
 *
 * - QUESTIONS are returned, never thrown. They say the matrix is complete
 *   enough to read and incomplete enough to need a decision: an empty cell
 *   (missing feature, or deliberately absent?), one affordance exposed by two
 *   places (one feature, or two?), a state no place handles at all.
 *
 * Every emitted question carries a PREMISE: the exact cell it came from, spelled
 * `place|state` or `place|state|affordance` and joined by `+` when it came from
 * several. A question without a premise is a complaint — a reader cannot check
 * it, and a later rewind cannot invalidate it by filling the cell it names. The
 * floor below refuses one, and the derivation applies the floor to what it built
 * rather than to the model, because an emitter that could skip the floor is an
 * emitter that will.
 *
 * The grammar is why a premise can be read back: `|` separates coordinates,
 * `+` joins cells, `*` stands for every place in a column, and `contrast:` opens
 * an id. None of those characters may appear INSIDE an id, so every id and every
 * premise resolves to exactly one cell. A model whose ids contain the separator
 * is refused at the door (see `part`) rather than derived into a question whose
 * premise names two cells at once.
 */

const SEPARATOR = "|";
const JOINER = "+";
const EVERY_PLACE = "*";
const ID_PREFIX = "contrast:";
const RESERVED = [SEPARATOR, JOINER, EVERY_PLACE];
const COST_LEVELS = new Set(["low", "medium", "high"]);
const KINDS = new Set(["empty-cell", "dead-state", "shared-affordance"]);

function fail(message) {
  throw new Error(`contrast model: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function listOf(model, key) {
  const value = model[key];
  if (!Array.isArray(value)) fail(`"${key}" must be an array`);
  return value;
}

/**
 * One coordinate, as text the grammar can carry. Reserved punctuation is the
 * whole reason a premise resolves to one cell: `a|b` as a place id would make
 * `a|b|paid` name either place "a" in state "b|paid" or place "a|b" in state
 * "paid", and a question nobody can locate is not worth asking.
 */
function part(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
  for (const reserved of RESERVED) {
    if (value.includes(reserved)) {
      fail(`${label} "${value}" contains "${reserved}", the matrix grammar's punctuation — a premise built from it could not be read back to its cell`);
    }
  }
  return value;
}

function cellKey(place, state) {
  return `${place}${SEPARATOR}${state}`;
}

/** An absent key and an empty array are the same fact: this cell is blank. */
function cellAt(grid, place, state) {
  return grid.get(cellKey(place, state)) ?? new Set();
}

function readPlaces(raw) {
  const places = new Map();
  for (const [index, entry] of raw.entries()) {
    const label = `places[${index}]`;
    if (!isRecord(entry)) fail(`${label} must be an object`);
    const id = part(entry.id, `${label} id`);
    if (places.has(id)) fail(`duplicate place id "${id}"`);
    if (!Array.isArray(entry.affordances)) fail(`place "${id}" needs an affordances array`);
    const affordances = new Set();
    for (const [position, value] of entry.affordances.entries()) {
      const affordance = part(value, `affordance ${position} of place "${id}"`);
      if (affordances.has(affordance)) fail(`place "${id}" repeats affordance "${affordance}"`);
      affordances.add(affordance);
    }
    if (affordances.size === 0) {
      fail(`place "${id}" declares no affordance — a place where nothing can be done is a hole, not a place`);
    }
    places.set(id, affordances);
  }
  if (places.size === 0) fail("the matrix has no place");
  return places;
}

function readStates(raw) {
  const states = new Set();
  for (const [index, value] of raw.entries()) {
    const state = part(value, `states[${index}]`);
    if (states.has(state)) fail(`duplicate state id "${state}"`);
    states.add(state);
  }
  return states;
}

function readCellKeys(raw, places, states) {
  if (!isRecord(raw)) fail(`"cells" must be an object keyed "place${SEPARATOR}state"`);
  const entries = [];
  for (const [key, value] of Object.entries(raw)) {
    const parts = key.split(SEPARATOR);
    if (parts.length !== 2) fail(`cell "${key}" is not addressable — a cell key is exactly "place${SEPARATOR}state"`);
    const [place, state] = parts;
    if (!places.has(place)) fail(`cell "${key}" names place "${place}", which the model does not declare`);
    if (!states.has(state)) fail(`cell "${key}" names state "${state}", which the model does not declare`);
    if (!Array.isArray(value)) fail(`cell "${key}" must be an array of affordance ids`);
    entries.push({ key, place, state, ids: value.map((id) => part(id, `affordance of cell "${key}"`)) });
  }
  return entries;
}

/**
 * Invariants 2 and 3, in that order across the whole model: an affordance no
 * place declares is a different mistake from one that leaked across places, and
 * the leak message would claim "this place does not declare it" when in fact
 * nobody does.
 */
function assertAffordancesDeclared(cells, places) {
  const declared = new Set();
  for (const affordances of places.values()) {
    for (const affordance of affordances) declared.add(affordance);
  }
  for (const { key, ids } of cells) {
    for (const id of ids) {
      if (!declared.has(id)) fail(`affordance "${id}" appears in no place — cell "${key}" uses it, but no place declares it`);
    }
  }
  for (const { key, place, ids } of cells) {
    for (const id of ids) {
      if (!places.get(place).has(id)) fail(`cell "${key}" uses affordance "${id}", which place "${place}" does not declare`);
    }
  }
}

function gridFrom(cells) {
  const grid = new Map();
  for (const { place, state, ids } of cells) grid.set(cellKey(place, state), new Set(ids));
  return grid;
}

function readModel(model) {
  if (!isRecord(model)) fail("expected the contrast model object");
  const places = readPlaces(listOf(model, "places"));
  const states = readStates(listOf(model, "states"));
  const cells = readCellKeys(model.cells, places, states);
  assertAffordancesDeclared(cells, places);
  return { places, states, grid: gridFrom(cells) };
}

/** Premise refs are sorted so the same question reads the same whatever order
 * the model happens to list its places in. */
function sortedRefs(refs) {
  return [...refs].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function emptyCellQuestion(place, state) {
  return {
    id: `${ID_PREFIX}${place}${SEPARATOR}${state}`,
    kind: "empty-cell",
    prompt: `${place} offers nothing in state ${state} — a missing feature, or deliberately absent?`,
    premise: cellKey(place, state),
    options: [
      { id: "add-affordance", label: `Add an affordance to ${place} in ${state} — the state needs an action here.` },
      { id: "record-absence", label: `Keep the cell blank on purpose — ${place} offers nothing in ${state}.` },
    ],
    reversal_cost: {
      level: "low",
      why: "a blank cell runs no code today, so filling it or freezing it costs only the edit.",
    },
  };
}

function deadStateQuestion(state, columns) {
  return {
    id: `${ID_PREFIX}${EVERY_PLACE}${SEPARATOR}${state}`,
    kind: "dead-state",
    prompt: `No place handles state ${state} — does the model need that state at all?`,
    premise: sortedRefs(columns.map(({ place }) => cellKey(place, state))).join(JOINER),
    options: [
      { id: "handle-state", label: `Handle ${state} — at least one place offers an affordance in it.` },
      { id: "drop-state", label: `Drop ${state} from the model — nothing here needs that state.` },
    ],
    reversal_cost: {
      level: "high",
      why: "a state nothing handles may still be reached from outside this matrix (a webhook, an import, another card), so deleting it is a contract change.",
    },
  };
}

function sharedAffordanceQuestion(affordance, places, refs) {
  return {
    id: `${ID_PREFIX}${affordance}`,
    kind: "shared-affordance",
    prompt: `"${affordance}" is exposed by ${places.join(", ")} — one feature, or one per place?`,
    premise: refs.join(JOINER),
    options: [
      { id: "one-feature", label: `Keep one affordance — ${places.join(" and ")} share "${affordance}" and its contract.` },
      { id: "per-place", label: `Give each place its own id — the places diverge and "${affordance}" splits.` },
    ],
    reversal_cost: places.length === 2
      ? { level: "medium", why: "merging or splitting an affordance in two places moves the habit of both readers without changing a contract." }
      : { level: "high", why: `merging or splitting one affordance across ${places.length} places rewrites every entry at once.` },
  };
}

/**
 * One column at a time. A column where NO place offers anything is one hole
 * stated once, as a state question; asking it once per place would interrupt a
 * reader N times with the same fact, and a control that cries wolf is ignored
 * on the day it is right. A column with some affordances reports only its blank
 * cells.
 */
function questionsForState(state, places, grid) {
  const columns = [...places.keys()].map((place) => ({ place, affordances: cellAt(grid, place, state) }));
  const blank = columns.filter(({ affordances }) => affordances.size === 0);
  if (blank.length === 0) return [];
  if (blank.length === columns.length) return [deadStateQuestion(state, columns)];
  return blank.map(({ place }) => emptyCellQuestion(place, state));
}

/**
 * The same affordance in two places is the merge question. One question per
 * affordance, not one per pair of places: "one feature or two?" is a question
 * about the affordance, and three places still take one decision.
 *
 * The premise lists EVERY cell that exposes the affordance, not a chosen
 * representative: removing one occurrence changes the premise, so a rewind
 * invalidates the question instead of letting it outlive the fact it rested on.
 * Refs and place names are sorted, so the wording of the question is the same
 * whatever order the model happens to list its places in.
 */
function sharedAffordanceQuestions(places, states, grid) {
  const exposures = new Map();
  for (const place of places.keys()) {
    for (const state of states) {
      for (const affordance of cellAt(grid, place, state)) {
        if (!exposures.has(affordance)) exposures.set(affordance, new Map());
        const perPlace = exposures.get(affordance);
        if (!perPlace.has(place)) perPlace.set(place, new Set());
        perPlace.get(place).add(state);
      }
    }
  }
  const questions = [];
  for (const [affordance, perPlace] of exposures) {
    if (perPlace.size < 2) continue;
    const refs = [];
    for (const [place, statesHere] of perPlace) {
      for (const state of statesHere) refs.push(`${cellKey(place, state)}${SEPARATOR}${affordance}`);
    }
    questions.push(sharedAffordanceQuestion(affordance, sortedRefs([...perPlace.keys()]), sortedRefs(refs)));
  }
  return questions;
}

function assertPremise(id, premise) {
  if (typeof premise !== "string" || premise.trim() === "") {
    fail(`question "${id}" has no premise — a question without a premise is a complaint`);
  }
  for (const ref of premise.split(JOINER)) {
    const parts = ref.split(SEPARATOR);
    const shaped = parts.length >= 2 && parts.length <= 3 && parts.every((side) => side.trim() !== "");
    if (!shaped) {
      fail(`question "${id}" premise "${premise}" is not a place${SEPARATOR}state[${SEPARATOR}affordance] cell reference`);
    }
  }
}

function assertOptions(id, options) {
  const count = Array.isArray(options) ? options.length : 0;
  if (count < 2) fail(`question "${id}" offers ${count} options — a decision needs at least two`);
  for (const option of options) {
    const labelled = typeof option?.id === "string" && option.id.trim() !== ""
      && typeof option.label === "string" && option.label.trim() !== "";
    if (!labelled) fail(`question "${id}" carries an option without an id or label — a chooser cannot pick a blank`);
    if (option.label.trim().endsWith("?")) {
      fail(`question "${id}" option "${option.id}" is itself a question — an option states the decision it takes`);
    }
  }
}

function assertCost(id, cost) {
  if (!COST_LEVELS.has(cost?.level)) fail(`question "${id}" needs a reversal_cost of low, medium or high`);
  if (typeof cost?.why !== "string" || cost.why.trim() === "") {
    fail(`question "${id}" needs one sentence saying why its reversal_cost is ${cost.level}`);
  }
}

/**
 * The floor every emitted question passes. Refuses a question a reader could not
 * check (no premise, or a premise naming no cell) or could not answer (fewer
 * than two options, an option that is itself a question, a cost with no reason).
 * Returns the question so callers can map it over a list.
 */
export function assertQuestionFloor(question) {
  const id = typeof question?.id === "string" && question.id.trim() !== "" ? question.id : "(no id)";
  if (!KINDS.has(question?.kind)) fail(`question "${id}" is not one of the derived kinds`);
  assertPremise(id, question?.premise);
  assertOptions(id, question?.options);
  assertCost(id, question?.reversal_cost);
  return question;
}

/**
 * What the matrix implies, and nothing else. Throws on a model that is not a
 * matrix (the invariants above); returns the derived questions otherwise, in
 * model order, each one already through the floor.
 *
 * Ids are the coordinates (`contrast:cart|paid`, `contrast:*|paid`,
 * `contrast:pay-button`), so two runs over the same model produce the same ids
 * and a reordered model produces the same questions — which is what makes an id
 * something a later rewind can look up.
 */
export function deriveQuestions(model) {
  const { places, states, grid } = readModel(model);
  const questions = [];
  for (const state of states) questions.push(...questionsForState(state, places, grid));
  questions.push(...sharedAffordanceQuestions(places, states, grid));
  return questions.map((question) => assertQuestionFloor(question));
}
