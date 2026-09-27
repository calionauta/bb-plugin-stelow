import assert from "node:assert/strict";
import { describeBoardFilter } from "../lib/board-filter-label.mjs";

/**
 * The Archived column's "delete all" acts on exactly what the active filter
 * resolved, so the confirmation must name that filter. "Delete all?" is a lie
 * the moment a filter is on: the reader cannot tell an intentional narrow delete
 * from a wide one before confirming something irreversible.
 */

// Nothing set: say so plainly, so "all cards" is a claim the reader can check.
assert.equal(describeBoardFilter({}), "all cards", "an unfiltered board says all cards");
assert.equal(describeBoardFilter(null), "all cards", "a missing filter object is still describable");
assert.equal(
  describeBoardFilter({ projectIds: [], stages: [], intents: [], statuses: [], activities: [], attention: false }),
  "all cards",
  "empty arrays are not a filter — an empty projectIds array must not read as a filter that matched nothing",
);

// One part: named, with the caller's display name where it has one.
assert.equal(describeBoardFilter({ intents: ["refactor"] }, { refactor: "Refactor" }), "type: Refactor", "a single type filter is named");
assert.equal(describeBoardFilter({ intents: ["refactor"] }), "type: refactor", "and falls back to the raw value when no label exists");
assert.equal(describeBoardFilter({ attention: true }), "needs attention", "the attention toggle is a filter like any other");
assert.equal(describeBoardFilter({ stages: ["selection"] }, { selection: "Selection" }), "stage: Selection");

// Several parts: joined, in a fixed order, so the same filter always reads the
// same way and a reader learns to scan it.
assert.equal(
  describeBoardFilter({ intents: ["refactor"], statuses: ["archived"], stages: ["setup"] }),
  "type: refactor · stage: setup · status: archived",
  "parts join in a stable order rather than object key order",
);
assert.equal(
  describeBoardFilter({ statuses: ["archived"], intents: ["refactor"] }),
  "type: refactor · status: archived",
  "declaration order, not key order, so the label is deterministic",
);

// Multiple values in one part are all named — a filter matching two projects is
// a different blast radius from one matching a single project.
assert.equal(
  describeBoardFilter({ projectIds: ["p1", "p2"] }, { p1: "Alpha", p2: "Beta" }),
  "project: Alpha, Beta",
  "every selected value is named, not just the first",
);

// Junk must not produce a filter nobody set, nor throw.
for (const [label, value] of [["null", null], ["a number", 7], ["an empty string", ""], ["an object", {}]]) {
  assert.equal(describeBoardFilter({ intents: value }), "all cards", `${label} in a filter part is not a filter`);
}
assert.equal(describeBoardFilter({ intents: "refactor" }), "all cards", "a bare string is not a list of selected values");
assert.equal(describeBoardFilter({ projectIds: ["p1", 7, ""] }, { p1: "Alpha" }), "project: Alpha", "non-strings and blanks are dropped, real ones kept");

console.log("board filter label test ok: the confirmation names the filter the delete will act on");
