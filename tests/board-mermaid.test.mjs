import assert from "node:assert/strict";
import test from "node:test";
import { render } from "pele";
import { assertBoardModel } from "../lib/board-model.mjs";
import { BOARD_DIAGRAM_KIND, boardMermaid } from "../lib/board-mermaid.mjs";

/**
 * The board emitter, proved through the renderer that will draw it.
 *
 * pele 1.8.0 nests blocks in LAYOUT, not in the DOM: every block becomes a
 * sibling `<g class="pele-cluster">` with its own rect, and every leaf node is a
 * sibling in `<g class="pele-nodes">`. So "inside its block" cannot be read off
 * ancestry; it is proved geometrically, by the leaf's centre falling inside the
 * place's rect. That is also the stronger claim: it is what a reader sees.
 *
 * Percentages and node counts are asserted against the model, never against a
 * number copied from one render, so a fixture change moves the expectation with
 * it and a renderer that drops a child fails.
 */

const BOARD = {
  bands: [
    { id: "shape", label: "Shape" },
    { id: "build", label: "Build" },
  ],
  places: [
    {
      id: "welcome",
      band: "shape",
      label: "Welcome",
      affordances: [
        { id: "sign-in", label: "Sign in" },
        { id: "sign-up", label: "Sign up" },
        { id: "learn", label: "Learn more" },
      ],
    },
    {
      id: "sign-in",
      band: "shape",
      label: "Sign in",
      affordances: [
        { id: "email", label: "Email" },
        { id: "magic", label: "Magic link" },
      ],
    },
    { id: "editor", band: "build", label: "Editor", affordances: [{ id: "save", label: "Save" }] },
  ],
  edges: [
    { from: "welcome", to: "sign-in", label: "opens" },
    { from: "sign-in", to: "editor", label: "first save" },
  ],
  questions: [{ id: "poll", place: "sign-in", label: "Does the poll resume?" }],
};

/** Emitted ids follow `prefix + slug(model id)`, slug keeping [A-Za-z0-9_]. */
const PLACE_WELCOME = "place_welcome";
const QUESTION_POLL = "q_poll";

function slug(id) {
  return String(id).replace(/[^A-Za-z0-9_]/g, "_");
}

const placeBlock = (id) => `place_${slug(id)}`;
const bandBlock = (id) => `band_${slug(id)}`;

function clone(model) {
  return JSON.parse(JSON.stringify(model));
}

function rect(match) {
  return { x: Number(match[2]), y: Number(match[3]), width: Number(match[4]), height: Number(match[5]) };
}

function clusters(svg) {
  const found = new Map();
  const pattern = /class="pele-cluster" data-id="([^"]+)"><rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/g;
  for (const match of svg.matchAll(pattern)) found.set(match[1], rect(match));
  return found;
}

