import assert from "node:assert/strict";
import { workerActionPolicy } from "../lib/worker-action-policy.mjs";

assert.deepEqual(
  workerActionPolicy({ status: "in-progress", activity: "running" }),
  { archived: false, showPresetControls: true, showRestartFresh: false, showStopAndArchive: true, showDelete: false },
  "a healthy worker has no recovery action",
);
assert.equal(workerActionPolicy({ status: "in-progress", activity: "error" }).showRestartFresh, true, "worker error can recover");
assert.equal(workerActionPolicy({ status: "in-progress", activity: "idle" }, true).showRestartFresh, true, "attention-needed idle worker can recover");
assert.equal(workerActionPolicy({ status: "completed", activity: "idle" }).showRestartFresh, false, "completed card is not a recovery case");
assert.deepEqual(
  workerActionPolicy({ status: "archived", activity: "error" }, true),
  { archived: true, showPresetControls: false, showRestartFresh: false, showStopAndArchive: false, showDelete: true },
  "archived cards are terminal",
);

console.log("worker action policy test ok: lifecycle actions stay coherent");
