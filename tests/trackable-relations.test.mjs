import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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

// Wiring pins: advance refuses cycles loud, done refuses open children on
// closed scopes — both name the fix instead of stalling or certifying.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
assert.match(server, /dependencyCycles\(buildRegistry\(/, "advance checks the registry graph");
assert.match(server, /blockedBy cycle detected/, "cycles refuse naming the loop");
assert.match(server, /canStart\(entryRegistry/, "advance names unstartable ordering without a cycle");
assert.match(server, /canClose\(/, "done checks containment through the registry");
assert.match(server, /a scope closes only when its tasks do/, "containment refuses with the marking redirect");
assert.match(server, /mergePlanned: false/, "done gates read tracked truth — the planned merge is display-only");

console.log("trackable relations test ok: registry, edges, cycles, ordering, containment, wiring");
