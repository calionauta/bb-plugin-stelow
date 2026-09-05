import assert from "node:assert/strict";
import { resolveCardMove } from "../lib/card-move.mjs";

// Research track: columns map to statuses, delivery phases refuse.
assert.deepEqual(resolveCardMove("research", "todo"), { ok: true, move: { type: "status", status: "pending" } }, "todo -> pending");
assert.deepEqual(resolveCardMove("research", "doing"), { ok: true, move: { type: "status", status: "in-progress" } }, "doing -> in-progress");
assert.deepEqual(resolveCardMove("research", "done"), { ok: true, move: { type: "status", status: "completed" } }, "done -> completed");
assert.deepEqual(resolveCardMove("research", "archived"), { ok: true, move: { type: "status", status: "archived" } }, "archived passes through");
for (const phase of ["analysis", "planning", "execution", "review", "completed"]) {
  const refused = resolveCardMove("research", phase);
  assert.equal(refused.ok, false, `research refuses ${phase}`);
  assert.match(refused.error, /To-Do, Doing, Done/, `research refusal names the exit (${phase})`);
}

// Delivery track: phases enter, terminals set, research columns refuse.
assert.deepEqual(resolveCardMove("delivery", "analysis"), { ok: true, move: { type: "phase", phase: "analysis" } }, "phase entry");
assert.deepEqual(resolveCardMove("delivery", "completed"), { ok: true, move: { type: "status", status: "completed" } }, "terminal sets status");
for (const column of ["todo", "doing", "done"]) {
  const refused = resolveCardMove("delivery", column);
  assert.equal(refused.ok, false, `delivery refuses ${column}`);
  assert.match(refused.error, /workflow phases/, `delivery refusal names the exit (${column})`);
}

// Unknown targets and unknown kinds refuse everywhere.
assert.equal(resolveCardMove("research", "bogus").ok, false, "research refuses unknown");
assert.equal(resolveCardMove("delivery", "bogus").ok, false, "delivery refuses unknown");
assert.equal(resolveCardMove("unknown-kind", "todo").ok, false, "unknown kind does not inherit research");

console.log("card move test ok: research statuses, delivery phases, cross-refusals");
