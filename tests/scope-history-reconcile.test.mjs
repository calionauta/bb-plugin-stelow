import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import test from "node:test";
import { reconcileScopeHistory } from "../lib/scope-history-reconcile.mjs";

const OLD_SHA = "a".repeat(64);
const NEW_SHA = "b".repeat(64);
const AT = "2026-11-05T12:00:00.000Z";
const PLANNING_FIELDS = ["id", "name", "type", "blockedBy", "targetFiles", "maxIterations"];
const TYPES = { 6: "test-unit", 7: "test-integration", 8: "test-security", 9: "test-behavior" };
const task = (id, name, status = "pending", source = "planned") => ({ id, name, status, source });

function scope(number, tasks = []) {
  return {
    id: `scope-${number}`,
    name: `Scope ${number}`,
    type: TYPES[number] ?? "feature",
    blockedBy: number > 1 && number < 6 ? [`scope-${number - 1}`] : [],
    targetFiles: [`src/scope-${number}.ts`],
    maxIterations: 3,
    status: "pending",
    tasks,
  };
}

function previousWorkflow() {
  const scopes = Array.from({ length: 9 }, (_, index) => scope(index + 1));
  Object.assign(scopes[0], {
    name: "Diagnostic core",
    status: "in-progress",
    started_at: "2026-11-05T06:24:00.310634+00:00",
    start_sha: "01d41741b7d60d10a03175b3009ca0f48fb0c60b",
    iteration_count: 3,
    record: {
      verified: true,
      meaning: "Historical diagnostic subset only",
      baseline: { "test:unit": 1 },
      red_proof: { exit_code: 1, evidence: "original-red.txt" },
      freeze_sha: "c".repeat(64),
      rounds: [{ id: 1 }, { id: 2 }, { id: 3 }],
    },
    operational_extension: { owner: "original-worker", retries: 2 },
    tasks: [
      { ...task("1.1", "Establish diagnostic context", "done"),
        note: "Historical diagnostics only", record: { evidence: "original-context-proof", verified: true } },
      task("1.2", "Preserve source identities", "done"),
      task("1.3", "Publish immutable originals", "done"),
      { ...task("1.4", "Review core findings", "skipped", "discovered"), note: "Partly deferred to mandatory task3.4" },
    ],
  });
  scopes[2].tasks = [{
    ...task("3.4", "Resolve mandatory release hardening", "pending", "discovered"),
    note: "N1-N9, authenticated data authority and quarantine remain required",
    evidence: ["core-review-2.md", "core-review-3.md"],
  }];
  scopes[5].tasks = [task("6.1", "Review critical guards")];
  return {
    id: "workflow-memory-hub", status: "in-progress", current_stage: "execution",
    specTechFile: "spec-tech_v2.md", specTechSha256: OLD_SHA, scopes,
    operatorMetadata: { preserve: ["receipt_original", "original-clock"] },
    scopeHistory: [{ receiptId: "receipt_prior", note: "Preserve opaque earlier history" }],
  };
}

function generatedWorkflow(previous) {
  const core = scope(1, [
    ...previous.scopes[0].tasks.filter((entry) => entry.source === "planned"),
    task("2.1", "Provision local backend"),
    task("3.1", "Qualify the real adapter"),
    task("4.1", "Verify coherent recovery"),
    task("5.1", "Deliver the read-only inspector"),
    task("1.5", "Verify expanded integrated acceptance"),
  ].map((entry) => ({ id: entry.id, name: entry.name, source: "planned", status: "pending" })));
  Object.assign(core, { name: "Integrated foundations", maxIterations: 5, targetFiles: ["src/core/", "src/recovery/"] });
  return {
    id: "must-not-replace-workflow-identity", status: "pending", current_stage: "planning",
    generatedOnlyField: "must-not-be-copied",
    specTechFile: "spec-tech_v3.md",
    scopes: [core, ...[6, 7, 8, 9].map((number) => scope(number,
      [task(`${number}.1`, number === 6 ? "Review critical guards" : `Verify track ${number}`)]))],
  };
}

function fixture() {
  const previous = previousWorkflow();
  return {
    previous,
    generated: generatedWorkflow(previous),
    options: { at: AT, specSha256: NEW_SHA, taskMoves: [{ fromScope: "scope-3", taskId: "3.4", toScope: "scope-1" }] },
  };
}

function freezeDeep(value) {
  if (!value || typeof value !== "object") return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
}

function invoke({ previous, generated, options }) {
  const originals = structuredClone([previous, generated, options]);
  const result = reconcileScopeHistory(freezeDeep(previous), freezeDeep(generated), freezeDeep(options));
  assert.deepEqual([previous, generated, options], originals, "success and refusal must leave all inputs untouched");
  return result;
}