function nodes(svg) {
  const found = new Map();
  const pattern = /class="pele-node([^"]*)" data-id="([^"]+)" transform="translate\(([-\d.]+),([-\d.]+)\)"/g;
  for (const match of svg.matchAll(pattern)) {
    const classes = match[1].trim().split(/\s+/).filter(Boolean);
    found.set(match[2], { x: Number(match[3]), y: Number(match[4]), width: 0, height: 0, classes });
  }
  return found;
}

function within(inner, outer) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Leaf nodes drawn inside one place's block, whatever their class. */
function children(placeId, svg) {
  const block = clusters(svg).get(placeId);
  assert.ok(block, `the render draws a block for ${placeId}`);
  return [...nodes(svg).values()].filter((node) => within(node, block));
}

function affordancesOf(placeId, svg) {
  return children(placeId, svg).filter((node) => !node.classes.includes("question"));
}

/** SVG text with one round of entity decoding, i.e. what a browser shows. */
function decodedText(svg) {
  return [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>|<text[^>]*>([^<]*)<\/text>/g)]
    .map((match) => match[1] ?? match[2])
    .join(" ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

test("the emitted board renders one block per place", () => {
  const source = boardMermaid(BOARD);
  assert.equal(BOARD_DIAGRAM_KIND, "block-beta", "the diagram kind is the block family");
  assert.ok(source.startsWith("block-beta\n"), "the source opens with its kind");

  const svg = render(source).svg;
  const drawn = [...clusters(svg).keys()];
  assert.equal(drawn.filter((id) => id.startsWith("place_")).length, BOARD.places.length);
  assert.equal(drawn.filter((id) => id.startsWith("band_")).length, BOARD.bands.length);
  assert.ok(drawn.includes(PLACE_WELCOME), "the place ids reach the SVG");

  const leaves = nodes(svg);
  const expectedLeaves =
    BOARD.places.reduce((total, place) => total + place.affordances.length, 0) + BOARD.questions.length;
  assert.equal(leaves.size, expectedLeaves, "one leaf per affordance and per question");

  const edges = [...svg.matchAll(/<g class="pele-edge"/g)].length;
  assert.equal(edges, BOARD.edges.length, "one edge per model edge");
  const edgeLabels = [...svg.matchAll(/<g class="pele-edge-label"/g)].length;
  assert.equal(edgeLabels, BOARD.edges.filter((edge) => edge.label).length, "a label per labelled edge");

  const drawnEdges = [...svg.matchAll(/<g class="pele-edge" data-id="([^"]+)"/g)].map((match) => match[1]);
  for (const edge of BOARD.edges) {
    const expected = `${placeBlock(edge.from)}-${placeBlock(edge.to)}`;
    assert.ok(drawnEdges.some((id) => id.endsWith(expected)), `${edge.from} -> ${edge.to} keeps its direction`);
  }
});

test("an affordance is drawn inside its place's block, one child each", () => {
  const full = render(boardMermaid(BOARD)).svg;
  const blocks = clusters(full);
  for (const place of BOARD.places) {
    const block = blocks.get(placeBlock(place.id));
    const band = blocks.get(bandBlock(place.band));
    assert.ok(block && band, `${place.id} is drawn as a block in its band`);
    assert.ok(within(block, band), `${place.id} sits inside band ${place.band}`);
  }
  assert.equal(affordancesOf(PLACE_WELCOME, full).length, BOARD.places[0].affordances.length);

  const reduced = clone(BOARD);
  reduced.places[0].affordances = reduced.places[0].affordances.slice(0, 2);
  const fewer = render(boardMermaid(reduced)).svg;
  assert.equal(affordancesOf(PLACE_WELCOME, fewer).length, reduced.places[0].affordances.length);
  assert.equal(nodes(fewer).size, nodes(full).size - 1, "removing one affordance removes exactly one node");
});

test("open questions are drawn as their own class, one per model question", () => {
  const source = boardMermaid(BOARD);
  assert.match(source, /classDef question stroke-dasharray:5 5/, "the questions carry a named class");
  const svg = render(source).svg;
  const drawn = [...nodes(svg).entries()];
  const asked = drawn.filter(([, node]) => node.classes.includes("question"));
  assert.equal(asked.length, BOARD.questions.length, "one classed node per open question");
  assert.ok(drawn.some(([, node]) => !node.classes.includes("question")), "and it differs from the rest");

  const questionMarkup = svg.slice(svg.indexOf(`data-id="${QUESTION_POLL}"`), svg.indexOf(`data-id="${QUESTION_POLL}"`) + 400);
  assert.match(questionMarkup, /stroke-dasharray:5 5/, "the class reaches the drawn rect");
});

test("a question is drawn inside the place that raised it", () => {
  const model = clone(BOARD);
  model.questions.push({ id: "resume", place: "editor", label: "Does resume survive?" });
  const svg = render(boardMermaid(model)).svg;
  for (const place of model.places) {
    const expected = model.questions.filter((question) => question.place === place.id).length;
    const asked = children(placeBlock(place.id), svg).filter((node) => node.classes.includes("question"));
    assert.equal(asked.length, expected, `${place.id} draws its own questions and no others`);
  }
});

test("the same model emits the same text twice, in model order", () => {
  const once = boardMermaid(BOARD);
  assert.equal(boardMermaid(clone(BOARD)), once);
  assert.equal(boardMermaid(BOARD), once);
  const positions = BOARD.places.map((place) => once.indexOf(`block:${placeBlock(place.id)}`));
  assert.ok(positions.every((index) => index >= 0), "every place block is emitted");
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right), "blocks follow model order");
});

