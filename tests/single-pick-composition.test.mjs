import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toggleSinglePick } from "../lib/question-batch.mjs";
import { codeOf } from "./helpers/source-code.mjs";

// Single-select picks are EXCLUSIVE (issue #383): a radio group may hold one
// label, so picking a second replaces the first, and re-picking the current
// one clears it. Picks still compose with custom text — toggling never clears
// the note, and merged() submits both. Split proposals keep their own rule.
assert.deepEqual(toggleSinglePick([], "a"), ["a"]);
assert.deepEqual(toggleSinglePick(["a"], "a"), []);
assert.deepEqual(toggleSinglePick(["a", "b"], "c"), ["c"]);
assert.deepEqual(toggleSinglePick(["a", "b"], "a"), []);
assert.deepEqual(toggleSinglePick(undefined, "a"), ["a"]);
assert.deepEqual(toggleSinglePick(null, "a"), ["a"]);
assert.deepEqual(toggleSinglePick("a", "a"), ["a"]);
const before = ["a", "b"];
const after = toggleSinglePick(before, "c");
assert.deepEqual(before, ["a", "b"], "the input array is never mutated in place");
assert.deepEqual(after, ["c"], "replacing means the previous pick is dropped, not kept");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const conversation = readFileSync(join(root, "components", "conversation", "question-batch.tsx"), "utf8");
const pickBody = conversation.slice(
  conversation.indexOf("const pick = (question: BatchItem"),
  conversation.indexOf("const typeCustom"),
);
assert.match(
  pickBody,
  /toggleSinglePick\(prev\[question\.id\], label\)/,
  "single-select pick path toggles through the lib helper",
);
assert.doesNotMatch(
  codeOf(pickBody),
  /setCustom/,
  "single-select pick path never touches custom text",
);
assert.match(
  conversation,
  /if \(value\.trim\(\) && isSplitQuestion\(question\)\) setSelected/,
  "typing custom text clears picks only for split questions",
);

console.log("single pick composition test ok: exclusive replacement, deselect, non-array guard, pick keeps custom, split-only clear");
