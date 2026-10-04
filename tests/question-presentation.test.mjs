import assert from "node:assert/strict";
import { OPTION_DESCRIPTION_PREVIEW_LIMIT, splitOptionDescriptionPreview } from "../lib/question-presentation.mjs";

// Short descriptions render inline, untouched — the collapse must never eat
// a decision that already fits at a glance.
const short = "Wait for the other thread to land, then retry.";
assert.deepEqual(
  splitOptionDescriptionPreview(short),
  { head: short, tail: null },
  "short descriptions pass through with nothing collapsed",
);

// A 4-option question at 150+ characters per description is a wall nobody
// reads before picking. The head stays visible, the rest is one click away,
// and head plus tail lose none of the original text.
const long = "Wait for the other thread to commit its work in progress. "
  + "I stop touching the shared checkout entirely and retry verify plus done "
  + "once their WIP lands or they fix the stale pin in the kanban layout test. "
  + "Safest of all: never touch another live thread's files. May take a while, "
  + "and I cannot tell when it lands.";
assert.ok(long.length > OPTION_DESCRIPTION_PREVIEW_LIMIT, "the fixture really exceeds the preview limit");
const split = splitOptionDescriptionPreview(long);
assert.ok(split.tail !== null, "long descriptions collapse");
assert.ok(split.head.length < long.length && split.head.length > 0, "the head is a strict prefix view, not empty and not everything");
assert.ok(long.startsWith(split.head.slice(0, 40)), "the head comes from the description start, not invented text");
assert.ok(long.endsWith(split.tail.slice(-40)), "the tail reaches the description end — nothing is dropped");
assert.ok(split.head.length >= OPTION_DESCRIPTION_PREVIEW_LIMIT / 2, "the visible head stays substantial, never a degenerate stub");
assert.deepEqual(
  splitOptionDescriptionPreview(null),
  { head: "", tail: null },
  "non-string descriptions degrade to empty instead of throwing",
);

console.log("question presentation test ok: long option descriptions collapse without losing text");