test("the entry is the first place of the first band, not the first place listed", () => {
  assert.doesNotThrow(() => assertBoardModel(BOARD), "the entry is reached by nothing and that is legal");
  const single = { bands: [{ id: "only" }], places: [{ id: "p", band: "only", affordances: [] }], edges: [], questions: [] };
  assert.doesNotThrow(() => assertBoardModel(single), "a one-place board can have no edges at all");
  const listedFirst = {
    bands: [{ id: "first" }, { id: "second" }],
    places: [
      { id: "later", band: "second", affordances: [] },
      { id: "start", band: "first", affordances: [] },
    ],
    edges: [],
    questions: [],
  };
  assert.throws(
    () => assertBoardModel(listedFirst),
    /later/,
    "a place listed first but sitting in another band is not the entry",
  );
  const displaced = {
    bands: [{ id: "first" }, { id: "second" }],
    places: [
      { id: "later", band: "second", affordances: [] },
      { id: "start", band: "first", affordances: [] },
      { id: "last", band: "second", affordances: [] },
    ],
    edges: [{ from: "last", to: "later" }],
    questions: [],
  };
  assert.doesNotThrow(
    () => assertBoardModel(displaced),
    "the entry is neither the first nor the last place listed; it is the first place of the first band",
  );
});

test("a place with no affordances still draws its block, with no filler node", () => {
  const empty = {
    bands: [{ id: "only", label: "Only" }],
    places: [{ id: "blank", band: "only", label: "Blank", affordances: [] }],
    edges: [],
    questions: [],
  };
  const svg = render(boardMermaid(empty)).svg;
  assert.ok(clusters(svg).get("place_blank"), "the empty place keeps its block");
  assert.equal(nodes(svg).size, 0, "and the emitter invents no filler to fill it");
});

test("two model ids that slug together are refused, not merged", () => {
  const twins = {
    bands: [{ id: "b" }],
    places: [
      { id: "a-b", band: "b", affordances: [] },
      { id: "a.b", band: "b", affordances: [] },
    ],
    edges: [{ from: "a-b", to: "a.b" }],
    questions: [],
  };
  assert.doesNotThrow(() => assertBoardModel(twins), "both ids are legitimate strings");
  assert.throws(() => boardMermaid(twins), /collide/, "one drawn box for two places would hide the loss");
});

test("a label that looks like Mermaid syntax renders as the author wrote it", () => {
  const tricky = clone(BOARD);
  tricky.places[0].label = "R&D &amp; <x>";
  tricky.edges[0].label = 'A "q" <y>';
  const text = decodedText(render(boardMermaid(tricky)).svg);
  assert.ok(text.includes(tricky.places[0].label), "the place label survives untouched");
  assert.ok(text.includes(tricky.edges[0].label), "and so does the edge label");
});

const REFUSALS = [
  ["an edge endpoint that is not a place", (model) => model.edges.push({ from: "welcome", to: "ghost" }), /ghost/],
  ["a place in a band that does not exist", (model) => { model.places[0].band = "phase-9"; }, /phase-9/],
  ["a band with no places", (model) => model.bands.push({ id: "measure", label: "Measure" }), /measure/],
  ["a place with no edge in or out", (model) => model.places.push({ id: "limbo", band: "build", affordances: [] }), /limbo/],
  ["a question on a place that does not exist", (model) => model.questions.push({ id: "poll-2", place: "nowhere" }), /nowhere/],
];

for (const [name, breakBoard, offending] of REFUSALS) {
  test(`refuses ${name}, naming the id`, () => {
    const model = clone(BOARD);
    breakBoard(model);
    assert.throws(() => assertBoardModel(model), offending, "the refusal names the offending id");
    assert.throws(() => boardMermaid(model), offending, "and a broken model never becomes a picture");
  });
}

console.log("board mermaid ok: renders, nests, refuses, and repeats");
