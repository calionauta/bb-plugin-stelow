import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TRACKABLE_STATUSES,
  isDoneStatus,
  isSkippedStatus,
  isActiveStatus,
  isKnownStatus,
  cleanTrackableId,
  canTransition,
  buildCondition,
  hasCondition,
} from "../lib/trackables.mjs";
import { TRACKABLE_CONTRACTS, contractForTrackable } from "../lib/trackable-contracts.mjs";

// One vocabulary for every finished check: done and completed are terminal
// aliases, everything else is unfinished business.
assert.equal(isDoneStatus("done"), true, "done reads done");
assert.equal(isDoneStatus("completed"), true, "completed reads done");
assert.equal(isDoneStatus("pending"), false, "not-started is not done");
assert.equal(isDoneStatus("in-progress"), false, "running is not done");
assert.equal(isDoneStatus("blocked"), false, "blocked is not done");
assert.equal(isDoneStatus("failed"), false, "failed is not done");
assert.equal(isDoneStatus("escalated"), false, "escalated is not done");
assert.equal(isDoneStatus("skipped"), false, "skipped is set aside, not done");
assert.equal(isDoneStatus("bogus"), false, "junk is never done");
assert.equal(isSkippedStatus("skipped"), true, "skipped reads skipped");
assert.equal(isSkippedStatus("done"), false, "done is not skipped");
assert.equal(isActiveStatus("in-progress"), true, "in-progress reads active");
assert.equal(isActiveStatus("pending"), false, "pending is not active");
assert.ok(TRACKABLE_STATUSES.includes("escalated") && isKnownStatus("failed"), "the vocabulary covers the workflow's states");
assert.equal(isKnownStatus("bogus"), false, "junk is unknown");

// One identity shape for every module: dotted upstream task ids pass,
// traversal and junk refuse — callers never re-implement the regex.
assert.equal(cleanTrackableId("scope-1"), "scope-1", "scope ids pass");
assert.equal(cleanTrackableId("3.1"), "3.1", "dotted upstream task ids pass");
assert.equal(cleanTrackableId("  scope-2  "), "scope-2", "ids trim");
assert.equal(cleanTrackableId("../../evil"), null, "traversal refuses");
assert.equal(cleanTrackableId(""), null, "blank refuses");
assert.equal(cleanTrackableId(null), null, "junk refuses");

// Transitions: loops may resume, history never regresses. A finished
// trackable never exits done — corrections open a new trackable.
assert.equal(canTransition("pending", "in-progress"), true, "work starts");
assert.equal(canTransition("in-progress", "blocked"), true, "work blocks");
assert.equal(canTransition("blocked", "in-progress"), true, "blocked work resumes");
assert.equal(canTransition("failed", "in-progress"), true, "failed work retries");
assert.equal(canTransition("escalated", "done"), true, "escalated work can still finish");
assert.equal(canTransition("skipped", "in-progress"), true, "set-aside work reopens");
assert.equal(canTransition("in-progress", "in-progress"), true, "same-state writes are no-ops");
assert.equal(canTransition("done", "in-progress"), false, "done never regresses");
assert.equal(canTransition("completed", "pending"), false, "completed never regresses");
assert.equal(canTransition("done", "done"), true, "done restates done");
assert.equal(canTransition("bogus", "done"), false, "junk never transitions");
assert.equal(canTransition("pending", "bogus"), false, "junk is never a target");

// Conditions assert by presence: an unknown card carries none, never an
// invented headline.
const condition = buildCondition({ type: "TrackingSilent", reason: "NoScopes", message: "quiet" });
assert.equal(condition.type, "TrackingSilent", "conditions name their type");
assert.equal(typeof condition.observedAt, "string", "conditions stamp observation time");
assert.equal(buildCondition({ type: "X", observedAt: "2026-01-01T00:00:00.000Z" }).observedAt, "2026-01-01T00:00:00.000Z", "explicit observation time survives");
assert.equal(buildCondition({}), null, "typeless conditions refuse");
assert.equal(buildCondition(null), null, "junk refuses");
assert.equal(hasCondition([condition], "TrackingSilent"), true, "presence asserts");
assert.equal(hasCondition([], "TrackingSilent"), false, "absence asserts nothing");
assert.equal(hasCondition(null, "TrackingSilent"), false, "junk asserts nothing");

// Every tracked kind has one evidence row: who writes, what done requires.
assert.ok(TRACKABLE_CONTRACTS.length >= 8, "the registry covers the workflow's kinds");
for (const contract of TRACKABLE_CONTRACTS) {
  assert.ok(typeof contract.kind === "string" && contract.kind, "every row names its kind");
  assert.ok(["host", "worker-propose/host-commit", "worker"].includes(contract.writer), "every row names its writer");
  assert.ok(Array.isArray(contract.doneWhen) && contract.doneWhen.length > 0, "every row names its done evidence");
  assert.ok(Array.isArray(contract.artifacts) && contract.artifacts.length > 0, "every row names its uniform file layout");
  assert.ok(contract.contractFile === null || typeof contract.contractFile === "string", "every row declares its sidecar file or none");
}
assert.equal(contractForTrackable("scope").writer, "worker-propose/host-commit", "scopes propose, the host commits");
assert.equal(contractForTrackable("stage").writer, "host", "stages are host-owned");
assert.equal(contractForTrackable("bogus"), null, "unmigrated kinds resolve null, never a guess");
assert.equal(contractForTrackable(null), null, "junk resolves null");

// Rewiring pins: no finished-check may keep its own copy of the
// vocabulary — server, panel, and lib all read the central machine.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = [
  readFileSync(join(root, "server/plugin-runtime.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/wiring/gate-surfaces.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/wiring/execution-surfaces.ts"), "utf8"),
].join("\n");
assert.doesNotMatch(server, /\["done", "completed"\]\.includes/, "server finished-checks read the machine");
assert.match(server, /isDoneStatus\(/, "server consults the machine");
const app = readFileSync(join(root, "app.tsx"), "utf8");
assert.doesNotMatch(app, /\["done", "completed"\]\.includes/, "panel finished-checks read the machine");
assert.doesNotMatch(app, /status === "done" \|\| status === "completed"/, "panel finished-lambdas read the machine");
for (const file of ["lib/card-checks.mjs", "lib/doing-now.mjs", "lib/completion.mjs"]) {
  const body = readFileSync(join(root, file), "utf8");
  assert.doesNotMatch(body, /\["done", "completed"\]\.includes/, `${file} reads the machine`);
  assert.doesNotMatch(body, /status === "done" \|\| status === "completed"/, `${file} keeps no local alias`);
}

console.log("trackables test ok: vocabulary, transitions, conditions, contracts, rewiring");
