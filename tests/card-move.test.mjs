import assert from "node:assert/strict";
import { resolveCardMove } from "../lib/card-move.mjs";

// Lightweight tracks (research + explore): columns map to statuses, build
// phases refuse.
for (const kind of ["research", "explore"]) {
  assert.deepEqual(resolveCardMove(kind, "todo"), { ok: true, move: { type: "status", status: "pending" } }, `${kind}: todo -> pending`);
  assert.deepEqual(resolveCardMove(kind, "doing"), { ok: true, move: { type: "status", status: "in-progress" } }, `${kind}: doing -> in-progress`);
  assert.deepEqual(resolveCardMove(kind, "done"), { ok: true, move: { type: "status", status: "completed" } }, `${kind}: done -> completed`);
  assert.deepEqual(resolveCardMove(kind, "archived"), { ok: true, move: { type: "status", status: "archived" } }, `${kind}: archived passes through`);
  for (const phase of ["analysis", "planning", "execution", "review", "completed"]) {
    const refused = resolveCardMove(kind, phase);
    assert.equal(refused.ok, false, `${kind} refuses ${phase}`);
    assert.match(refused.error, /To-Do, Doing, Done/, `${kind} refusal names the exit (${phase})`);
  }
}

// Build track: phases enter, terminals set, lightweight columns refuse.
assert.deepEqual(resolveCardMove("build", "analysis"), { ok: true, move: { type: "phase", phase: "analysis" } }, "phase entry");
assert.deepEqual(resolveCardMove("build", "completed"), { ok: true, move: { type: "status", status: "completed" } }, "terminal sets status");
for (const column of ["todo", "doing", "done"]) {
  const refused = resolveCardMove("build", column);
  assert.equal(refused.ok, false, `build refuses ${column}`);
  assert.match(refused.error, /workflow phases/, `build refusal names the exit (${column})`);
}

// Legacy "delivery" kind reads as build (tracks v1 rename, silent migration).
assert.deepEqual(resolveCardMove("delivery", "analysis"), { ok: true, move: { type: "phase", phase: "analysis" } }, "legacy delivery still enters phases");
assert.equal(resolveCardMove("delivery", "todo").ok, false, "legacy delivery refuses lightweight columns");

// Unknown targets and unknown kinds refuse everywhere.
assert.equal(resolveCardMove("research", "bogus").ok, false, "research refuses unknown");
assert.equal(resolveCardMove("build", "bogus").ok, false, "build refuses unknown");
assert.equal(resolveCardMove("unknown-kind", "todo").ok, false, "unknown kind does not inherit lightweight");

console.log("card move test ok: lightweight statuses, build phases, cross-refusals");
