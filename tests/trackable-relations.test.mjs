import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRegistry,
  edgesOf,
  childrenOf,
  danglingEdges,
  dependencyCycles,
  canStart,
  openChildren,
  openDependencies,
  canClose,
} from "../lib/trackable-relations.mjs";
import { isDoneStatus } from "../lib/trackables.mjs";
import { advanceExecutionGates, doneBuildGates } from "../lib/build-gates.mjs";
import { createAdvancePreflight } from "../server/execution-advance-preflight.ts";
import { auditableBuildDone, callsNamed, cliHarness } from "./helpers/cli-harness.mjs";

const scopes = [
  { id: "scope-1", kind: "scope", status: "done", tasks: [{ id: "scope-1-t1", name: "a", status: "done" }] },
  { id: "scope-2", kind: "scope", status: "pending", blockedBy: ["scope-1"], tasks: [{ id: "scope-2-t1", name: "b", status: "pending" }] },
  { id: "scope-3", kind: "scope", status: "pending", blockedBy: ["scope-2", "scope-9"], dependsOn: ["scope-1"], tasks: [] },
];

// The registry flattens writer nesting: scopes register with task children,
// tasks resolve beside scopes — one id space for every kind.
const registry = buildRegistry(scopes);
assert.equal(registry.get("scope-2").kind, "scope", "scopes register as scopes");
assert.equal(registry.get("scope-2-t1").kind, "task", "nested tasks register as tasks");
assert.deepEqual(registry.get("scope-2").children, ["scope-2-t1"], "containment is structural");
assert.deepEqual(childrenOf(registry.get("scope-2"), registry).map((task) => task.name), ["b"], "children resolve");
assert.deepEqual(buildRegistry(null).size, 0, "junk builds empty");
assert.equal(buildRegistry([{ id: "a", status: "done" }, { id: "a", status: "pending" }]).get("a").status, "done", "duplicate ids keep first, never overwrite");
assert.ok(buildRegistry([{ id: "scope-1", tasks: [{ id: "3.1", name: "x", status: "pending" }] }]).has("3.1"), "dotted task ids register");
assert.equal(buildRegistry([{ id: "scope-1", status: "done", tasks: [] }], { defaultKind: "scope" }).get("scope-1").kind, "scope", "defaultKind names kindless entries");
assert.equal(buildRegistry([{ id: "scope-1", status: "done", tasks: [] }]).get("scope-1").kind, "trackable", "no default keeps bare trackables");

// Edges read blockedBy first, dependsOn second; unknown fields read empty.
assert.deepEqual(edgesOf(registry.get("scope-3")), ["scope-2", "scope-9", "scope-1"], "edges union both fields");
assert.deepEqual(edgesOf(null), [], "junk reads edgeless");

// Dangling warns (plans may span files); cycles refuse. Both name their ends.
assert.deepEqual(danglingEdges(registry), [{ from: "scope-3", to: "scope-9" }], "dangling names from and to");
assert.deepEqual(dependencyCycles(registry), [], "acyclic graphs pass");
assert.deepEqual(
  dependencyCycles(buildRegistry([
    { id: "scope-1", blockedBy: ["scope-2"] },
    { id: "scope-2", blockedBy: ["scope-1"] },
  ])),
  [["scope-1", "scope-2", "scope-1"]],
  "cycles name the loop for the refusal",
);
assert.deepEqual(dependencyCycles(buildRegistry([{ id: "scope-1", blockedBy: ["scope-1"] }])), [["scope-1", "scope-1"]], "self-loops count");

// Ordering is contractual: start needs finished deps, close needs no open children.
assert.equal(canStart(registry, "scope-2", isDoneStatus), true, "finished deps unblock start");
assert.equal(canStart(registry, "scope-3", isDoneStatus), false, "open deps block start");
assert.equal(canStart(registry, "scope-9", isDoneStatus), false, "unknown ids never start");
assert.equal(canStart(null, "scope-2", isDoneStatus), false, "junk registries never start");
assert.deepEqual(openDependencies(registry.get("scope-3"), registry, isDoneStatus), ["scope-2"], "open deps list known unfinished blockers (dangling excluded)");
assert.deepEqual(openChildren(registry.get("scope-2"), registry).map((task) => task.name), ["b"], "open children list by name");
assert.equal(openChildren(registry.get("scope-1"), registry).length, 0, "finished children are not open");
assert.equal(canClose(registry.get("scope-1"), registry), true, "childless-done closes");
assert.equal(canClose(registry.get("scope-2"), registry), false, "open children block close");
assert.equal(canClose(null, registry), false, "junk never closes");

// Wiring: advance refuses cycles loud, done refuses open children on closed
// scopes — both name the fix instead of stalling or certifying. Driven through
// the real entry points, so a rename or a comment cannot satisfy them.

