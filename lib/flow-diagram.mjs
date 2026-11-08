/**
 * The workflow flow diagram, emitted from the transition table.
 *
 * The Mermaid TEXT is the artifact of record and the rendered SVG is a cache:
 * text is versionable, diffable, portable, and re-renderable by any future pele,
 * while an SVG is a picture of whatever happened to be installed. `pele` renders
 * it (exact pin in `lib/diagram-strategy.mjs`) but validates nothing about the
 * flow — the table does that, through `buildFlowModel`.
 *
 * Nothing here is written freehand and nothing is styled beyond reading:
 *
 * - an edge per declared transition, labelled with its verb;
 * - start and terminal stages drawn with different SHAPES (stadium, hexagon), so
 *   the distinction survives theming — no colour, no theme, no classDef, because
 *   the shape already says it;
 * - one verb draws dashed: `annotate` names the stage a reader may annotate, not
 *   a stage a card moves to (`lib/workflow-catalog.mjs` keeps it out of MOVE
 *   verbs), so a solid line would claim a route that does not exist. Shape of
 *   line, not colour.
 *
 * One transition, one edge — including `next` and `accept` when they name the
 * same stage, because the table declares both and the helper accepts both.
 * Collapsing them would hide which verbs a card can actually travel under.
 */
import { buildFlowModel } from "./diagram-model.mjs";

export const FLOW_DIAGRAM_KIND = "flowchart";

export const FLOW_DIAGRAM_DIRECTION = "TD";

/** How a verb is drawn. Only non-move verbs are listed: everything in
 * `TRANSITION_KINDS` that is not here is a move and draws solid. The parity test
 * binds this map to the catalog's move verbs, so a new non-move verb cannot ship
 * as a solid line. */
const DASHED_VERBS = Object.freeze({ annotate: "-.->" });

/** The Mermaid link for one verb, arrow included. */
export function verbArrow(verb) {
  return DASHED_VERBS[verb] ?? "-->";
}

/** A stage id drawn unescaped. The table's ids are lowercase words, so anything
 * else is a caller passing the wrong data: refuse instead of escaping a label
 * that would render as a stage nobody can advance to. */
function nodeLabel(stage) {
  if (!/^[A-Za-z0-9-]+$/.test(stage)) {
    throw new Error(`flow diagram: "${stage}" is not a drawable stage id`);
  }
  return stage;
}

/** One node's shape: the role is in the OUTLINE, never in a colour, so a
 * terminal stage still reads as terminal under any theme. */
const SHAPES = Object.freeze({
  start: (text) => `([${text}])`,
  terminal: (text) => `{{${text}}}`,
  internal: (text) => `[${text}]`,
});

/** Mermaid front-matter, when a title is asked for. Single-quoted so a title may
 * carry `:`, `#` or `'` without becoming a YAML error; newlines are collapsed
 * because front-matter is one line. */
function titleBlock(title) {
  if (title === undefined || title === null) return [];
  const text = String(title).replace(/\s+/g, " ").trim();
  if (!text) return [];
  return ["---", `title: '${text.replace(/'/g, "''")}'`, "---"];
}

/**
 * The whole diagram source: `{ transitions, title? }` in, Mermaid text out.
 *
 * `transitions` is parsed facts — `parseTransitionRows(tableText)` or the catalog
 * projection `STAGE_TRANSITIONS` — never the raw markdown: the emitter does not
 * re-parse, so the diagram and the advance path cannot read the table differently.
 */
export function flowDiagramMermaid({ transitions, title } = {}) {
  const model = buildFlowModel({ transitions });
  const nodeId = new Map(model.nodes.map((node) => [node.stage, node.id]));
  const lines = [...titleBlock(title), `${FLOW_DIAGRAM_KIND} ${FLOW_DIAGRAM_DIRECTION}`];
  for (const node of model.nodes) {
    lines.push(`  ${node.id}${SHAPES[node.role](nodeLabel(node.stage))}`);
  }
  for (const edge of model.edges) {
    lines.push(`  ${nodeId.get(edge.from)} ${verbArrow(edge.verb)}|${edge.verb}| ${nodeId.get(edge.to)}`);
  }
  return `${lines.join("\n")}\n`;
}
