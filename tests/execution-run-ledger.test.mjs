import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createExecutionRun, ensureExecutionRunTable, getExecutionRun, activeExecutionRun, projectExecutionRun, recordExecutionCompletion, transitionExecutionRun, cancelExecutionRuns } from "../lib/execution-run-ledger.mjs";

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
assert.equal(transitionExecutionRun(db, run.id, "needs_input", { boundaryId: "boundary-1", boundaryQuestion: "Approve?" }).normalizedStatus, "needs_input");
assert.equal(getExecutionRun(db, run.id).boundaryId, "boundary-1");
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
  "adapter", "cardId", "completedAt", "completionEventId", "createdAt", "errorCode", "id", "nativeStatus",
  "normalizedStatus", "originThreadId", "previewDirective", "recipeId", "resumeOf", "runId", "sourceHash", "stage",
  "startedAt", "workspaceId",
].sort();
assert.deepEqual(Object.keys(detailRun).sort(), detailRunKeys, "card detail receives only the public execution-run projection");
assert.equal("sourceText" in detailRun, false, "internal ledger source stays out of card detail");
console.log("execution run ledger test ok: ownership, transitions, completion dedupe, terminal cancel, public projection");