// The refusals the two gates produce, called with the shape that triggers them.
assert.match(
  advanceExecutionGates({ kind: "build", stage: "execution", syncedCount: 2, cycles: [["scope-1", "scope-2", "scope-1"]] })?.refusal ?? "",
  /blockedBy cycle detected/,
  "cycles refuse naming the loop",
);
assert.match(
  doneBuildGates({
    kind: "build",
    stage: "audit",
    scopes: [{ id: "scope-1", name: "Pay", kind: "scope", status: "done", tasks: [{ id: "t1", name: "Fix", kind: "task", status: "pending" }] }],
  }) ?? "",
  /a scope closes only when its tasks do/,
  "containment refuses with the marking redirect",
);

/** An advance preflight over a real workspace whose tracked scopes carry the
 * shape under test, so the assertion is about the crossing the preflight makes
 * (compute cycles, compute startability) and not only the pure gate. */
function advanceWorkspace(trackedScopes) {
  const root = mkdtempSync(join(tmpdir(), "stelow-relations-"));
  writeFileSync(join(root, "stelow.json"), JSON.stringify({
    workflows: [{ workflowId: "card_1", created: "2026-09-24T00:00:00.000Z", dirHash: "hash1", scopes: trackedScopes }],
  }));
  const preflight = createAdvancePreflight({
    db: { prepare: () => ({ get: () => undefined, all: () => [], run: () => undefined }) },
    runHelper: async () => ({ code: 0, stdout: "{}", stderr: "" }),
    native: { resolveStageExecutionRoute: async () => ({ route: { mode: "coordinator-sequential" } }) },
    reworkNote: async () => "",
    recordExecutionEntry: () => {},
    scopeMapApproved: async () => true,
  });
  return {
    run: () => preflight.prepareAdvance({
      card: { id: "card_1", kind: "build", stage: "execution", intent: "feature" },
      stage: "execution",
      rootPath: root,
      stateDir: null,
      dryRun: false,
      includeRework: false,
    }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const cyclic = advanceWorkspace([
  { id: "scope-1", name: "A", status: "pending", blockedBy: ["scope-2"] },
  { id: "scope-2", name: "B", status: "pending", blockedBy: ["scope-1"] },
]);
try {
  const result = await cyclic.run();
  assert.match(result.error ?? "", /blockedBy cycle detected/, "advance checks the registry graph and refuses the cycle");
} finally {
  cyclic.cleanup();
}

const unstartable = advanceWorkspace([
  { id: "scope-1", name: "A", status: "in-progress" },
  { id: "scope-2", name: "B", status: "pending", blockedBy: ["scope-1"] },
]);
try {
  const result = await unstartable.run();
  assert.ok(!("error" in result), "an acyclic graph is not refused");
  assert.match(result.note ?? "", /no scope can start/, "and the preflight names unstartable ordering without a cycle");
} finally {
  unstartable.cleanup();
}

/** A workspace whose tracking entry owns the card and whose scopes are the
 * tracked truth the done gate reads. An optional spec-tech file supplies the
 * read-time planned merge the done path must ignore. */
function doneWorkspace(trackedScopes, spec = null) {
  const root = mkdtempSync(join(tmpdir(), "stelow-done-relations-"));
  writeFileSync(join(root, "stelow.json"), JSON.stringify({
    workflows: [{ workflowId: "card_1", created: "2026-09-24T00:00:00.000Z", dirHash: "hash1", scopes: trackedScopes }],
  }));
  if (spec) {
    const plans = join(root, ".stelow", "2026-09-24", "hash1", "plans");
    mkdirSync(plans, { recursive: true });
    writeFileSync(join(plans, "spec-tech_v1.md"), spec);
  }
  return root;
}

const blockedRoot = doneWorkspace([
  { id: "scope-1", name: "Pay", status: "done", tasks: [{ id: "t1", name: "Fix", status: "pending" }] },
]);
try {
  const { invoke, calls } = cliHarness(auditableBuildDone({ workspacePath: blockedRoot }));
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 1, "an open child on a done scope blocks completion");
  assert.match(result.stderr, /a scope closes only when its tasks do/);
  assert.deepEqual(
    callsNamed(calls, "updateCard").map(([, , fields]) => fields.status),
    [],
    "and the card never completes",
  );
} finally {
  rmSync(blockedRoot, { recursive: true, force: true });
}

// done gates read tracked truth (mergePlanned: false): a task that exists only
// in the spec's planned merge does not gate. Under the display merge, that
// planned task would appear as an open child and block a card whose tracked
// scopes are finished.
const plannedSpec = "### SCOPE-1: Pay\n\n| # | Task | Done Criterion |\n|---|---|---|\n| 1.1 | Planned task | Plan criterion |\n";
const plannedRoot = doneWorkspace([{ id: "scope-1", name: "Pay", status: "done", tasks: [] }], plannedSpec);
try {
  const { invoke } = cliHarness(auditableBuildDone({ workspacePath: plannedRoot }));
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 0, `the planned merge is display-only: ${result.stderr}`);
} finally {
  rmSync(plannedRoot, { recursive: true, force: true });
}

console.log("trackable relations test ok: registry, edges, cycles, ordering, containment, wiring");
