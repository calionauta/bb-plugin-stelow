import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createExecutionRun, ensureExecutionRunTable, getExecutionRun, activeExecutionRun, projectExecutionRun, recordExecutionCompletion, resumeArtifactRoot, transitionExecutionRun, cancelExecutionRuns } from "../lib/execution-run-ledger.mjs";

const db = new Database(":memory:");
db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY)");
db.prepare("INSERT INTO cards (id) VALUES (?)").run("card-1");
ensureExecutionRunTable(db);
const base = { id: "local-1", cardId: "card-1", projectId: "project-1", recipeId: "plan-critique", stage: "critique", sourceHash: "sha256:abc", sourceText: "return { state: 'succeeded' };", argsText: "{}", adapter: "bb-workflows", workspaceId: "workspace-1", artifactRoot: "workspace-1/.stelow/run", originThreadId: "thread-1" };
const run = createExecutionRun(db, { ...base, runId: "run-1", now: 100 });
assert.throws(() => createExecutionRun(db, { ...base, id: "local-duplicate", runId: "run-duplicate", now: 100 }), /already owns an active execution run/);
assert.equal(run.normalizedStatus, "queued");
assert.equal(activeExecutionRun(db, "card-1").runId, "run-1");
assert.throws(() => transitionExecutionRun(db, run.id, "succeeded"), /invalid execution transition/);
assert.equal(transitionExecutionRun(db, run.id, "running", { nativeStatus: "running", runId: "run-resumed", now: 101 }).normalizedStatus, "running");
assert.equal(getExecutionRun(db, run.id).runId, "run-resumed");
const boundaryContract = { question: "Approve?", questionId: "question-1", contractId: "contract-1", boundaryId: "boundary-1", kind: "confirmation", status: "open", shapeVersion: "v1", scopeMapVersion: "map-1", answerSchema: { type: "object" } };
assert.equal(transitionExecutionRun(db, run.id, "needs_input", { boundaryId: "boundary-1", boundaryQuestion: "Approve?", boundaryContract }).normalizedStatus, "needs_input");
assert.equal(getExecutionRun(db, run.id).boundaryId, "boundary-1");
assert.deepEqual(getExecutionRun(db, run.id).boundaryContract, boundaryContract, "needs_input persists the full boundary contract");
assert.equal(resumeArtifactRoot(run.artifactRoot), run.artifactRoot, "resume keeps completed artifacts in the original root");
assert.equal(transitionExecutionRun(db, run.id, "running").normalizedStatus, "running");
const completed = recordExecutionCompletion(db, run.id, "event-1", "succeeded", { nativeStatus: "succeeded" });
assert.equal(completed.duplicate, false);
assert.equal(completed.run.normalizedStatus, "succeeded");
assert.equal(recordExecutionCompletion(db, run.id, "event-1", "succeeded").duplicate, true);
const second = createExecutionRun(db, { ...base, id: "local-2", runId: "run-2", now: 200 });
assert.equal(cancelExecutionRuns(db, "card-1", "origin-deleted"), 1);
assert.equal(activeExecutionRun(db, "card-1"), null);
assert.equal(second.normalizedStatus, "queued");
const detailRun = projectExecutionRun(second);
const detailRunKeys = [
  "adapter", "boundaryContract", "cardId", "completedAt", "completionEventId", "createdAt", "errorCode", "id", "nativeStatus",
  "boundaryQuestion", "normalizedStatus", "originThreadId", "previewDirective", "recipeId", "resumeOf", "runId",
  "sourceHash", "stage", "startedAt", "workspaceId",
].sort();
assert.deepEqual(Object.keys(detailRun).sort(), detailRunKeys, "card detail receives only the public execution-run projection");
assert.equal("sourceText" in detailRun, false, "internal ledger source stays out of card detail");

// A needs_input run's question must reach the card. A wait the person cannot
// read is a phantom wait: the ledger used to persist the question and the
// public projection dropped it, so the surface could only say "Needs input".
// A fresh run: the one above already reached a terminal state.
const waitingRun = createExecutionRun(db, { ...base, id: "local-waiting", recipeId: "interface-contrast", stage: "interface", runId: "run-waiting", now: 100 });
transitionExecutionRun(db, waitingRun.id, "running", { nativeStatus: "running", now: 101 });
const waiting = transitionExecutionRun(db, waitingRun.id, "needs_input", {
  boundaryId: "human-stop:local-1",
  boundaryQuestion: "Should the Scope Map extend the Scope stage, or be a new concept?",
  now: 102,
});
assert.equal(waiting.normalizedStatus, "needs_input");
assert.equal(
  projectExecutionRun(waiting).boundaryQuestion,
  "Should the Scope Map extend the Scope stage, or be a new concept?",
  "the question survives the public projection so the card can show what is being asked",
);
assert.equal(
  projectExecutionRun(getExecutionRun(db, waitingRun.id)).boundaryQuestion,
  "Should the Scope Map extend the Scope stage, or be a new concept?",
  "the question is readable straight off the persisted row",
);
console.log("execution run ledger test ok: ownership, transitions, completion dedupe, terminal cancel, public projection");
