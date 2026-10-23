/**
 * The shaping board as Mermaid `block-beta` source.
 *
 * The source of truth is the model (`board-model.mjs`), never this string: an
 * author writes bands, places, affordances, edges and open questions, and this
 * module derives the diagram. The same model always yields byte-identical text,
 * so a diff in the picture is a diff in the board and never in map ordering.
 *
 * Shape: band = block, place = nested block, affordance = leaf node, and an
 * open question = a leaf node inside its place marked by the `question`
 * classDef. Nesting a block inside a block is what gives a place a drawn
 * interior; pele 1.8.0 renders each block as its own cluster rect, so a place
 * sits inside its band geometrically (see docs/audits/2026-10-23-p2-board-record.md).
 *
 * Three syntax decisions were settled against the bundled renderer, not against
 * the Mermaid docs, and each one is a trap worth naming:
 *
 * - A block id must be `[A-Za-z0-9_]`. `block:band-shape` is a lexical error;
 *   `band_shape` renders. Model ids are therefore slugged, and two ids that
 *   slug to the same emitted id are refused rather than merged into one node.
 * - A labelled edge must be written `-- "label" -->`. The `-->|"label"|` pipe
 *   form parses and then silently drops the label, which is a picture that
 *   looks complete and is not.
 * - A class is applied with a `class <ids> <name>` statement. The inline
 *   `node["x"]:::name` shorthand is a lexical error in this parser.
 */
import { assertBoardModel } from "./board-model.mjs";

export const BOARD_DIAGRAM_KIND = "block-beta";

/** A place is a card, not a stripe: at most three children per row. */
const PLACE_COLUMNS = 3;

const INDENT = "  ";

function line(depth, text) {
  return `${INDENT.repeat(depth)}${text}`;
}

function slug(raw) {
  const cleaned = String(raw).replace(/[^A-Za-z0-9_]/g, "_");
  return cleaned || "id";
}

/**
 * One emitted id per model entity, prefixed by kind so a band, a place and an
 * affordance may share a model id without sharing a node. Two entities that
 * collide after slugging are a refusal: merging them would draw one box for two
 * decisions, and the picture would be the only place the loss was invisible.
 */
function emitted(prefix, parts, source, seen) {
  const id = `${prefix}${parts.map(slug).join("_")}`;
  const owner = seen.get(id);
  if (owner !== undefined && owner !== source) {
    throw new Error(`board diagram: ids collide after sanitizing ("${owner}" vs "${source}")`);
  }
  seen.set(id, source);
  return id;
}

function bandId(modelId, seen) {
  return emitted("band_", [modelId], `band "${modelId}"`, seen);
}

function placeId(modelId, seen) {
  return emitted("place_", [modelId], `place "${modelId}"`, seen);
}

function affordanceId(place, affordance, seen) {
  const source = `affordance "${affordance.id}" of place "${place.id}"`;
  return emitted("aff_", [place.id, affordance.id], source, seen);
}

function questionId(modelId, seen) {
  return emitted("q_", [modelId], `question "${modelId}"`, seen);
}

/**
 * Label text as an SVG label: entity-escape what the Mermaid parser would read
 * as syntax (`"` closes the label, `<` opens markup, `&` starts an entity), and
 * flatten newlines because a Mermaid label is one line. Backslashes are left
 * alone: this renderer passes them through, and escaping them doubles them.
 */
function label(text, fallback) {
  const raw = typeof text === "string" && text.trim() ? text.trim() : String(fallback);
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\r\n]+/g, " ");
}

function childNodes(place, questions, seen) {
  const affordances = place.affordances.map((affordance) => {
    const id = affordanceId(place, affordance, seen);
    return `${id}["${label(affordance.label, affordance.id)}"]`;
  });
  const asks = questions.map((question) => {
    const id = questionId(question.id, seen);
    return `${id}["${label(question.label, question.id)}"]`;
  });
  return [...affordances, ...asks];
}

function placeLines(place, questions, seen) {
  const id = placeId(place.id, seen);
  const children = childNodes(place, questions, seen);
  const columns = Math.max(1, Math.min(children.length, PLACE_COLUMNS));
  return [
    line(2, `block:${id}["${label(place.label, place.id)}"]:1`),
    line(3, `columns ${columns}`),
    ...children.map((child) => line(3, child)),
    line(2, "end"),
  ];
}

function bandLines(band, places, questionsByPlace, seen) {
  const id = bandId(band.id, seen);
  const lines = [
    line(1, `block:${id}["${label(band.label, band.id)}"]:1`),
    line(2, "columns 1"),
  ];
  for (const place of places) {
    lines.push(...placeLines(place, questionsByPlace.get(place.id) ?? [], seen));
  }
  lines.push(line(1, "end"));
  return lines;
}

function edgeLine(edge, seen) {
  const from = placeId(edge.from, seen);
  const to = placeId(edge.to, seen);
  const text = typeof edge.label === "string" && edge.label.trim() ? edge.label : null;
  const arrow = text === null ? "-->" : `-- "${label(text)}" -->`;
  return line(1, `${from} ${arrow} ${to}`);
}

function questionClassLines(questions, seen) {
  const ids = questions.map((question) => questionId(question.id, seen));
  return [
    line(1, "classDef question stroke-dasharray:5 5"),
    line(1, `class ${ids.join(",")} question`),
  ];
}

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const bucket = groups.get(item[key]);
    if (bucket) bucket.push(item);
    else groups.set(item[key], [item]);
  }
  return groups;
}

/**
 * The board as `block-beta` source. Bands share the top row, places stack
 * inside their band, and edges sit at the top level because they connect
 * clusters rather than nodes.
 */
export function boardMermaid(model) {
  assertBoardModel(model);
  const seen = new Map();
  const placesByBand = groupBy(model.places, "band");
  const questionsByPlace = groupBy(model.questions, "place");
  const lines = [BOARD_DIAGRAM_KIND, line(1, `columns ${model.bands.length}`)];
  for (const band of model.bands) {
    lines.push(...bandLines(band, placesByBand.get(band.id) ?? [], questionsByPlace, seen));
  }
  for (const edge of model.edges) {
    lines.push(edgeLine(edge, seen));
  }
  if (model.questions.length > 0) {
    lines.push(...questionClassLines(model.questions, seen));
  }
  return `${lines.join("\n")}\n`;
}
