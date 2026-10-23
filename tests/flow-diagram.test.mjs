import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFlowModel } from "../lib/diagram-model.mjs";
import { FLOW_DIAGRAM_KIND, flowDiagramMermaid, verbArrow } from "../lib/flow-diagram.mjs";
import { parseTransitionRows, stageExits, TRANSITION_KINDS } from "../lib/transition-facts.mjs";
import { STAGE_SEQUENCE, STAGE_TRANSITIONS } from "../lib/workflow-catalog.mjs";

/**
 * The flow diagram is DERIVED from the transition table, and this is the test
 * that says so.
 *
 * A diagram drawn beside a table drifts from it, and a picture that shows a route
 * the machine refuses is worse than no picture: a reader plans a move, the helper
 * answers with a refusal, and nothing in the picture was ever wrong enough to
 * fail a gate. So every assertion here compares the emitted Mermaid to the
 * PARSER's own reading of the table, never to a number written in this file —
 * a hardcoded 61 would pass while the table grew a row.
 *
 * The four things proven, in the order they can break:
 *
 *   1. edge count and identity == `parseTransitionRows(transitions.md)`, both
 *      directions, so an extra edge and a missing edge both fail;
 *   2. deleting one transition from a fixture copy removes exactly that edge —
 *      the red proof that the emitter reads the table instead of a constant;
 *   3. the bundled pele renders the source to a non-empty SVG, so the text shipped
 *      as the artifact of record is known to be renderable (not a nice string that
 *      happens to parse as nothing);
 *   4. no dead ends: every node has an edge inbound or outbound unless the data
 *      itself says start/terminal, judged by `stageExits` — the same predicate the
 *      offline audit uses, so the picture and the audit cannot disagree about
 *      what "terminal" means.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tablePath = join(root, "skills/stelow-workflow-orchestrator/references/transitions.md");
const table = readFileSync(tablePath, "utf8");
const rows = parseTransitionRows(table);

/** Every transition the parser sees, as `stage|verb|target`, in table order. */
function parserTriples(parsed) {
  const triples = [];
  for (const [stage, row] of Object.entries(parsed)) {
    for (const verb of TRANSITION_KINDS) {
      for (const target of row.targets[verb]) triples.push(`${stage}|${verb}|${target}`);
    }
  }
  return triples;
}

/** Every edge a Mermaid source actually carries, same vocabulary. */
function sourceEdges(source) {
  const edges = [];
  for (const line of source.split("\n")) {
    const match = line.match(/^\s+s_([a-z0-9_]+) (?:-->|-\.->)\|([a-z]+)\| s_([a-z0-9_]+)$/);
    if (match) edges.push(`${match[1]}|${match[2]}|${match[3]}`.replace(/_/g, "-"));
  }
  return edges;
}

const model = buildFlowModel({ transitions: rows });
const source = flowDiagramMermaid({ transitions: rows });
const triples = parserTriples(rows);

// --- 1. One edge per transition, asserted against the parser. ---------------
assert.equal(FLOW_DIAGRAM_KIND, "flowchart", "the emitted kind stays a flowchart");
assert.equal(source.split("\n")[0], "flowchart TD", "the first line is the kind and direction");
assert.deepEqual(
  model.edges.map((edge) => `${edge.from}|${edge.verb}|${edge.to}`),
  triples,
  "the model carries exactly the parser's transitions, none added, none reordered",
);
assert.deepEqual(sourceEdges(source), triples, "the emitted TEXT carries exactly the parser's transitions");
assert.ok(triples.length > 50, `the real table is a machine, not a sample (${triples.length} transitions)`);
assert.equal(
  sourceEdges(source).length,
  triples.length,
  `one edge per transition: ${sourceEdges(source).length} edges for ${triples.length} transitions`,
);

// The same table read the other way: the catalog projection drops `annotate`
// (not a move), and the diagram from it must be the markdown's edges minus that
// one verb — proving the emitter takes parsed facts, not this file's dialect.
const fromCatalog = buildFlowModel({ transitions: STAGE_TRANSITIONS });
assert.deepEqual(
  fromCatalog.edges.map((edge) => `${edge.from}|${edge.verb}|${edge.to}`),
  triples.filter((triple) => !triple.includes("|annotate|")),
  "the catalog projection and the vendored table draw the same flow minus annotate",
);

// --- 2. Deleting a transition removes exactly its edge (red proof). ---------
const REMOVED_ROW = "reject:    setup";
assert.equal(table.split(REMOVED_ROW).length - 1, 1, "the fixture row appears exactly once in the table");
const reducedRows = parseTransitionRows(table.replace(`${REMOVED_ROW}\n`, ""));
const reducedModel = buildFlowModel({ transitions: reducedRows });
const reducedSource = flowDiagramMermaid({ transitions: reducedRows });
const before = sourceEdges(source).length;
const after = sourceEdges(reducedSource).length;
assert.equal(after, before - 1, `deleting one transition drops exactly one edge (${before} → ${after})`);
assert.deepEqual(
  reducedModel.edges.map((edge) => `${edge.from}|${edge.verb}|${edge.to}`),
  triples.filter((triple) => triple !== "context|reject|setup"),
  "the only edge removed is the one whose row was deleted",
);
assert.doesNotMatch(reducedSource, /s_context -->\|reject\| s_setup/, "the deleted edge is gone from the text");
assert.equal(reducedModel.nodes.length, model.nodes.length, "deleting a transition keeps every stage");

