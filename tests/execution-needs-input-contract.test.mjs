import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nativeNeedsInput, renderInlineWorkflowScript } from "../server/bb-workflow-bridge.ts";
import { recipeById } from "../lib/recipe-catalog.mjs";

const input = {
  result: {
    state: "needs_input",
    question: "Which reaction should be preserved?",
    questionId: "question-1",
    contractId: "reaction-1",
    boundaryId: "boundary-1",
    kind: "reaction",
    shapeVersion: "v3",
    scopeMapVersion: "map-queue-v1",
    answerSchema: { type: "object", required: ["answer"], properties: { answer: { type: "string" } } },
  },
};

assert.deepEqual(nativeNeedsInput(input), {
  question: "Which reaction should be preserved?",
  questionId: "question-1",
  contractId: "reaction-1",
  boundaryId: "boundary-1",
  kind: "reaction",
  shapeVersion: "v3",
  scopeMapVersion: "map-queue-v1",
  answerSchema: input.result.answerSchema,
}, "native needs_input preserves the durable boundary contract");

const coordinatorRecipe = {
  id: "interface-contrast",
  tasks: [{ id: "decision", output: "decision.json", human_boundary: "coordinator" }],
};
const source = renderInlineWorkflowScript(coordinatorRecipe, { localRunId: "exec-1" });
assert.match(source, /contractId/, "rendered workflow propagates the contract ID");
assert.match(source, /boundaryId/, "rendered workflow propagates the boundary ID");
assert.match(source, /answerSchema/, "rendered workflow propagates the answer schema");
const realRecipe = recipeById("interface-contrast");
assert.equal(realRecipe.tasks[0].human_boundary, "coordinator", "real Interface Contrast recipe owns a coordinator boundary");
const realSource = renderInlineWorkflowScript(realRecipe, { localRunId: "exec-real" });
assert.match(realSource, /contractId/, "real Interface Contrast renderer propagates the contract ID");
assert.match(realSource, /boundaryId/, "real Interface Contrast renderer propagates the boundary ID");
assert.match(realSource, /answerSchema/, "real Interface Contrast renderer propagates the answer schema");

// The reconciler and the resume rule are separate slice modules now, so each
// pin names the file that owns the behavior it guards.
const reconcileSource = readFileSync(new URL("../server/execution-reconcile-run.ts", import.meta.url), "utf8");
const boundarySource = readFileSync(new URL("../server/execution-reconcile-boundary.ts", import.meta.url), "utf8");
const lifecycleSource = readFileSync(new URL("../server/execution-lifecycle-resume.ts", import.meta.url), "utf8");
assert.match(reconcileSource, /native\.state === "needs_input"/, "reconciler reads boundaries from needs_input states");
assert.doesNotMatch(
  reconcileSource,
  /state === "succeeded" && run\.normalizedStatus !== "needs_input"[\s\S]{0,80}nativeNeedsInput/,
  "reconciler does not misclassify needs_input as succeeded",
);
assert.match(boundarySource, /boundaryRunPatch/, "reconciler persists the full native boundary contract");
assert.match(boundarySource, /invalid-native-boundary/, "reconciler rejects malformed native boundaries");
assert.match(lifecycleSource, /resumeArtifactRoot\(run\.artifactRoot\)/, "native resume keeps completed outputs in the original artifact root");
assert.match(lifecycleSource, /boundaryAnswerError/, "resume validates the answered boundary before creating a child run");

console.log("execution needs-input contract test ok: durable boundary fields, schema propagation, server routing");
