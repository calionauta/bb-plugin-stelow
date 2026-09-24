import assert from "node:assert/strict";
import {
  beginToolInstall,
  clearToolError,
  finishToolInstall,
  mergeToolStatuses,
} from "../lib/host-tools.mjs";

const errors = { cymbal: "old failure", ripwire: "other failure" };
assert.deepEqual(beginToolInstall(errors, "cymbal"), { ripwire: "other failure" });
assert.deepEqual(clearToolError(errors, "ripwire"), { cymbal: "old failure" });
assert.deepEqual(beginToolInstall(errors, "sem"), errors, "an absent key preserves identity");

assert.deepEqual(
  finishToolInstall({}, "ripwire", new Error("install timed out")),
  { ripwire: "install timed out" },
);
assert.deepEqual(
  finishToolInstall({}, "cymbal", "broken pipe"),
  { cymbal: "broken pipe" },
  "non-Error rejections get a stable user-facing fallback",
);

const previous = [{ id: "ast-grep", present: false, version: null }];
const next = [
  { id: "cymbal", present: true, version: "1.2.3" },
  { id: "ripwire", present: false, version: null },
];
assert.deepEqual(mergeToolStatuses(previous, next), next);
assert.deepEqual(mergeToolStatuses(previous, [{ id: "unknown", present: true }]), previous);
assert.deepEqual(mergeToolStatuses(previous, []), previous, "an empty probe cannot erase known status");
assert.deepEqual(mergeToolStatuses(null, next), next);

console.log("host tools test ok: error lifecycle and resilient status refresh");
