import assert from "node:assert/strict";
import { nativeNeedsInput, renderInlineWorkflowScript } from "../server/bb-workflow-bridge.ts";
import { reconcileOne } from "../server/execution-reconcile-run.ts";
import { reconcileBoundary } from "../server/execution-reconcile-boundary.ts";
import { resumeAfterAnswers } from "../server/execution-lifecycle-resume.ts";
import { boundaryRunPatch } from "../server/execution-boundary.ts";
import {
  createExecutionRun,
  getExecutionRun,
  transitionExecutionRun,
} from "../lib/execution-run-ledger.mjs";
import { executionRunDb } from "./helpers/execution-run-harness.mjs";
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

// The reconciler, the boundary rule and the resume rule are separate slice
// modules, and each is a module-level function over a dependency slice — so
// each claim below is asked by CALLING the rule with a recording double and a
// real in-memory ledger, the way tests/execution-rule-seams.test.mjs drives
// them. A rename that leaves the behaviour intact can no longer fail this file.
const CARD = { id: "card-1", worker_thread_id: "thread-1", stage: "shape" };
const RUN_INPUT = {
  id: "local-1",
  cardId: "card-1",
  projectId: "project-1",
  recipeId: "interface-contrast",
  stage: "shape",
  sourceHash: "sha256:abc",
  sourceText: "return { state: 'needs_input' };",
  argsText: JSON.stringify({ context: {}, localRunId: "local-1", recipeId: "interface-contrast" }),
  adapter: "bb-workflows",
  workspaceId: "workspace-1",
  artifactRoot: "workspace-1/.stelow/run",
  originThreadId: "thread-1",
};
const BOUNDARY = { ...input.result, question: input.result.question };

// The reconciler reads boundaries from needs_input states: the run is
// dispatched to the boundary rule, never mistaken for a finish.
{
  const db = executionRunDb("card-1");
  createExecutionRun(db, { ...RUN_INPUT, runId: "run-1", now: 100 });
  const dispatched = [];
  const deps = {
    db,
    now: () => 100,
    getCard: () => CARD,
    logComment: () => {},
    publishCard: () => {},
    native: { adapterFor: () => ({ status: async () => ({ state: "needs_input" }) }) },
    dispatch: {
      reconcileBoundary: async (_run, _card, boundary) => dispatched.push(["boundary", boundary.question]),
      reconcileArtifacts: async () => dispatched.push(["artifacts"]),
    },
  };
  await reconcileOne(deps, "local-1");
  assert.deepEqual(
    dispatched.map(([kind]) => kind),
    ["boundary"],
    "a needs_input native state reaches the boundary rule and is never treated as a finish",
  );
  db.close();
}

// A boundary nobody can answer fails closed, and the code that refused it
// travels with the run so a surface can name the fix.
{
  const db = executionRunDb("card-1");
  createExecutionRun(db, { ...RUN_INPUT, runId: "run-1", now: 100 });
  const comments = [];
  const deps = {
    db,
    randomId: () => "boundary-1",
    logComment: (_cardId, _runId, body) => comments.push(body),
    notify: { sendToCard: () => {} },
    fetchPendingQuestions: async () => [],
  };
  await reconcileBoundary(deps, getExecutionRun(db, "local-1"), CARD, { question: "Missing identity" });
  const refused = getExecutionRun(db, "local-1");
  assert.equal(refused.normalizedStatus, "failed", "a malformed native boundary fails closed");
  assert.equal(refused.errorCode, "invalid-native-boundary", "and the refusal carries its code");
  assert.match(comments.at(-1), /invalid human boundary/, "the card is told which boundary was refused");
  db.close();
}

// Answering a boundary resumes a CHILD run in the parent's artifact root, and
// a contract the card has moved past refuses before anything is prepared.
{
  const db = executionRunDb("card-1");
  const parent = createExecutionRun(db, { ...RUN_INPUT, runId: "run-1", now: 100 });
  const { patch } = boundaryRunPatch(BOUNDARY, "boundary-1");
  transitionExecutionRun(db, parent.id, "needs_input", {
    boundaryId: "boundary-1",
    boundaryContract: patch.boundaryContract,
  });
  const deps = {
    db,
    bb: { sdk: { files: { mkdir: async () => {} } } },
    randomId: () => "child",
    getCard: () => CARD,
    logComment: () => {},
    publishCard: () => {},
    boundaryVersions: async () => ({ shapeVersion: "v3", scopeMapVersion: "map-queue-v1" }),
    native: { adapterFor: () => ({ resume: async () => ({ state: "running", runId: "native-child" }) }) },
    listRuns: () => [getExecutionRun(db, parent.id)],
  };
  const decisions = [{ question: "reaction [Stelow boundary boundary-1]", answers: ["keep"] }];
  assert.equal(
    await resumeAfterAnswers(deps, getExecutionRun(db, parent.id), decisions),
    null,
    "a current answer resumes the run",
  );
  const child = getExecutionRun(db, `${parent.id}-resume-child`);
  assert.equal(child?.artifactRoot, parent.artifactRoot, "the child keeps the parent's artifact root");
  assert.equal(child?.resumeOf, parent.id, "the child names the parent it resumes");
  assert.equal(
    getExecutionRun(db, parent.id).normalizedStatus,
    "cancelled",
    "the parent is cancelled as resumed-by-child",
  );

  // Negative control: a contract the card has moved past refuses, and the run
  // stays open on the question that is actually current.
  const stale = { ...deps, boundaryVersions: async () => ({ shapeVersion: "v4", scopeMapVersion: "map-queue-v1" }) };
  const refusal = await resumeAfterAnswers(stale, getExecutionRun(db, parent.id), decisions);
  assert.match(String(refusal), /no longer current/, "a stale shape version refuses resume");
  db.close();
}

console.log("execution needs-input contract test ok: durable boundary fields, schema propagation, server routing");
