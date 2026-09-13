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

// Every build spawn path references both consts. Prompt templates are
// single giant lines, so fixed char windows either miss or bleed: bound
// each site by the next anchor instead.
const sites = {
  spawn: "Step 1 — classify intent first",
  // The restart template opens with the same re-seed sentence as the reseed
  // template; indexOf lands on this earlier occurrence, and the end marker
  // closes before the reseed template starts.
  restart: "The host re-seeded your per-workflow state, transitions.md, and stelow.json",
  // The reseed template opens with the same sentence as restart, so anchor
  // on the site's unique const assignment instead (it precedes the template).
  reseed: "researchReseed ?? exploreReseed ??",
};
const ordered = Object.entries(sites).map(([site, anchor]) => {
  const at = serverSource.indexOf(anchor);
  assert.ok(at >= 0, `the ${site} prompt exists`);
  return { site, at };
}).sort((a, b) => a.at - b.at);
const siteEnds = {
  spawn: "const ts = now();",
  restart: "only now retire the old one",
  reseed: "recordWorkerThread(db, cardId, newThread.id, preset.id, \"reseed\")",
};
for (const { site, at } of ordered) {
  const stop = serverSource.indexOf(siteEnds[site], at);
  assert.ok(stop > at, `the ${site} prompt has its end marker`);
  const window = serverSource.slice(at, stop);
  assert.ok(window.includes("${NEVER_SEED}"), `the ${site} prompt references NEVER_SEED`);
  assert.ok(window.includes("${TURN_DISCIPLINE}"), `the ${site} prompt references TURN_DISCIPLINE`);
}

// The shared CLI copy must never invite a card worker to seed: that exact
// sentence produced the project-root orphan.
assert.ok(!serverSource.includes("Seed through `bb stelow seed` only"), "CLI_EQUIVALENTS no longer routes workers to seed");
assert.match(serverSource, /Never run \\?`bb stelow seed\\?`/, "CLI_EQUIVALENTS states the seed ban");

// Explicit completion rides the same rails: one const, every card spawn
// path, no pasted copies.
const doneDefs = serverSource.match(/const DONE_PROTOCOL = "/g) ?? [];
assert.equal(doneDefs.length, 1, "DONE_PROTOCOL is defined once, not pasted per prompt");
assert.equal((serverSource.match(/run `bb stelow done` to mark the card complete/g) ?? []).length, 1, "the done prose lives in the const only");
const doneSites = {
  // Each site is bounded by an explicit end marker: prompt templates are
  // single giant lines, so fixed char windows either miss or bleed, and
  // next-anchor bounding breaks where a template closes after the next
  // anchor opens (research closes past explore's first line).
  spawn: { anchor: "Step 1 — classify intent first", end: "const ts = now();" },
  restart: { anchor: "You are being restarted mid-workflow at a stage boundary", end: "only now retire the old one" },
  reseed: { anchor: "in the re-seeded state.md", end: "recordWorkerThread(db, cardId, newThread.id, preset.id, \"reseed\")" },
  research: { anchor: "NEVER check a box yourself", end: "function exploreWorkerPrompt" },
  explore: { anchor: "SINGLE-STAGE Stelow exploration", end: "async function createCardInternal" },
};
for (const [site, { anchor, end }] of Object.entries(doneSites)) {
  const at = serverSource.indexOf(anchor);
  assert.ok(at >= 0, `the ${site} prompt exists`);
  const stop = serverSource.indexOf(end, at);
  assert.ok(stop > at, `the ${site} prompt has its end marker`);
  const window = serverSource.slice(at, stop);
  assert.ok(window.includes("${DONE_PROTOCOL}"), `the ${site} prompt references DONE_PROTOCOL`);
}

// Worker verbs: done + playbook are registered, card-resolved, and listed;
// preset mutation refuses card workers with the Manage redirect.
assert.match(serverSource, /if \(argv\[0\] === "done"\) \{/, "the done handler exists");
assert.match(serverSource, /if \(argv\[0\] === "playbook"\) \{/, "the playbook handler exists");
assert.match(serverSource, /status\|ask\|seed\|advance\|done\|playbook\|doctor/, "the CLI usage lists done and playbook");
assert.match(serverSource, /doneEligibility\(\{ kind: "build", stage: currentStage/, "build completion is gated in code, not prose");
assert.match(serverSource, /researchVerifyReport\(cardId, strategyRounds\(card\)\.length/, "research completion requires a passing verify");
assert.match(serverSource, /exploreVerifyReport\(cardId, card\.explore_stage, artifact\.ready\)/, "explore completion requires a passing verify");
assert.match(serverSource, /presets are managed from the card's Agent preset section/, "preset mutation refuses worker threads");

console.log("prompt contracts test ok: single-source clauses, all build spawn paths covered, no seed invitation, done/playbook verbs, preset fence");