function refused(input) {
  const result = invoke(input);
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, "string");
  assert.ok(result.error.trim(), "a refusal must explain its cause");
}

function containsValue(container, expected) {
  if (isDeepStrictEqual(container, expected)) return true;
  return Boolean(container && typeof container === "object"
    && Object.values(container).some((value) => containsValue(value, expected)));
}

const byId = (workflow, id) => workflow.scopes.find((entry) => entry.id === id);

test("nine scopes become one feature plus four tests without resetting core history", () => {
  const input = fixture();
  const result = invoke(input);
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.ok(Object.hasOwn(result, "summary"));
  const output = result.workflow;
  assert.deepEqual(output.scopes.map((entry) => entry.id), ["scope-1", "scope-6", "scope-7", "scope-8", "scope-9"]);
  const core = byId(output, "scope-1");
  const oldCore = input.previous.scopes[0];
  for (const field of PLANNING_FIELDS) assert.deepEqual(core[field], input.generated.scopes[0][field]);
  for (const [field, value] of Object.entries(oldCore)) {
    if (!PLANNING_FIELDS.includes(field) && field !== "tasks") assert.deepEqual(core[field], value);
  }
  for (const entry of oldCore.tasks) assert.deepEqual(core.tasks.find((candidate) => candidate.id === entry.id), entry);
  assert.deepEqual(core.tasks.find((entry) => entry.id === "3.4"), input.previous.scopes[2].tasks[0]);
  for (const id of ["2.1", "3.1", "4.1", "5.1", "1.5"]) {
    const entry = core.tasks.find((candidate) => candidate.id === id);
    assert.equal(entry.status, "pending");
    assert.equal(entry.source, "planned");
  }
  assert.equal(output.specTechFile, input.generated.specTechFile);
  assert.equal(output.specTechSha256, NEW_SHA);
  const allowed = new Set(["scopes", "specTechFile", "specTechSha256", "scopeHistory"]);
  const unrelated = (workflow) => Object.fromEntries(Object.entries(workflow).filter(([key]) => !allowed.has(key)));
  assert.deepEqual(unrelated(output), unrelated(input.previous));
  assert.deepEqual(output.scopeHistory.slice(0, -1), input.previous.scopeHistory);
  assert.equal(output.scopeHistory.length, input.previous.scopeHistory.length + 1);
  const history = output.scopeHistory.at(-1);
  for (const value of [input.previous.specTechFile, OLD_SHA, input.previous.scopes, input.options.taskMoves, AT]) {
    assert.ok(containsValue(history, value), "history retains the original spec, scopes, exact moves and migration time");
  }
  for (const number of [2, 3, 4, 5]) {
    assert.equal(input.previous.scopes[number - 1].status, "pending");
    assert.ok(containsValue(history, input.previous.scopes[number - 1]));
  }
});

test("a repeated version/hash is an idempotent no-op, even after its moves were applied", () => {
  const input = fixture();
  const first = invoke(input);
  assert.equal(first.ok, true);
  const again = invoke({ previous: first.workflow, generated: input.generated,
    options: { ...input.options, at: "2026-11-05T13:00:00.000Z" } });
  assert.equal(again.ok, true);
  assert.equal(again.changed, false);
  assert.deepEqual(again.workflow, first.workflow, "replay cannot duplicate history or require retired move sources again");
});

test("an explicit move preserves an in-progress planned task instead of reseeding it", () => {
  const input = fixture();
  const moved = { ...task("2.1", "Provision local backend", "in-progress"), note: "Original checkpoint", started_at: AT };
  input.previous.scopes[1].tasks = [moved];
  input.options.taskMoves.push({ fromScope: "scope-2", taskId: "2.1", toScope: "scope-1" });
  const result = invoke(input);
  assert.equal(result.ok, true);
  assert.deepEqual(byId(result.workflow, "scope-1").tasks.find((entry) => entry.id === "2.1"), moved);
});

for (const status of ["pending", "in-progress"]) {
  test(`an open ${status} task in a retired scope requires an explicit move`, () => {
    const input = fixture();
    input.previous.scopes[1].tasks = [task("2.1", "Provision local backend", status)];
    refused(input); // Its generated target placeholder does not count as a migration decision.
  });
}

test("stable done task IDs cannot silently acquire a different meaning", () => {
  const input = fixture();
  input.generated.scopes[0].tasks[0].name = "Publish a completely unrelated product";
  refused(input);
});

