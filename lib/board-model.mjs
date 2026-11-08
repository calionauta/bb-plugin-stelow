/**
 * The shaping board's closed taxonomy, and the invariants that keep it closed.
 *
 * A board may say four things and nothing else:
 *
 * - `bands`     phases, in the order the work moves through them;
 * - `places`    screens, each in exactly one band, carrying the affordances
 *               available there;
 * - `edges`     labelled moves from one place to another;
 * - `questions` open questions, each attached to the place that raised it.
 *
 * The taxonomy is closed on purpose. Every shape a board grows is a shape the
 * viewer must draw and a reader must learn, and a board whose shapes differ per
 * card stops being comparable with the next card. A need outside these four
 * collections is recorded in the audit record; it is never added here on the
 * emitter's authority.
 *
 * The ENTRY PLACE is derived, never declared: it is the first place of the
 * first band, in model order. A declared `entry` field would need its own
 * "exactly one entry" rule on top of the five below, and the fact that matters
 * - a screen nobody reaches and nobody leaves is a hole in the flow - does not
 * get truer by naming the start in two places.
 *
 * Shape guards (object, array, non-empty ids, no duplicate ids) are the
 * boundary check: an emitter given a half-built object should refuse at the
 * door, not draw a diagram missing the part it could not read. The five
 * invariants are the model check: each one is a claim the board makes about the
 * product, and each refusal names the offending id, because a refusal that says
 * "invalid board" sends the author back to redraw in order to find the mistake.
 */

function fail(message) {
  throw new Error(`board model: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function listOf(model, key) {
  const value = model[key];
  if (!Array.isArray(value)) fail(`"${key}" must be an array`);
  return value;
}

function recordAt(list, index, label) {
  const entity = list[index];
  if (!isRecord(entity)) fail(`${label}[${index}] must be an object`);
  return entity;
}

function requireText(value, message) {
  if (typeof value !== "string" || value.trim() === "") fail(message);
  return value;
}

function indexUnique(entities, label) {
  const byId = new Map();
  for (const entity of entities) {
    if (byId.has(entity.id)) fail(`duplicate ${label} id "${entity.id}"`);
    byId.set(entity.id, entity);
  }
  return byId;
}

function readAffordances(place) {
  const seen = new Set();
  place.affordances.forEach((entry, index) => {
    const label = `affordances of place "${place.id}"`;
    const affordance = recordAt(place.affordances, index, label);
    const id = requireText(affordance.id, `${label}[${index}] needs a non-empty string id`);
    if (seen.has(id)) fail(`place "${place.id}" repeats affordance id "${id}"`);
    seen.add(id);
  });
}

function readBands(list) {
  return list.map((entry, index) => {
    const band = recordAt(list, index, "bands");
    requireText(band.id, `bands[${index}] needs a non-empty string id`);
    return band;
  });
}

function readPlaces(list) {
  return list.map((entry, index) => {
    const place = recordAt(list, index, "places");
    const id = requireText(place.id, `places[${index}] needs a non-empty string id`);
    requireText(place.band, `place "${id}" needs a band id`);
    if (!Array.isArray(place.affordances)) fail(`place "${id}" needs an affordances array`);
    readAffordances(place);
    return place;
  });
}

function readEdges(list) {
  return list.map((entry, index) => {
    const edge = recordAt(list, index, "edges");
    requireText(edge.from, `edges[${index}] needs a "from" place id`);
    requireText(edge.to, `edges[${index}] needs a "to" place id`);
    return edge;
  });
}

function readQuestions(list) {
  return list.map((entry, index) => {
    const question = recordAt(list, index, "questions");
    const id = requireText(question.id, `questions[${index}] needs a non-empty string id`);
    requireText(question.place, `question "${id}" needs a place id`);
    return question;
  });
}

function readBoard(model) {
  if (!isRecord(model)) fail("expected the board model object");
  const bands = readBands(listOf(model, "bands"));
  const places = readPlaces(listOf(model, "places"));
  const edges = readEdges(listOf(model, "edges"));
  const questions = readQuestions(listOf(model, "questions"));
  if (bands.length === 0) fail("no bands to draw");
  return {
    bands,
    places,
    edges,
    questions,
    bandById: indexUnique(bands, "band"),
    placeById: indexUnique(places, "place"),
  };
}

/** A place in a band the board does not draw has no phase to belong to. */
function assertPlacesBelongToBands({ places, bandById }) {
  for (const place of places) {
    if (!bandById.has(place.band)) {
      fail(`place "${place.id}" belongs to unknown band "${place.band}"`);
    }
  }
}

/** An empty phase is a stage of the work that does not exist. */
function assertBandsHavePlaces({ bands, places }) {
  const occupied = new Set(places.map((place) => place.band));
  for (const band of bands) {
    if (!occupied.has(band.id)) fail(`band "${band.id}" has no places`);
  }
}

/** An edge endpoint the board does not draw is a line to nothing. */
function assertEdgeEndpointsArePlaces({ edges, placeById }) {
  for (const edge of edges) {
    if (!placeById.has(edge.from)) fail(`edge starts at unknown place "${edge.from}"`);
    if (!placeById.has(edge.to)) fail(`edge ends at unknown place "${edge.to}"`);
  }
}

/** The entry: first place of the first band, in model order. */
function entryPlace({ bands, places }) {
  return places.find((place) => place.band === bands[0].id);
}

/** A screen nobody reaches and nobody leaves is a hole in the flow. */
function assertNoOrphanPlace({ bands, places, edges }) {
  const entry = entryPlace({ bands, places });
  const touched = new Set();
  for (const edge of edges) {
    touched.add(edge.from);
    touched.add(edge.to);
  }
  for (const place of places) {
    if (place.id === entry.id || touched.has(place.id)) continue;
    fail(`place "${place.id}" is orphaned: no edge in or out, and it is not the entry "${entry.id}"`);
  }
}

/** A question attached to nothing cannot be answered by anyone. */
function assertQuestionsArePlaced({ questions, placeById }) {
  for (const question of questions) {
    if (!placeById.has(question.place)) {
      fail(`question "${question.id}" is attached to unknown place "${question.place}"`);
    }
  }
}

export function assertBoardModel(model) {
  const board = readBoard(model);
  assertPlacesBelongToBands(board);
  assertBandsHavePlaces(board);
  assertEdgeEndpointsArePlaces(board);
  assertNoOrphanPlace(board);
  assertQuestionsArePlaced(board);
}
