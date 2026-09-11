import assert from "node:assert/strict";
import { isArchivedCard, workerActionPolicy, workerSectionPolicy } from "../lib/worker-action-policy.mjs";

assert.deepEqual(
  workerActionPolicy({ status: "in-progress", activity: "running" }),
  { archived: false, hasActiveWorker: true, showPresetControls: true, showRestartFresh: false, showArchive: true, showDelete: false },
  "a healthy worker has no recovery action",
);
assert.equal(workerActionPolicy({ status: "in-progress", activity: "error" }).showRestartFresh, true, "worker error can recover");
assert.equal(workerActionPolicy({ status: "in-progress", activity: "idle" }, true).showRestartFresh, true, "attention-needed idle worker can recover");
assert.equal(workerActionPolicy({ status: "completed", activity: "idle" }).showRestartFresh, false, "completed card is not a recovery case");
assert.equal(isArchivedCard({ status: "archived" }), true, "archived status is terminal");
assert.equal(isArchivedCard({ status: "completed" }), false, "completed is not archived");
assert.deepEqual(
  workerActionPolicy({ status: "archived", activity: "error" }, true),
  { archived: true, hasActiveWorker: false, showPresetControls: false, showRestartFresh: false, showArchive: false, showDelete: true },
  "archived cards are terminal",
);
assert.equal(workerSectionPolicy({ status: "archived", activity: "idle" }, false, { historyCount: 0 }).showSection, false, "an archived card with no worker context omits the Worker section");
assert.equal(workerSectionPolicy({ status: "archived", activity: "idle" }, false, { historyCount: 1 }).showSection, true, "worker history keeps the archived Worker section useful");
assert.equal(workerSectionPolicy({ status: "archived", activity: "idle" }, false, { hasGithubLink: true }).showSection, true, "a GitHub link keeps the archived Worker section useful");
assert.equal(workerSectionPolicy({ status: "in-progress", activity: "idle" }).showSection, true, "live cards retain their preset controls");

console.log("worker action policy test ok: lifecycle actions and Worker visibility stay coherent");
