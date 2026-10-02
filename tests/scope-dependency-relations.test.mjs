import assert from "node:assert/strict";
import test from "node:test";
import { DEPENDENCY_STATE, dependencyRow, dependencyRows, missingDependencyRows } from "../lib/scope-dependency-relations.mjs";

/**
 * A scope's dependencies, said in words.
 *
 * The rows these replace were a wrapping line of pills reading "after <name>".
 * Two defects made the graph unreadable, and both are pinned here by the
 * property that fixes them rather than by a string:
 *
 * 1. A satisfied dependency and an unsatisfied one rendered the same string,
 *    so the state was carried by colour alone. So a state that is not visible
 *    as a word is a failure here.
 * 2. `blocked by` was permanently amber because the finished() check was
 *    consulted on one branch and not the other, so a long-satisfied dependency
 *    still looked like a live block. So both kinds must derive state the same
 *    way.
 */

const SCOPES = new Map([
  ["scope-1", { id: "scope-1", name: "Seed the composer", status: "done" }],
  ["scope-2", { id: "scope-2", name: "Make the kind visible", status: "in-progress" }],
  ["scope-3", { id: "scope-3", name: "Pin behaviour", status: "pending" }],
]);

test("a satisfied dependency and a waiting one read differently, in words alone", () => {
  const satisfied = dependencyRow({ from: "scope-3", to: "Seed the composer", targetStatus: "done" });
  const waiting = dependencyRow({ from: "scope-3", to: "Pin behaviour", targetStatus: "pending" });

  assert.equal(satisfied.state, "satisfied");
  assert.equal(waiting.state, "waiting");
  // The point of the change: no styling required to tell them apart.
  assert.notEqual(satisfied.text, waiting.text, "state is in the text, not only in the colour");
  assert.match(satisfied.text, /done/);
  assert.match(waiting.text, /not started/);
});

test("an explicit block derives its state exactly like an ordering edge", () => {
  // The regression: blocked by was always amber, so a satisfied block still
  // looked live. Both kinds go through the same derivation now.
  const block = dependencyRow({ from: "scope-3", to: "Seed the composer", kind: "blocked-by", targetStatus: "done" });
  const order = dependencyRow({ from: "scope-3", to: "Seed the composer", kind: "depends-on", targetStatus: "done" });
  assert.equal(block.state, "satisfied", "a satisfied block is not a live block");
  assert.equal(block.state, order.state, "both kinds read the target's status the same way");
  assert.match(block.text, /^waits on /, "the relation names its direction");
  assert.match(order.text, /^after /);
});

test("a running target is distinguishable from both a done and a waiting one", () => {
  const running = dependencyRow({ from: "scope-3", to: "Make the kind visible", targetStatus: "in-progress" });
  assert.equal(running.state, "running");
  assert.match(running.text, /running/);
  const states = new Set([
    dependencyRow({ to: "a", targetStatus: "done" }).state,
    dependencyRow({ to: "b", targetStatus: "in-progress" }).state,
    dependencyRow({ to: "c", targetStatus: "pending" }).state,
  ]);
  assert.equal(states.size, 3, "three live states, three words");
});

test("a target that is not on the card stays visible as missing", () => {
  // Missing is decided by ABSENCE, so it is the rows builder (which holds the
  // map) that can say it. A bare row with a name but no status is a target
  // whose state is unknown, which is a different thing entirely.
  const rows = dependencyRows({ from: "scope-3", dependsOn: ["scope-1", "scope-9"], scopeById: SCOPES });
  assert.equal(missingDependencyRows(rows).length, 1, "a broken edge is shown, not filtered away");
  assert.equal(rows.length, 2, "the good edge is not dropped because a bad one exists");
  // A present target is named; an absent one keeps its id, because the id is
  // all there is to say and a reader can act on it.
  assert.equal(rows[0].to, "Seed the composer", "a present target is named, not shown as an id");
  assert.equal(rows[0].state, "satisfied");
  assert.equal(rows[1].to, "scope-9", "an absent target keeps its id");
  assert.equal(rows[1].state, "missing");
  assert.match(rows[1].text, /not on this card/);
});

test("a target on the card with an unknown status is waiting, not missing", () => {
  // Calling it missing would send a reader hunting a broken edge that does not
  // exist. Absent and not-yet-told are different faults.
  const rows = dependencyRows({ from: "scope-3", dependsOn: ["scope-1"], scopeById: new Map([["scope-1", { name: "Seed", status: null }]]) });
  assert.equal(rows[0].state, "waiting");
  assert.equal(missingDependencyRows(rows).length, 0);
});

test("rows keep the caller's order: ordering edges first, then blocks", () => {
  const rows = dependencyRows({ from: "scope-3", dependsOn: ["scope-2", "scope-1"], blockedBy: ["scope-3"], scopeById: SCOPES });
  assert.deepEqual(
    rows.map((r) => r.to),
    ["Make the kind visible", "Seed the composer", "Pin behaviour"],
    "targets are named, in the caller's order",
  );
  assert.deepEqual(rows.map((r) => r.kind), ["depends-on", "depends-on", "blocked-by"]);
});

test("every state has a word and a glyph, and no state is colour-only", () => {
  for (const [name, info] of Object.entries(DEPENDENCY_STATE)) {
    assert.ok(info.label && info.label.length > 0, `${name} has a word`);
    assert.ok(info.glyph && info.glyph.length > 0, `${name} has a glyph`);
    assert.ok(["muted", "active", "warn"].includes(info.tone), `${name} has a known tone`);
  }
});

test("malformed input answers a row rather than throwing", () => {
  for (const bad of [undefined, null, {}, 42]) {
    const row = dependencyRow(bad);
    // No name to show at all, so it is a missing target and says so.
    assert.equal(row.state, "missing");
    assert.equal(typeof row.text, "string");
  }
  // A name with no status is a target whose state is unknown, which is
  // "waiting" — not missing, because the target plainly exists.
  assert.equal(dependencyRow({ to: "Seed the composer", targetStatus: null }).state, "waiting");
  assert.deepEqual(dependencyRows({}), []);
  assert.deepEqual(dependencyRows({ from: "s", dependsOn: null, blockedBy: null }), []);
  assert.deepEqual(dependencyRows(null), []);
  assert.deepEqual(missingDependencyRows(null), []);
});
