import assert from "node:assert/strict";
import {
  HOST_TOOL_IDS,
  HOST_TOOLS,
  beginToolInstall,
  clearToolError,
  finishToolInstall,
  mergeToolStatuses,
} from "../lib/host-tools.mjs";

// One vocabulary, two halves. The panel shows `HOST_TOOLS`; the installer and
// the probe accept `HOST_TOOL_IDS`. A row that cannot install and a tool that
// cannot be seen are both silent failures, so the halves are asserted equal
// rather than assumed to stay in step.
assert.deepEqual(
  HOST_TOOLS.map((tool) => tool.id),
  [...HOST_TOOL_IDS],
  "the panel shows exactly the installable vocabulary, in one order",
);
assert.equal(new Set(HOST_TOOL_IDS).size, HOST_TOOL_IDS.length, "no tool is listed twice");
for (const tool of HOST_TOOLS) {
  assert.ok(tool.id === tool.name, `${tool.id} names itself`);
  assert.ok(tool.plain.trim().length > 0, `${tool.id} explains itself in plain words`);
  assert.ok(tool.tech.trim().length > 0, `${tool.id} says what it is for technically`);
  assert.match(tool.repo, /^https:\/\/github\.com\//, `${tool.id} links a repository`);
  assert.ok(tool.install.trim().length > 0, `${tool.id} shows the human install command`);
  assert.ok(finishToolInstall({}, tool.id, "boom")[tool.id], `${tool.id} accepts an install error`);
}

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