test("historical done and skipped tasks survive omission from the new planned-task seed", () => {
  const input = fixture();
  input.generated.scopes[0].tasks = input.generated.scopes[0].tasks.filter((entry) => entry.id !== "1.2");
  const result = invoke(input);
  assert.equal(result.ok, true);
  for (const id of ["1.2", "1.4"]) {
    assert.deepEqual(byId(result.workflow, "scope-1").tasks.find((entry) => entry.id === id),
      input.previous.scopes[0].tasks.find((entry) => entry.id === id));
  }
});

const malformed = [
  ["empty generated scopes", (input) => { input.generated.scopes = []; }],
  ["non-array generated scopes", (input) => { input.generated.scopes = null; }],
  ["duplicate generated scope IDs", (input) => {
    input.generated.scopes.push(structuredClone(input.generated.scopes[0]));
  }],
  ["duplicate prior scope IDs", (input) => {
    input.previous.scopes.push(structuredClone(input.previous.scopes[0]));
  }],
  ["empty scope ID", (input) => { input.generated.scopes[0].id = ""; }],
  ["malformed scope ID", (input) => { input.generated.scopes[0].id = "../scope-1"; }],
  ["empty task ID", (input) => { input.generated.scopes[0].tasks[0].id = ""; }],
  ["non-string task ID", (input) => { input.generated.scopes[0].tasks[0].id = 4; }],
  ["malformed task ID", (input) => { input.generated.scopes[0].tasks[0].id = "1/4"; }],
  ["non-array generated tasks", (input) => { input.generated.scopes[0].tasks = "not-a-task-list"; }],
  ["duplicate generated task IDs", (input) => {
    input.generated.scopes[0].tasks.push(structuredClone(input.generated.scopes[0].tasks[0]));
  }],
  ["duplicate prior task IDs", (input) => {
    input.previous.scopes[0].tasks.push(structuredClone(input.previous.scopes[0].tasks[0]));
  }],
  ["task ID shared across prior scopes", (input) => {
    input.previous.scopes[7].tasks = [task("1.1", "Conflicting old responsibility")];
  }],
  ["task ID shared across generated scopes", (input) => { input.generated.scopes[1].tasks[0].id = "1.1"; }],
];
for (const [label, change] of malformed) {
  test(`malformed reconciliation refuses: ${label}`, () => {
    const input = fixture();
    change(input);
    refused(input);
  });
}

const invalidMoves = [
  ["missing source scope", (input) => { input.options.taskMoves[0].fromScope = "scope-99"; }],
  ["missing source task", (input) => { input.options.taskMoves[0].taskId = "3.99"; }],
  ["missing generated target", (input) => { input.options.taskMoves[0].toScope = "scope-99"; }],
  ["retired scope as target", (input) => { input.options.taskMoves[0].toScope = "scope-3"; }],
  ["duplicate move", (input) => { input.options.taskMoves.push({ ...input.options.taskMoves[0] }); }],
  ["two destinations for one task", (input) => {
    input.options.taskMoves.push({ ...input.options.taskMoves[0], toScope: "scope-6" });
  }],
  ["conflicting target task meaning", (input) => {
    input.generated.scopes[0].tasks.push(task("3.4", "A different planned responsibility"));
  }],
];
for (const [label, change] of invalidMoves) {
  test(`invalid task move refuses: ${label}`, () => {
    const input = fixture();
    change(input);
    refused(input);
  });
}

function completeUnit(input) {
  const unit = byId(input.previous, "scope-6");
  unit.status = "done";
  unit.tasks[0].status = "done";
  unit.record = { verified: true, receipt: "unit-original", freeze_sha: "d".repeat(64) };
  return unit;
}

test("an unchanged completed scope keeps its exact completion record", () => {
  const input = fixture();
  const oldUnit = completeUnit(input);
  const result = invoke(input);
  assert.equal(result.ok, true);
  assert.deepEqual(byId(result.workflow, "scope-6"), oldUnit);
});

const completedChanges = [
  ["name", (unit) => { unit.name = "A replacement responsibility"; }],
  ["type", (unit) => { unit.type = "test-security"; }],
  ["dependencies", (unit) => { unit.blockedBy = ["scope-1"]; }],
  ["target files", (unit) => { unit.targetFiles = ["src/replacement.ts"]; }],
  ["iteration limit", (unit) => { unit.maxIterations = 5; }],
  ["new task", (unit) => { unit.tasks.push(task("6.2", "Unverified new work")); }],
];
for (const [label, change] of completedChanges) {
  test(`a changed completed scope cannot inherit done: ${label}`, () => {
    const input = fixture();
    completeUnit(input);
    change(byId(input.generated, "scope-6"));
    refused(input);
  });
}

test("a moved pending task cannot be hidden inside an already-completed scope", () => {
  const input = fixture();
  completeUnit(input);
  input.options.taskMoves[0].toScope = "scope-6";
  refused(input);
});
