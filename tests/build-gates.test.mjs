import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { advanceExecutionGates, doneBuildGates } from "../lib/build-gates.mjs";

const HUMAN = "## Scopes\n\n### SCOPE-1: Overlay\n";
const MACHINE = "[SCOPE-1] Overlay\n[TYPE] feature\n";

// Human refusals point at exact lines so the fix is mechanical, capped so
// a sprawling spec does not flood the error.
assert.match(
  advanceExecutionGates({ kind: "build", stage: "execution", specContent: HUMAN, syncedCount: 0 }).refusal ?? "",
  /headings at line 3/,
  "advance names the offending line",
);
assert.match(
  doneBuildGates({ kind: "build", stage: "audit", scopes: [], specMachine: 0, specHuman: 2, specContent: HUMAN }) ?? "",
  /headings at line 3/,
  "done names the offending line",
);
const MANY = ["# t", "### SCOPE-1: a", "### SCOPE-2: b", "### SCOPE-3: c", "### SCOPE-4: d", "### SCOPE-5: e", "### SCOPE-6: f"].join("\n");
assert.match(
  advanceExecutionGates({ kind: "build", stage: "execution", specContent: MANY, syncedCount: 0 }).refusal ?? "",
  /lines 2, 3, 4, 5, 6\)/,
  "line lists cap at five",
);
assert.ok(!/line 7/.test(advanceExecutionGates({ kind: "build", stage: "execution", specContent: MANY, syncedCount: 0 }).refusal ?? ""), "beyond-cap lines stay out");

// Advance order is contractual: untracked first, then cycles, then the
// ordering note. First refusal wins — a reordered gate breaks this file.
assert.match(
  advanceExecutionGates({ kind: "build", stage: "execution", specContent: HUMAN, syncedCount: 0 }).refusal ?? "",
  /human headings.*\[SCOPE-N\].*sync-scopes/s,
  "human dialect refuses with the rewrite redirect",
);
assert.match(
  advanceExecutionGates({ kind: "build", stage: "execution", specContent: MACHINE, syncedCount: 0 }).refusal ?? "",
  /1 machine scope block\(s\).*sync-scopes/,
  "unsynced machine spec refuses with the resync redirect",
);
assert.deepEqual(
  advanceExecutionGates({ kind: "build", stage: "execution", specContent: MACHINE, syncedCount: 2 }),
  { refusal: null, note: null },
  "synced scopes pass silent",
);
assert.deepEqual(
  advanceExecutionGates({ kind: "build", stage: "execution", specContent: MACHINE, syncedCount: 2, cycles: [["scope-1", "scope-2", "scope-1"]] }),
  {
    refusal: "Refused: blockedBy cycle detected (scope-1 -> scope-2 -> scope-1) — fix Dependencies: in the spec-tech file so the graph is acyclic, run `bb stelow sync-scopes`, then advance again.",
    note: null,
  },
  "cycles refuse naming the loop",
);
assert.match(
  advanceExecutionGates({ kind: "build", stage: "execution", specContent: MACHINE, syncedCount: 2, cycles: [["scope-1", "scope-1"]], hasUnstartablePending: true }).refusal ?? "",
  /cycle detected/,
  "cycles outrank the ordering note",
);
assert.deepEqual(
  advanceExecutionGates({ kind: "build", stage: "execution", specContent: MACHINE, syncedCount: 2, hasUnstartablePending: true }),
  { refusal: null, note: "no scope can start — every pending scope waits on unfinished work; check blockedBy before executing" },
  "unstartable ordering advises without blocking",
);
assert.deepEqual(advanceExecutionGates({ kind: "build", stage: "execution", specContent: null, syncedCount: 0 }), { refusal: null, note: null }, "missing spec fails open");
assert.deepEqual(advanceExecutionGates({ kind: "build", stage: "execution", specContent: "no blocks", syncedCount: 0 }), { refusal: null, note: null }, "block-free specs fail open");
assert.deepEqual(advanceExecutionGates({ kind: "research", stage: "execution", specContent: HUMAN, syncedCount: 0 }), { refusal: null, note: null }, "non-build kinds pass");
assert.deepEqual(advanceExecutionGates({ kind: "build", stage: "audit", specContent: HUMAN, syncedCount: 0 }), { refusal: null, note: null }, "other stages pass");
assert.deepEqual(advanceExecutionGates({}), { refusal: null, note: null }, "junk passes");

