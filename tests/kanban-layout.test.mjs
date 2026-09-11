import assert from "node:assert/strict";
import { KANBAN_COLUMN_WIDTHS, kanbanGridColumns } from "../lib/kanban-layout.mjs";

assert.deepEqual(KANBAN_COLUMN_WIDTHS, {
  expanded: "minmax(240px, 320px)",
  collapsed: "56px",
}, "all boards use bounded column widths");

const columns = kanbanGridColumns(["todo", "doing", "archived"], { archived: true });
assert.equal(columns, "minmax(240px, 320px) minmax(240px, 320px) 56px", "open and collapsed columns retain their own bounds");
assert.doesNotMatch(columns, /\bfr\b/, "extra canvas space must not stretch Kanban columns");

console.log("kanban layout test ok: bounded open and collapsed columns");
