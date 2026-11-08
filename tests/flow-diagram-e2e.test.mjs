import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { flowDiagramMermaid } from "../lib/flow-diagram.mjs";
import { parseTransitionRows } from "../lib/transition-facts.mjs";

/**
 * The chain, end to end: table -> parser -> Mermaid -> renderer.
 *
 * The other tests prove one link each: the parser counts triples, the emitter
 * counts edges, the renderer returns an SVG. None of them proves the links agree,
 * and this session has three examples of what that gap costs - a diagram that
 * never became an artifact, a markdown file that rendered as source, a gate that
 * failed in an environment nobody ran. So this test walks the chain and asserts
 * the SAME number at both ends.
 *
 * The count is 61, not 60. `annotate` is emitted as a dashed arrow (`-.->`),
 * which a naive `-->` scan misses - it did, while writing this file, and the
 * thread's report said 61 against my 60. The edge scan below counts both
 * spellings, because a count that silently excludes one verb is the same defect
 * one layer up.
 */

const TABLE = readFileSync("skills/stelow-workflow-orchestrator/references/transitions.md", "utf8");

/** Every (stage, verb, target) triple the table declares. */
function triples(rows) {
  const out = [];
  for (const [stage, row] of Object.entries(rows)) {
    for (const [verb, targets] of Object.entries(row.targets ?? {})) {
      for (const target of targets) out.push(`${stage}|${verb}|${target}`);
    }
  }
  return out;
}

/** Every edge line the Mermaid text draws, solid or dashed. */
function edgeLines(source) {
  return source.split("\n").filter((line) => line.includes("-->") || line.includes("-.->"));
}

const rows = parseTransitionRows(TABLE);
const expected = triples(rows);
assert.ok(expected.length > 50, `the table declares the edges (${expected.length})`);

const source = flowDiagramMermaid({ transitions: rows });
const drawn = edgeLines(source);
assert.equal(drawn.length, expected.length, "every declared transition is drawn once");

// The chain: the renderer accepts what the emitter produced. A diagram that
// renders is not the same as a diagram that is right, but a diagram that does
// not render is definitively wrong - and only the renderer can say so.
const pele = await import("pele");
const api = pele.default ?? pele;
let svg;
for (const attempt of [() => api.render(source), () => api.renderSync(source), () => api.render("flow", source)]) {
  try {
    const result = await attempt();
    svg = result?.svg ?? result;
    if (typeof svg === "string" && svg.includes("<svg")) break;
  } catch {
    svg = null;
  }
}
assert.ok(typeof svg === "string" && svg.includes("<svg"), "the emitter's output renders");
assert.ok(svg.length > 10_000, `the rendered diagram has substance (${svg?.length ?? 0} chars)`);

// Red proof inside the test: remove one declared transition and exactly one
// edge disappears, with the rest untouched. Proves the count is causal and not
// a coincidence of how the fixture was written.
const [stage, verb, target] = expected.find((triple) => triple.includes("|reject|"))?.split("|") ?? [];
const reduced = parseTransitionRows(TABLE.replace(new RegExp(`\\n\\s*reject:\\s*${target}\\b`), "\n"));
const reducedDrawn = edgeLines(flowDiagramMermaid({ transitions: reduced }));
assert.equal(reducedDrawn.length, drawn.length - 1, `removing ${stage}|${verb}|${target} removes exactly one edge`);
assert.ok(
  !triples(reduced).includes(`${stage}|${verb}|${target}`),
  "and the triple is the one that disappeared",
);

console.log(`flow diagram e2e ok: ${expected.length} transitions = ${drawn.length} drawn edges = ${svg.length} chars of SVG`);