// --- 3. It renders: the text is the artifact, the SVG is the proof. ---------
const pele = await import("pele");
const rendered = pele.render(source);
assert.match(String(rendered.mermaidType), /flowchart/, `pele read the source as a flowchart (${rendered.mermaidType})`);
assert.equal(typeof rendered.svg, "string", "pele returns SVG text");
assert.ok(rendered.svg.startsWith("<svg") && rendered.svg.endsWith("</svg>"), "the SVG is a whole document");
assert.ok(rendered.svg.length > 1000, `the SVG is non-empty (${rendered.svg.length} chars)`);
assert.ok(rendered.width > 0 && rendered.height > 0, "the SVG has a measured size, so pele laid it out");

// --- 4. No dead ends, by the audit's own rule. -----------------------------
const TERMINALS = ["audit"];
for (const node of model.nodes) {
  const { outward } = stageExits({ stage: node.stage, targets: rows[node.stage].targets });
  const outbound = model.edges.filter((edge) => edge.from === node.stage).length;
  const inbound = model.edges.filter((edge) => edge.to === node.stage && edge.from !== node.stage).length;
  const isTerminal = outward.length === 0;
  assert.equal(node.role === "terminal", isTerminal, `${node.stage}: the outline agrees with the audit's dead-end rule`);
  if (isTerminal) {
    assert.deepEqual([node.stage], TERMINALS, "the only stage the data calls terminal is the last one");
    assert.equal(source.includes(`{{${node.stage}}}`), true, `${node.stage} draws as a terminal shape`);
    continue;
  }
  assert.ok(outbound > 0, `${node.stage} is not a dead end: it has an outbound edge`);
  if (node.role !== "start") assert.ok(inbound > 0, `${node.stage} is entered from somewhere`);
  assert.ok(!source.includes(`{{${node.stage}}}`), `${node.stage} does not draw as terminal`);
}
assert.deepEqual(
  model.nodes.filter((node) => node.role === "start").map((node) => node.stage),
  ["triage"],
  "the entry stage is the one nothing advances into, even though reject doors point back at it",
);
assert.deepEqual(
  model.nodes.filter((node) => node.role === "terminal").map((node) => node.stage),
  TERMINALS,
  "the terminal set is the data's, not a constant in the emitter",
);

// --- The verbs the diagram shows, and how each one draws. -----------------
// `annotate` is a transition kind, not a move (`lib/workflow-catalog.mjs`), so it
// draws dashed while every move draws solid. Binding the two vocabularies here is
// what stops a future non-move verb from shipping as a solid line.
const moveVerbs = new Set(Object.keys(STAGE_TRANSITIONS[STAGE_SEQUENCE[0]]));
for (const verb of TRANSITION_KINDS) {
  assert.equal(
    verbArrow(verb) !== "-->",
    !moveVerbs.has(verb),
    `verb "${verb}" draws dashed exactly when the catalog does not call it a move`,
  );
}
assert.match(source, /s_shape -->\|rework\| s_shape/, "shape's in-place rework draws as a self-loop");
assert.match(source, /s_diff_gate -\.->\|annotate\| s_execution/, "annotate draws dashed, never as a move");

// --- Determinism and the optional title. -----------------------------------
assert.equal(flowDiagramMermaid({ transitions: rows }), source, "the same table always emits the same text");
assert.doesNotMatch(source, /^---$/m, "no front matter unless a title is asked for");
const titled = flowDiagramMermaid({ transitions: rows, title: "Stelow: the flow #1" });
assert.match(titled, /^---\ntitle: 'Stelow: the flow #1'\n---\nflowchart TD\n/, "a title rides Mermaid front matter");
assert.equal(sourceEdges(titled).length, triples.length, "a title adds no edge");
assert.equal(pele.render(titled).svg.length > 0, true, "a titled diagram renders too");

// --- Refusals: a diagram of a broken table is a lie, so it throws. ---------
for (const [input, expected] of [
  [undefined, /parsed transition rows/],
  [{}, /parsed transition rows/],
  [{ transitions: {} }, /declares no stage/],
  [{ transitions: { triage: { next: ["nope"] } } }, /does not declare/],
  [{ transitions: { triage: { present: false, targets: {} } } }, /no parseable transitions/],
  [{ transitions: { "a-b": {}, a_b: {} } }, /collide/],
  [{ transitions: { "a b": {} } }, /drawable stage id/],
]) {
  assert.throws(() => flowDiagramMermaid(input), expected, `${JSON.stringify(input)} is refused`);
}
