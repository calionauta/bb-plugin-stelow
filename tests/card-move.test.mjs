import assert from "node:assert/strict";
import { resolveCardMove } from "../lib/card-move.mjs";

// Lightweight tracks (research + explore): columns map to statuses, build
// phases refuse.
for (const kind of ["research", "explore"]) {
  assert.deepEqual(resolveCardMove(kind, "inbox"), { ok: true, move: { type: "status", status: "pending" } }, `${kind}: inbox -> pending`);
  assert.deepEqual(resolveCardMove(kind, "doing"), { ok: true, move: { type: "status", status: "in-progress" } }, `${kind}: doing -> in-progress`);
  assert.deepEqual(resolveCardMove(kind, "done"), { ok: true, move: { type: "status", status: "completed" } }, `${kind}: done -> completed`);
  assert.deepEqual(resolveCardMove(kind, "archived"), { ok: true, move: { type: "status", status: "archived" } }, `${kind}: archived passes through`);
  for (const phase of ["analysis", "planning", "execution", "review", "completed"]) {
    const refused = resolveCardMove(kind, phase);
    assert.equal(refused.ok, false, `${kind} refuses ${phase}`);
    assert.match(refused.error, /Bucket, Doing, Done/, `${kind} refusal names the exit (${phase})`);
  }
}

// Build track: phases enter, Archive is terminal, and Done is committed only
// through the verified `bb stelow done` path rather than a board move.
assert.deepEqual(resolveCardMove("build", "analysis"), { ok: true, move: { type: "phase", phase: "analysis" } }, "phase entry");
assert.match(resolveCardMove("build", "completed").error, /bb stelow done/, "Done cannot bypass explicit completion verification");
assert.deepEqual(resolveCardMove("build", "archived"), { ok: true, move: { type: "status", status: "archived" } }, "Archive remains a terminal move");
// Bucket: a parked build card can move back to it, but a card with a live
// worker cannot — parking it would orphan the worker.
assert.deepEqual(resolveCardMove("build", "inbox"), { ok: true, move: { type: "status", status: "draft" } }, "build enters the Bucket only when unstarted");
assert.deepEqual(resolveCardMove("build", "inbox", { hasWorker: false }), { ok: true, move: { type: "status", status: "draft" } }, "an explicitly unstarted card may be parked");
const parked = resolveCardMove("build", "inbox", { hasWorker: true });
assert.equal(parked.ok, false, "a started build card cannot be parked");
assert.match(parked.error, /Bucket is for cards that have not started/, "the refusal names what the Bucket means");
assert.match(parked.error, /archive it/, "the refusal names the exit");
for (const column of ["doing", "done"]) {
  const refused = resolveCardMove("build", column);
  assert.equal(refused.ok, false, `build refuses ${column}`);
  assert.match(refused.error, /Bucket and workflow phases/, `build refusal names the exit (${column})`);
}

// An unrecognized stored kind resolves as build: it enters phases and refuses
// the lightweight columns, exactly like a build card.
assert.deepEqual(resolveCardMove("bogus", "analysis"), { ok: true, move: { type: "phase", phase: "analysis" } }, "an unrecognized kind still enters phases");
assert.equal(resolveCardMove("bogus", "doing").ok, false, "an unrecognized kind refuses lightweight columns");

// Unknown targets and unknown kinds refuse everywhere.
assert.equal(resolveCardMove("research", "bogus").ok, false, "research refuses unknown");
assert.equal(resolveCardMove("build", "bogus").ok, false, "build refuses unknown");
assert.equal(resolveCardMove("unknown-kind", "doing").ok, false, "unknown kind does not inherit lightweight");

console.log("card move test ok: lightweight statuses, build phases, cross-refusals");
