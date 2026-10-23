/**
 * The workflow as a graph: stage ids in, nodes and edges out.
 *
 * A diagram drawn BESIDE the transition table drifts from it, and a picture that
 * lies about the flow is worse than no picture. So this module only normalises
 * facts somebody else parsed (`parseTransitionRows` for the vendored table,
 * `STAGE_TRANSITIONS` for the catalog projection): no file reading, no markdown,
 * no Mermaid. The emitter (`flow-diagram.mjs`) owns the syntax.
 *
 * Three rules are the model's, and each refuses rather than guesses:
 *
 * - One edge per declared transition. The table declares a verb per row
 *   (`next`, `accept`, `reject`, `rework`, `annotate`), and `next`/`accept`
 *   coincide today — showing both is the table's fact, not a doubling choice, so
 *   collapsing them into one edge would hide which verbs the helper accepts.
 * - A target the table does not declare is a refusal: drawing it as a node would
 *   present a broken table as a reachable stage. Same rule as the Scope Map
 *   serializer's dangling dependency.
 * - Terminal is not this module's opinion: it is `stageExits(...).outward === 0`,
 *   the predicate the offline audit already uses, so a stage that strands a card
 *   and a stage that ends the workflow stay one answer (`lib/transition-facts.mjs`).
 *
 * `present: false` (a header with no parseable body) refuses too: drawing it as a
 * terminal would dress an unreadable row up as a destination.
 */
import { EXIT_VERBS, TRANSITION_KINDS, stageExits } from "./transition-facts.mjs";

/** The stage's node id: derived from the id, never from position, so a diff
 * between two emitted diagrams is about the flow and not about layout.
 * `int-gate` → `s_int_gate`; stage ids cannot contain `_`, so this cannot merge
 * two stages — and the collision check below makes that a fact rather than a
 * claim about the alphabet. */
export function stageNodeId(stage) {
  return `s_${String(stage).replace(/-/g, "_")}`;
}

/** One stage's verb → targets map, whichever of the two parsed shapes arrived:
 * `parseTransitionRows` wraps it as `{ stage, targets }`, the catalog projection
 * IS the map. Members are checked here, not trusted, because the emitter renders
 * them as labels. */
function targetsOf(row) {
  const targets = row?.targets ?? row;
  if (!targets || typeof targets !== "object" || Array.isArray(targets)) {
    throw new Error("flow diagram: expected parsed transition rows ({ stage: { verb: [targets] } })");
  }
  const normalised = {};
  for (const verb of TRANSITION_KINDS) {
    const value = targets[verb] ?? [];
    if (!Array.isArray(value) || value.some((target) => typeof target !== "string" || !target)) {
      throw new Error(`flow diagram: ${verb} targets must be an array of stage ids`);
    }
    normalised[verb] = value;
  }
  return normalised;
}

function readStages(transitions) {
  const stages = [];
  const ids = new Map();
  for (const [stage, row] of Object.entries(transitions)) {
    if (typeof stage !== "string" || !stage) throw new Error("flow diagram: a stage needs a name");
    if (row?.present === false) {
      throw new Error(`flow diagram: stage "${stage}" has a header and no parseable transitions`);
    }
    const id = stageNodeId(stage);
    const seen = ids.get(id);
    if (seen !== undefined && seen !== stage) {
      throw new Error(`flow diagram: stage ids collide after normalizing ("${seen}" vs "${stage}")`);
    }
    ids.set(id, stage);
    stages.push({ stage, id, targets: targetsOf(row) });
  }
  return stages;
}

function readEdges(stages) {
  const declared = new Set(stages.map(({ stage }) => stage));
  const edges = [];
  for (const { stage, targets } of stages) {
    for (const verb of TRANSITION_KINDS) {
      for (const target of targets[verb]) {
        if (!declared.has(target)) {
          throw new Error(`flow diagram: ${stage} --${verb}--> ${target} names a stage the table does not declare`);
        }
        edges.push({ from: stage, to: target, verb });
      }
    }
  }
  return edges;
}

/**
 * The whole graph: nodes in table order (so the picture reads like the table),
 * every node explicitly declared so an isolated stage still appears, and edges
 * in table order too — `TRANSITION_KINDS` order, then the row's own order.
 *
 * `role` answers the one question the picture must not leave to a reader:
 * `terminal` is the audit's dead-end predicate, `start` is the mirror of it —
 * nothing ADVANCES into the stage either, using the same exit verbs, which is why
 * `triage` is the entry despite the `reject` edges that point back at it: a door
 * back is not a door in. `internal` is everything else. A stage that is both (no
 * entry, no outward exit) is an isolated stage: the audit already reports it as
 * `no-exit`, and `terminal` wins here so the picture never implies a route out.
 */
export function buildFlowModel({ transitions } = {}) {
  if (!transitions || typeof transitions !== "object" || Array.isArray(transitions)) {
    throw new Error("flow diagram: expected parsed transition rows ({ stage: { verb: [targets] } })");
  }
  const stages = readStages(transitions);
  if (stages.length === 0) throw new Error("flow diagram: the transition table declares no stage");
  const edges = readEdges(stages);
  const terminal = new Set(stages.filter((node) => stageExits(node).outward.length === 0).map(({ stage }) => stage));
  const entering = edges.filter((edge) => edge.from !== edge.to && EXIT_VERBS.includes(edge.verb));
  const entered = new Set(entering.map((edge) => edge.to));  const nodes = stages.map(({ stage, id }) => ({
    id,
    stage,
    role: terminal.has(stage) ? "terminal" : entered.has(stage) ? "internal" : "start",
  }));
  return { nodes, edges };
}
