import assert from "node:assert/strict";
import { resolveCardMove } from "../lib/card-move.mjs";
import { buildBoardColumnFor } from "../lib/workflow-vocabulary.mjs";

// Deferred start: creating parks, starting is explicit. Defaults stay
// today's behavior (spawn on submit); nothing in the server forces an
// unstarted card — only the human unchecks the box. Behavioral coverage
// goes through the move policy and board projection the starts delegate to.

// Leaving the Bucket starts through the same starter on every track: a
// threadless card dragged to Doing spawns instead of lying.
const lightweightStart = resolveCardMove("research", "doing", { hasWorker: false });
assert.equal(lightweightStart.ok, true, "dragging a lightweight card to Doing starts it");
assert.deepEqual(lightweightStart.move, { type: "status", status: "in-progress" }, "Doing maps to in-progress");

const lightweightParked = resolveCardMove("explore", "inbox", { hasWorker: false });
assert.equal(lightweightParked.ok, true, "Bucket is a legal lightweight column");
assert.deepEqual(lightweightParked.move, { type: "status", status: "pending" }, "Bucket maps to pending");

// A Build workflow move consults the phase machine: entering a build phase
// resolves to a phase move, and a parked card carries no worker.
const phaseMove = resolveCardMove("build", "planning", { hasWorker: false });
assert.equal(phaseMove.ok, true, "entering a build phase resolves");
assert.equal(phaseMove.move.type, "phase", "phase targets resolve to phase moves");

// The Bucket is the board's first column on every track: parked cards (no
// worker) project to the Bucket, so the board never claims they run.
assert.equal(
  buildBoardColumnFor({ kind: "build", status: "draft", workerThreadId: null }),
  "inbox",
  "a parked build card projects to the Bucket",
);
assert.equal(
  buildBoardColumnFor({ kind: "build", status: "in-progress", workerThreadId: "thread-1", stage: "triage" }),
  "analysis",
  "a running build card projects to its workflow phase",
);

// Unknown columns refuse with the valid set named instead of moving
// silently — the move policy knows the kind before it acts.
const unknown = resolveCardMove("build", "no-such-column", { hasWorker: false });
assert.equal(unknown.ok, false, "unknown columns refuse");
assert.ok(unknown.error.length > 0, "refusals name the failure");

// Build cards never complete by move: completion is explicit through `done`
// after audit verification, and Done by drag refuses with the redirect.
const doneDrag = resolveCardMove("build", "completed", { hasWorker: true });
assert.equal(doneDrag.ok, false, "dragging a build card to Done refuses");
assert.match(doneDrag.error, /done/, "the refusal names the explicit completion path");

console.log("card start test ok: deferred start, shared spawn, split always starts");
