import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTRAST_ARTIFACT,
  CONTRAST_FENCE,
  contrastAskDeclarations,
  contrastArtifactQuestions,
  contrastMatrixFence,
  parseContrastArtifact,
  renderContrastArtifact,
} from "../lib/contrast-artifact.mjs";

// The artifact is the producer side of the contrast feature: `contrast-model`
// derives questions from a matrix, and nothing was writing a matrix. The two
// claims this file guards are the round trip (an artifact parses back to the
// model it was rendered from) and the one-cell rule (mutating one cell in the
// FILE changes exactly one derived question). A parser that loses a cell, or a
// renderer that reorders keys into a different matrix, both break the first.

function controlMatrix() {
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

// 1. Round trip. The artifact is markdown with one fenced block; parsing it
// returns the exact model, key order included, so a worker can read the file a
// person wrote and the host reads the same matrix.
const rendered = renderContrastArtifact(controlMatrix());
assert.match(rendered, /^# Contrast matrix\n/, "the artifact opens with a heading a reader can scan");
assert.match(rendered, new RegExp("```" + CONTRAST_FENCE + "\n"), "the matrix sits in its own named fence");
assert.deepEqual(parseContrastArtifact(rendered), controlMatrix(), "the artifact parses back to the model it was rendered from");

// The fence is named, not "the first JSON block": a draft that also carries a
// ```json example must not become the matrix by accident.
const withDecoy = `# Notes\n\n\`\`\`json\n{"not": "a matrix"}\n\`\`\`\n\n${rendered}`;
assert.deepEqual(parseContrastArtifact(withDecoy), controlMatrix(), "a decoy json fence does not shadow the matrix");
assert.equal(contrastMatrixFence(withDecoy), contrastMatrixFence(rendered), "the named fence is what the parser reads");

// 2. The control asks nothing. Everything below deviates from it by one edit
// to the FILE, so a question that appears is the one that edit asked.
assert.deepEqual(contrastArtifactQuestions(rendered), [], "a complete matrix in an artifact asks nothing");

const mutateCell = (markdown, cell) => {
  const fenced = contrastMatrixFence(markdown);
  assert.ok(fenced, "the fixture has a matrix fence to mutate");
  const escaped = cell.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rewritten = fenced.replace(new RegExp(`"${escaped}": \\[[^\\]]*\\]`), `"${cell}": []`);
  assert.notEqual(rewritten, fenced, `the mutation must land on cell ${cell}, not silently miss`);
  return markdown.slice(0, markdown.indexOf(fenced)) + rewritten + markdown.slice(markdown.indexOf(fenced) + fenced.length);
};

// 3. One cell, one question, premise naming that cell.
const blanked = mutateCell(rendered, "checkout|paid");
const derived = contrastArtifactQuestions(blanked);
assert.equal(derived.length, 1, "mutating one cell in the file derives exactly one question");
assert.equal(derived[0].premise, "checkout|paid", "the derived question's premise names the cell the file blanked");
assert.equal(derived[0].id, "contrast:checkout|paid", "the id is the cell's coordinates, so a rewind can look it up");
assert.equal(derived[0].kind, "empty-cell", "a blank cell is an empty-cell question");

// Two mutations are two questions — the "exactly one" above is not a count
// that saturates at one.
const twoBlanks = mutateCell(blanked, "cart|empty");
assert.equal(contrastArtifactQuestions(twoBlanks).length, 2, "two blank cells derive two questions");

// 4. The declaration keeps what the question cannot lose: the premise and the
// reversal cost are what make the stored row checkable and invalidatable.
const declarations = contrastAskDeclarations(blanked);
assert.equal(declarations.length, 1, "one derived question becomes one declaration");
assert.equal(declarations[0].premise, "checkout|paid", "the declaration carries the premise");
assert.equal(declarations[0].reversalCost.level, "low", "the declaration carries the reversal cost level");
assert.ok(declarations[0].reversalCost.why.length > 0, "the reversal cost carries its one sentence");
assert.equal(declarations[0].question, derived[0].prompt, "the declaration asks the question the model derived");
assert.ok(declarations[0].options.length >= 2, "the declaration carries the decision's options");

// 5. A document that is not an artifact is refused by name, and a fence that is
// not JSON is distinguished from a matrix that does not hold — the worker needs
// to know which of the two they wrote.
assert.throws(
  () => parseContrastArtifact("# Contrast matrix\n\nPlaces and states, trust me.\n"),
  /contrast-matrix\.md has no ```stelow-contrast block/,
  "an artifact with no matrix fence is refused, naming the file and the fence",
);
assert.throws(
  () => parseContrastArtifact(`\`\`\`${CONTRAST_FENCE}\n{"places": [}\n\`\`\``),
  /is not JSON/,
  "a fence that is not JSON is named as a JSON problem",
);

const notAMatrix = `\`\`\`${CONTRAST_FENCE}\n${JSON.stringify({
  places: [{ id: "checkout", affordances: [] }],
  states: ["paid"],
  cells: {},
}, null, 2)}\n\`\`\``;
assert.throws(
  () => parseContrastArtifact(notAMatrix),
  /place "checkout" declares no affordance/,
  "a model that is not a matrix is refused by the model's own invariant, not by the parser",
);

// 6. Rendering a broken model is refused too: an artifact is a claim that the
// matrix is one, so writing one for an invalid model would put the mistake on
// disk where the next reader cannot see it.
const brokenModel = controlMatrix();
brokenModel.places[0].id = "cart|paid";
assert.throws(
  () => renderContrastArtifact(brokenModel),
  /contains "\\|"/,
  "rendering refuses an id the premise grammar cannot carry",
);

// The artifact's own file name is the one the state-dir registry names, from
// this module — a second spelling is how a worker writes a file nobody parses.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = readFileSync(join(root, "lib", "state-dir-files.mjs"), "utf8");
assert.ok(
  registry.includes("CONTRAST_ARTIFACT"),
  `${CONTRAST_ARTIFACT} must be named in the state-dir registry by importing its constant, not by re-spelling it`,
);

console.log("contrast artifact test ok: round trip, one-cell mutation, declarations keep the premise");
