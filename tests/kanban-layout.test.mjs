import assert from "node:assert/strict";
import {
  KANBAN_COLUMN_WIDTHS,
  kanbanGridColumns,
  toggleFilterValue,
  matchesFilterValue,
} from "../lib/kanban-layout.mjs";

assert.deepEqual(KANBAN_COLUMN_WIDTHS, {
  expanded: "minmax(240px, 320px)",
  collapsed: "56px",
  mobileExpanded: "min(85vw, 320px)",
}, "all boards use bounded column widths, with a deliberate phone track beside them");

const columns = kanbanGridColumns(["inbox", "doing", "archived"], { archived: true });
assert.equal(columns, "minmax(240px, 320px) minmax(240px, 320px) 56px", "open and collapsed columns retain their own bounds");
assert.doesNotMatch(columns, /\bfr\b/, "extra canvas space must not stretch Kanban columns");

assert.deepEqual(toggleFilterValue([], "a"), ["a"], "empty toggles on");
assert.deepEqual(toggleFilterValue(["a", "b"], "a"), ["b"], "present toggles off, order kept");
assert.deepEqual(toggleFilterValue(null, "a"), ["a"], "junk toggles on");
assert.equal(matchesFilterValue([], "a"), true, "empty matches everything");
assert.equal(matchesFilterValue(["a"], "a"), true, "membership matches");
assert.equal(matchesFilterValue(["a"], "b"), false, "absence filters");
assert.equal(matchesFilterValue(null, "a"), true, "junk matches everything");

console.log("kanban layout test ok: bounded columns and research panel state");