// Done order is contractual too: untracked, then unverified Record, then
// open children. Each names its redirect.
assert.match(
  doneBuildGates({ kind: "build", stage: "audit", scopes: [], specMachine: 0, specHuman: 2 }) ?? "",
  /human headings.*\[SCOPE-N\]/,
  "human dialect at done refuses with the rewrite loop",
);
assert.match(
  doneBuildGates({ kind: "build", stage: "audit", scopes: [], specMachine: 3, specHuman: 0 }) ?? "",
  /0 synced scopes.*sync-scopes.*advance execution/,
  "unsynced machine spec refuses with the resync loop",
);
assert.match(
  doneBuildGates({ kind: "build", stage: "audit", scopes: [{ id: "s1", name: "S", status: "done", record: { verified: false } }] }) ?? "",
  /unverified Record — complete every verification checklist/,
  "unverified Records refuse with the checklist redirect",
);
assert.match(
  doneBuildGates({ kind: "build", stage: "audit", scopes: [{ id: "s1", name: "S", status: "done", tasks: [{ id: "t", name: "T", status: "pending" }] }] }) ?? "",
  /still hold open tasks — a scope closes only when its tasks do/,
  "open children refuse with the marking redirect",
);
assert.match(
  doneBuildGates({ kind: "build", stage: "audit", scopes: [{ id: "s1", name: "S", status: "done", record: { verified: false }, tasks: [{ id: "t", name: "T", status: "pending" }] }] }) ?? "",
  /unverified Record/,
  "unverified outranks containment",
);
assert.equal(doneBuildGates({ kind: "build", stage: "audit", scopes: [{ id: "s1", status: "done" }] }), null, "recordless closes stay advisory");
assert.equal(doneBuildGates({ kind: "build", stage: "audit", scopes: [{ id: "s1", status: "done", record: { verified: true }, tasks: [] }] }), null, "verified closes pass");
assert.equal(doneBuildGates({ kind: "research", stage: null, scopes: [] }), null, "non-build kinds pass");
assert.equal(doneBuildGates({ kind: "build", stage: "verification", scopes: [] }), null, "non-audit stages pass");

// Single source: gates block exactly when the conditions machine names a
// blocking type — the two can never disagree about what blocks done.
import { evidenceConditions as _conditions } from "../lib/trackable-evidence.mjs";
import { buildRegistry as _registry } from "../lib/trackable-relations.mjs";
import { BLOCKING_CONDITION_TYPES as _blocking } from "../lib/trackables.mjs";
const matrix = [
  [],
  [{ id: "s1", kind: "scope", status: "done" }],
  [{ id: "s1", kind: "scope", status: "done", record: { verified: false } }],
  [{ id: "s1", kind: "scope", status: "done", record: { verified: true }, tasks: [{ id: "t", name: "T", status: "pending" }] }],
  [{ id: "s1", kind: "scope", status: "pending", blockedBy: ["s2"] }, { id: "s2", kind: "scope", status: "pending" }],
  [{ id: "t1", kind: "task", status: "done" }],
];
for (const scopes of matrix) {
  const reg = _registry(scopes);
  const hasBlocking = scopes.some((scope) => _conditions({ entry: scope, registry: reg }).some((condition) => _blocking.includes(condition.type)));
  assert.equal(doneBuildGates({ kind: "build", stage: "audit", scopes }) !== null, hasBlocking, `gates agree with conditions for ${JSON.stringify(scopes.map((scope) => scope.id))}`);
}

// Wiring pins: server advance/done consult the gates module, never inline
// refusals — the order above is the contract.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
const executionAdvance = readFileSync(join(root, "server/execution-advance.ts"), "utf8");
assert.match(executionAdvance, /advanceExecutionGates\(/, "advance consults the gates module");
assert.match(server, /doneBuildGates\(/, "done consults the gates module");

console.log("build gates test ok: order, redirects, fail-open, wiring");
