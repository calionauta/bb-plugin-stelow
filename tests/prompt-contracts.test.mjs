import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Regression: the seed ban and the turn discipline were pasted into the
// spawn and reseed prompts while the band-swap restart prompt — the one
// that takes over mid-flight at every band boundary — carried neither.
// Prompt clauses that must hold on every build spawn path are therefore
// consts, and every spawn site must reference them: a new spawn path that
// forgets a clause fails here instead of shipping a weaker worker.

const serverSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server.ts"), "utf8");

// Each clause is defined exactly once: pasted duplicates are drift.
const neverSeedDefs = serverSource.match(/const NEVER_SEED = "/g) ?? [];
assert.equal(neverSeedDefs.length, 1, "NEVER_SEED is defined once, not pasted per prompt");
const turnDisciplineDefs = serverSource.match(/const TURN_DISCIPLINE = "/g) ?? [];
assert.equal(turnDisciplineDefs.length, 1, "TURN_DISCIPLINE is defined once, not pasted per prompt");
assert.equal((serverSource.match(/orphans a second workflow outside your card/g) ?? []).length, 1, "the seed-ban prose lives in the const only");
assert.equal((serverSource.match(/never end a turn with a bare progress report/g) ?? []).length, 1, "the turn-discipline prose lives in the const only");

// Every build spawn path references both consts. Anchors are the unique
// per-site sentences; the slice covers the template that follows each one.
const sites = {
  spawn: "Step 1 — classify intent first",
  restart: "You are being restarted mid-workflow at a stage boundary",
  reseed: "The host re-seeded your per-workflow state, transitions.md, and stelow.json",
};
for (const [site, anchor] of Object.entries(sites)) {
  const at = serverSource.indexOf(anchor);
  assert.ok(at >= 0, `the ${site} prompt exists`);
  const window = serverSource.slice(Math.max(0, at - 2500), at + 2500);
  assert.ok(window.includes("${NEVER_SEED}"), `the ${site} prompt references NEVER_SEED`);
  assert.ok(window.includes("${TURN_DISCIPLINE}"), `the ${site} prompt references TURN_DISCIPLINE`);
}

// The shared CLI copy must never invite a card worker to seed: that exact
// sentence produced the project-root orphan.
assert.ok(!serverSource.includes("Seed through `bb stelow seed` only"), "CLI_EQUIVALENTS no longer routes workers to seed");
assert.match(serverSource, /Never run \\?`bb stelow seed\\?`/, "CLI_EQUIVALENTS states the seed ban");

console.log("prompt contracts test ok: single-source clauses, all build spawn paths covered, no seed invitation");
