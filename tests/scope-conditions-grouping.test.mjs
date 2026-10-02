import assert from "node:assert/strict";
import test from "node:test";
import { conditionSpread, groupConditionsByType, isSharedCondition } from "../lib/scope-conditions-grouping.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");

/**
 * The card that prompted this: seven done scopes, each printing the same two
 * conditions. The fixture below reproduces it exactly, because the whole
 * failure is arithmetic — 7 scopes x 2 conditions = 14 near-identical lines,
 * and the reader could act on none of them individually.
 */
function doneScope(id, name, extra = []) {
  return {
    id,
    name,
    conditions: [
      {
        type: "NoRecord",
        reason: "RecordMissing",
        message: `${name} is done with no Record — its close cannot be audit-checked.`,
      },
      {
        type: "ContractMissing",
        reason: "ContractMissing",
        message: `${name} is done with no contract — its acceptance criteria live only in prose.`,
      },
      ...extra,
    ],
  };
}

const SEVEN = [
  doneScope("scope-1", "Pure preset-kind to composer-seed mapping"),
  doneScope("scope-2", "Extract form body and preset row to clear the debt ceilings"),
  doneScope("scope-3", "The on/off worktree field in the preset editor"),
  doneScope("scope-4", "Make the kind visible in the preset list"),
  doneScope("scope-5", "Seed the composer from the preset, stabilised per dialog mount"),
  doneScope("scope-6", "Make the documented behaviour true again"),
  doneScope("scope-7", "Pin behaviour, not literals"),
];

test("seven scopes with the same conditions group into two rows, not fourteen", () => {
  const groups = groupConditionsByType(SEVEN);
  assert.equal(groups.length, 2, "one row per condition type, whatever the scope count");

  const noRecord = groups.find((g) => g.type === "NoRecord");
  const contract = groups.find((g) => g.type === "ContractMissing");
  assert.ok(noRecord && contract, "both condition types survive");

  // The property the old rendering destroyed: the count is now visible, so a
  // reader can tell a card-wide fact from a one-scope fact.
  assert.equal(conditionSpread(noRecord), 7);
  assert.equal(isSharedCondition(noRecord), true);
  assert.equal(noRecord.scopes.length, 7);
  assert.ok(noRecord.scopes.includes("Pin behaviour, not literals"), "names the scopes it applies to");
});

test("a condition that applies to one scope keeps that scope's own wording", () => {
  const entries = [
    {
      id: "scope-1",
      name: "Rebuild the scope map",
      conditions: [{
        type: "BlockedByOpen",
        message: "Rebuild the scope map waits on unfinished trackable(s): scope-2 — start them first.",
      }],
    },
    { id: "scope-2", name: "Group the conditions", conditions: [] },
  ];
  const groups = groupConditionsByType(entries);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].scopes.length, 1);
  assert.equal(groups[0].message, "Rebuild the scope map waits on unfinished trackable(s): scope-2 — start them first.");
  assert.equal(isSharedCondition(groups[0]), false);
});

test("a scope carrying one type twice is one scope with that condition", () => {
  // blockedBy and dependsOn can both raise the same type. Rendering the scope
  // twice would overstate the spread and mislead the count.
  const entries = [{
    id: "scope-1",
    name: "One scope",
    conditions: [
      { type: "BlockedByOpen", message: "first" },
      { type: "BlockedByOpen", message: "second" },
    ],
  }];
  const groups = groupConditionsByType(entries);
  assert.equal(groups.length, 1);
  assert.equal(conditionSpread(groups[0]), 1, "counted once, not twice");
  assert.equal(groups[0].scopes.length, 1);
});

test("scopes keep the caller's order, and groups keep first appearance", () => {
  const entries = [
    { id: "scope-3", name: "Third", conditions: [{ type: "B", message: "b3" }] },
    { id: "scope-1", name: "First", conditions: [{ type: "A", message: "a1" }] },
    { id: "scope-2", name: "Second", conditions: [{ type: "A", message: "a2" }, { type: "B", message: "b2" }] },
  ];
  const groups = groupConditionsByType(entries);
  assert.deepEqual(groups.map((g) => g.type), ["B", "A"], "first appearance, not alphabetical");
  assert.deepEqual(groups.find((g) => g.type === "A").scopes, ["First", "Second"], "caller order, not re-sorted");
});

test("a scope with no conditions contributes no row", () => {
  const groups = groupConditionsByType([
    { id: "scope-1", name: "Quiet", conditions: [] },
    { id: "scope-2", name: "Noisy", conditions: [{ type: "X", message: "x" }] },
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].scopes, ["Noisy"]);
});

test("malformed input answers empty rather than throwing", () => {
  for (const bad of [null, undefined, "nope", 42, {}]) {
    assert.deepEqual(groupConditionsByType(bad), []);
  }
  // Entries with misshapen conditions are skipped, not fatal.
  const groups = groupConditionsByType([
    { id: "scope-1", name: "Odd", conditions: "not-an-array" },
    { id: "scope-2", name: "Also odd", conditions: [null, "x", 7, { noType: true }] },
  ]);
  assert.deepEqual(groups, []);
  assert.equal(conditionSpread(null), 0);
  assert.equal(isSharedCondition(undefined), false);
});

// ---------------------------------------------------------------------------
// The grouping has to be WIRED, not merely available.
//
// `tests/scope-conditions-grouping.test.mjs` exercises the lib's output, which
// is exactly why a card could show twenty-one identical condition lines while
// every assertion here passed: nothing checked that the scope list asked the lib
// for its answer. Replacing the call with an empty set made shared conditions
// revert to per-scope repetition — the original defect — and all five guards
// stayed green.
//
// So this asserts the wiring: the list derives its shared-condition types from
// the lib, and the card renders what that helper returns.
// ---------------------------------------------------------------------------

const listSource = readFileSync(join(root, "components", "detail", "scopes-list.tsx"), "utf8");
const relationsSource = readFileSync(join(root, "components", "detail", "scope-relations.tsx"), "utf8");

test("the scope list derives its shared-condition types from the lib", () => {
  assert.match(
    listSource,
    /sharedConditionTypesFor\(scopes\)/,
    "the list asks the helper for its shared-condition types; an inline empty set here would "
    + "silently restore one condition line per scope while every lib test still passed",
  );
  assert.match(
    relationsSource,
    /groupConditionsByType\(scopes\)\.filter\(isSharedCondition\)/,
    "the helper itself groups by condition type, so the per-scope repetition cannot come back "
    + "through a second code path",
  );
});

test("the card renders the grouped conditions once, not per scope", () => {
  // The grouped block lives outside every ScopeRow; a per-scope render would
  // put `evidenceConditions` back inside the loop.
  assert.match(
    relationsSource,
    /function ScopeConditions/,
    "the grouped conditions are their own component",
  );
  assert.doesNotMatch(
    listSource,
    /scope\.conditions\.map\(/,
    "the scope body must not iterate its own conditions — that is the fourteen-line wall",
  );
});
