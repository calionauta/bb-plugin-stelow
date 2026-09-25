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

const serverSource = [
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server.ts"), "utf8"),
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server/plugin-runtime.ts"), "utf8"),
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server/runtime/build-thread-sync.ts"), "utf8"),
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server/cards-create-prompt.ts"), "utf8"),
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server/cards-create.ts"), "utf8"),
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server/core-migrations.ts"), "utf8"),
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../lib/worker-continuation.mjs"), "utf8"),
].join("\n");
const cliRegistry = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server/runtime/cli-registry.ts"), "utf8");

// Each clause is defined exactly once: pasted duplicates are drift.
const neverSeedDefs = serverSource.match(/const\s+NEVER_SEED\s*=\s*"/g) ?? [];
assert.equal(neverSeedDefs.length, 1, "NEVER_SEED is defined once, not pasted per prompt");
const turnDisciplineDefs = serverSource.match(/const\s+TURN_DISCIPLINE\s*=\s*"/g) ?? [];
assert.equal(turnDisciplineDefs.length, 1, "TURN_DISCIPLINE is defined once, not pasted per prompt");
assert.equal((serverSource.match(/const\s+COMMIT_STYLE\s*=\s*"/g) ?? []).length, 1, "COMMIT_STYLE is defined once, not pasted per prompt");
assert.equal((serverSource.match(/const\s+INTERFACE_PICK\s*=\s*"/g) ?? []).length, 1, "INTERFACE_PICK is defined once, not pasted per prompt");
assert.equal((serverSource.match(/Interface-pick discipline: check review_gates/g) ?? []).length, 1, "the interface-pick prose lives in the const only");
assert.equal((serverSource.match(/\$\{INTERFACE_PICK\}/g) ?? []).length, 3, "restart, nudge, and ask copy reference INTERFACE_PICK");
assert.match(serverSource, /%INTERFACE_PICK%/, "the initial creation template references INTERFACE_PICK");
assert.equal((serverSource.match(/never run `bb stelow seed`/g) ?? []).length, 1, "the seed-ban prose lives in the const only");
assert.equal((serverSource.match(/a second workflow outside your card/g) ?? []).length, 1, "the seed-ban explanation lives in the const only");
assert.equal((serverSource.match(/never end a turn with a bare progress report/g) ?? []).length, 1, "the turn-discipline prose lives in the const only");
assert.equal((serverSource.match(/Never commit empty or `wip` messages/g) ?? []).length, 1, "the commit-style prose lives in the const only");
assert.equal((serverSource.match(/const\s+RECON_PROTOCOL\s*=\s*"/g) ?? []).length, 1, "RECON_PROTOCOL is defined once");

// Every build spawn path references both consts. Prompt templates are
// single giant lines, so fixed char windows either miss or bleed: bound
// each site by the next anchor instead.
const sites = {
  spawn: "Step 1 — verify intent first",
  restart: "researchRestart ??",
  // The reseed template opens with the same sentence as restart, so anchor
  // on the site's unique const assignment instead (it precedes the template).
  reseed: "researchReseed ??",
};
const ordered = Object.entries(sites).map(([site, anchor]) => {
  const at = serverSource.indexOf(anchor);
  assert.ok(at >= 0, `the ${site} prompt exists`);
  return { site, at };
}).sort((a, b) => a.at - b.at);
const siteEnds = {
  spawn: "%REQUEST%`;",
  restart: "return { prompt, projectPath, workspace };",
  reseed: "workers.recordThread(cardId, newThread.id, preset.id, \"reseed\")",
};
for (const { site, at } of ordered) {
  const stop = serverSource.indexOf(siteEnds[site], at);
  assert.ok(stop > at, `the ${site} prompt has its end marker`);
  const window = serverSource.slice(at, stop);
  const token = site === "spawn" ? "%" : "${";
  const suffix = site === "spawn" ? "%" : "}";
  assert.ok(window.includes(`${token}NEVER_SEED${suffix}`), `the ${site} prompt references NEVER_SEED`);
  assert.ok(window.includes(`${token}TURN_DISCIPLINE${suffix}`), `the ${site} prompt references TURN_DISCIPLINE`);
  assert.ok(window.includes(`${token}COMMIT_STYLE${suffix}`), `the ${site} prompt references COMMIT_STYLE`);
  assert.ok(window.includes(`${token}RECON_PROTOCOL${suffix}`), `the ${site} prompt references RECON_PROTOCOL`);
}

// The shared CLI copy must never invite a card worker to seed: that exact
// sentence produced the project-root orphan.
assert.ok(!serverSource.includes("Seed through `bb stelow seed` only"), "CLI_EQUIVALENTS no longer routes workers to seed");
assert.match(
  serverSource,
  /Never\s*\\\s*run `bb stelow seed`/,
  "CLI_EQUIVALENTS states the seed ban",
);

// Explicit completion rides the same rails: one const, every card spawn
// path, no pasted copies.
const doneDefs = serverSource.match(/const\s+DONE_PROTOCOL\s*=\s*"/g) ?? [];
assert.equal(doneDefs.length, 1, "DONE_PROTOCOL is defined once, not pasted per prompt");
const reviewDefs = serverSource.match(/const\s+REVIEW_PROTOCOL\s*=\s*"/g) ?? [];
assert.equal(reviewDefs.length, 1, "REVIEW_PROTOCOL is defined once, not pasted per prompt");
assert.equal((serverSource.match(/run `bb stelow done` to mark the card complete/g) ?? []).length, 1, "the done prose lives in the const only");
const doneSites = {
  // Each site is bounded by an explicit end marker: prompt templates are
  // single giant lines, so fixed char windows either miss or bleed, and
  // next-anchor bounding breaks where a template closes after the next
  // anchor opens (research closes past explore's first line).
  spawn: { anchor: "Step 1 — verify intent first", end: "%REQUEST%`;" },
  restart: {
    anchor: "researchRestart ??",
    end: "return { prompt, projectPath, workspace };",
  },
  reseed: { anchor: "in the re-seeded state.md", end: "workers.recordThread(cardId, newThread.id, preset.id, \"reseed\")" },
  research: { anchor: "function researchWorkerPrompt", end: "function exploreWorkerPrompt" },
  explore: { anchor: "SINGLE-STAGE Stelow exploration", end: "export function createCardInternal" },
};
// Paid review is offered, never auto-run: both lightweight prompts reference
// the single REVIEW_PROTOCOL const.
for (const site of ["research", "explore"]) {
  const { anchor, end } = doneSites[site];
  const at = serverSource.indexOf(anchor);
  const window = serverSource.slice(at, serverSource.indexOf(end, at));
  assert.ok(window.includes("${REVIEW_PROTOCOL}"), `the ${site} prompt offers paid review as opt-in only`);
}
for (const [site, { anchor, end }] of Object.entries(doneSites)) {
  const at = serverSource.indexOf(anchor);
  assert.ok(at >= 0, `the ${site} prompt exists`);
  const stop = serverSource.indexOf(end, at);
  assert.ok(stop > at, `the ${site} prompt has its end marker`);
  const window = serverSource.slice(at, stop);
  const doneToken = site === "spawn" ? "%DONE_PROTOCOL%" : "${DONE_PROTOCOL}";
  assert.ok(window.includes(doneToken), `the ${site} prompt references DONE_PROTOCOL`);
}

// Worker verbs: done + playbook are registered, card-resolved, and listed;
// preset mutation refuses card workers with the Manage redirect.
assert.match(serverSource, /if \(argv\[0\] === "done"\) \{/, "the done handler exists");
assert.match(cliRegistry, /"done",[\s\S]*?"bb stelow done/, "the CLI registers done with its contract");
assert.match(cliRegistry, /"playbook",[\s\S]*?"bb stelow playbook/, "the CLI registers playbook with its contract");
assert.match(cliRegistry, /"split",[\s\S]*?"bb stelow split/, "the CLI registers split with its contract");
assert.match(
  serverSource,
  /doneEligibility\(\{[\s\S]*?kind: "build",[\s\S]*?stage: currentStage/,
  "build completion is gated in code, not prose",
);
const auditBuildPattern = new RegExp([
  String.raw`runHelper\(\s*\[\s*"audit-trail",\s*"build",`,
  String.raw`\s*"--strict",\s*"--json"`,
].join(""));
const auditCheckPattern = new RegExp([
  String.raw`runHelper\(\s*\[\s*"audit-trail",\s*"check",`,
  String.raw`\s*"--strict",\s*"--json"`,
].join(""));
const auditEvidencePattern = new RegExp([
  String.raw`auditTrailGate\(\{[\s\S]*?build: trail,`,
  String.raw`[\s\S]*?check: trailCheck,[\s\S]*?verifiedGit: gitEvidence`,
].join(""));
assert.match(
  serverSource,
  auditBuildPattern,
  "build completion creates the upstream portable audit trail behind the strict gate",
);
assert.match(
  serverSource,
  auditCheckPattern,
  "build completion re-validates the portable audit trail it just wrote",
);
assert.match(
  serverSource,
  auditEvidencePattern,
  "the trail is bound to the Git identity the audit receipt was verified at",
);
assert.match(serverSource, /trail\.code === 0\s*\?\s*await runHelper/, "check runs only after a build that succeeded");
assert.match(
  serverSource,
  /researchVerifyReport\(\s*cardId,\s*strategyRounds\(card\)\.length/,
  "research completion requires a passing verify",
);
assert.match(
  serverSource,
  /exploreVerifyReport\(\s*cardId,\s*card\.explore_stage,\s*artifact\.ready/,
  "explore completion requires a passing verify",
);
assert.match(serverSource, /presets are managed from the card's Agent preset section/, "preset mutation refuses worker threads");

// Explicit completion is enforced, not inferred: the old audit+idle ⇒
// completed one-liner is gone (research/explore keep their own artifact
// gates; build completes only through `done`), and the audit resume carries
// one shared nudge.
assert.ok(!serverSource.includes('updateCard(cardId, { status: "completed", activity: "idle", last_assistant_text: lastOutput, last_idle_at: now(), last_error: null, stage: currentStage })'), "no audit-idle branch marks completed");
const nudgeDefs = serverSource.match(/const\s+AUDIT_DONE_NUDGE\s*=\s*"/g) ?? [];
assert.equal(nudgeDefs.length, 1, "AUDIT_DONE_NUDGE is defined once, not pasted per branch");
assert.match(serverSource, /shouldDoneNudge\(\{/, "the audit branch resumes through the done-nudge budget");

// Explicit split rides the same rails: one const, the three build spawn
// paths (research/explore are single-stage — no triage, no split clause),
// no pasted copies. The host executes the recorded approval; the worker
// never takes card content as a split argument.
const splitDefs = serverSource.match(/const\s+SPLIT_PROTOCOL\s*=\s*/g) ?? [];
assert.equal(splitDefs.length, 1, "SPLIT_PROTOCOL is defined once, not pasted per prompt");
assert.equal((serverSource.match(/run `bb stelow split` \(no args/g) ?? []).length, 1, "the split invocation prose lives in the const only");
const splitSites = {
  spawn: "Step 1 — verify intent first",
  restart: "researchRestart ??",
  reseed: "researchReseed ??",
};
const splitEnds = {
  spawn: "%REQUEST%`;",
  restart: "return { prompt, projectPath, workspace };",
  reseed: "workers.recordThread(cardId, newThread.id, preset.id, \"reseed\")",
};
for (const [site, anchor] of Object.entries(splitSites)) {
  const at = serverSource.indexOf(anchor);
  assert.ok(at >= 0, `the ${site} prompt exists`);
  const stop = serverSource.indexOf(splitEnds[site], at);
  assert.ok(stop > at, `the ${site} prompt has its end marker`);
  const window = serverSource.slice(at, stop);
  const splitToken = site === "spawn" ? "%SPLIT_PROTOCOL%" : "${SPLIT_PROTOCOL}";
  assert.ok(window.includes(splitToken), `the ${site} prompt references SPLIT_PROTOCOL`);
}

// Worker verbs: split is registered, card-resolved, content-free, and listed;
// ask carries the closed --tag set; the worker CLI advance never completes
// (completion is explicit through `done` — the audit+idle inference and the
// worker advance shortcut are both gone; the panel's manual override keeps
// its human-explicit move).
assert.match(serverSource, /if \(argv\[0\] === "split"\) \{/, "the split handler exists");
assert.match(serverSource, /No content args by design/, "split takes no content args");
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS split_proposals/, "split proposals persist host-side");
assert.match(serverSource, /split_from/, "children link their parent");
assert.match(serverSource, /Split is exceptional, not a checklist decomposition/, "the worker defaults to one focused card");
assert.match(serverSource, /Each proposed child must be worth its own normal workflow/, "the worker must reject micro-splits");
assert.match(
  serverSource,
  /Do NOT split merely because the request has\s*\\\s*bullets, files, UI\/API pieces, sequential steps, or small fixes/,
  "the split threshold names common false positives",
);
assert.match(serverSource, /A split ask must use --multiple/, "the host enforces multi-select for an approved split");
const splitStop = /if \(archiveParent\) \{\s*\/\/ Full split parks[\s\S]*?await workers\.stop\(card\.worker_thread_id\);/;
assert.match(serverSource, splitStop, "a fully split parent stops its worker before archiving");
assert.ok(!serverSource.includes('updateCard(cliCard.id, { stage, status: stage === "audit" ? "completed"'), "the worker advance never completes — done does");

console.log("prompt contracts test ok: single-source clauses, all build spawn paths covered, no seed invitation, done/playbook/split verbs, preset fence, no audit inference, explicit split");
