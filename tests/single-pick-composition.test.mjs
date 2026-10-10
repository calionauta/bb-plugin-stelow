import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toggleSinglePick } from "../lib/question-batch.mjs";
import { codeOf } from "./helpers/source-code.mjs";

// Single-select picks compose with custom text: toggling never clears the
// note, so merged() submits both. Split proposals keep exclusivity.
assert.deepEqual(toggleSinglePick([], "a"), ["a"]);
assert.deepEqual(toggleSinglePick(["a"], "a"), []);
assert.deepEqual(toggleSinglePick(["a", "b"], "c"), ["a", "b", "c"]);
assert.deepEqual(toggleSinglePick(["a", "b"], "a"), ["b"]);
assert.deepEqual(toggleSinglePick(undefined, "a"), ["a"]);
assert.deepEqual(toggleSinglePick(null, "a"), ["a"]);
assert.deepEqual(toggleSinglePick("a", "a"), ["a"]);
const before = ["a", "b"];
const after = toggleSinglePick(before, "c");
assert.deepEqual(before, ["a", "b"]);
assert.deepEqual(after, ["a", "b", "c"]);

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

console.log("single pick composition test ok: toggle on/off, non-array guard, others kept, pick keeps custom, split-only clear");
