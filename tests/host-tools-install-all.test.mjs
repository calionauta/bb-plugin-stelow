import assert from "node:assert/strict";
import { installAllTools, missingToolIds } from "../lib/host-tools.mjs";

// `missingToolIds` reads panel order: every absent id, in the order probed.
assert.deepEqual(
  missingToolIds([
    { id: "ast-grep", present: true },
    { id: "cymbal", present: false },
    { id: "ripwire", present: true },
    { id: "sem", present: false },
    { id: "xerj", present: false },
  ]),
  ["cymbal", "sem", "xerj"],
  "absent ids come back in panel order",
);
assert.deepEqual(
  missingToolIds([{ id: "cymbal" }, { id: "ripwire", present: null }]),
  ["cymbal", "ripwire"],
  "an unknown probe reads as absent, never as present",
);
assert.deepEqual(
  missingToolIds([
    { id: "ast-grep", present: true },
    { id: "cymbal", present: true },
  ]),
  [],
  "all present installs nothing",
);
for (const junk of [null, undefined, 42, "tools", {}, []]) {
  assert.deepEqual(missingToolIds(junk), [], `${String(junk)} installs nothing`);
}

// `installAllTools` installs in panel order and never throws: one refused
// installer must not hide the tools behind it, and an unknown id dispatches
// nothing at all.
{
  const calls = [];
  const result = await installAllTools(
    async (id) => {
      calls.push(id);
      return { ok: true, version: `${id} 1.0`, log: "installed" };
    },
    ["ast-grep", "cymbal"],
  );
  assert.deepEqual(calls, ["ast-grep", "cymbal"], "installs run in the order given");
  assert.deepEqual(result, { ok: ["ast-grep", "cymbal"], failed: {} }, "all-ok resolves with no failures");
}
{
  const calls = [];
  const result = await installAllTools(
    async (id) => {
      calls.push(id);
      if (id === "cymbal") throw new Error("broken pipe");
      return { ok: true, version: `${id} 1.0`, log: "installed" };
    },
    ["ast-grep", "cymbal", "ripwire"],
  );
  assert.deepEqual(calls, ["ast-grep", "cymbal", "ripwire"], "a throw does not stop the loop");
  assert.deepEqual(result.ok, ["ast-grep", "ripwire"], "the survivors still resolve as ok");
  assert.equal(result.failed.cymbal, "broken pipe", "a throwing call is recorded, not thrown");
}
{
  const result = await installAllTools(
    async (id) => {
      if (id === "sem") return Promise.reject(new Error("Download failed."));
      return { ok: true, version: `${id} 1.0`, log: "installed" };
    },
    ["sem", "xerj"],
  );
  assert.deepEqual(result.ok, ["xerj"], "a rejection does not stop the loop");
  assert.equal(result.failed.sem, "Download failed.", "a rejection is recorded under its id");
}
{
  const calls = [];
  const result = await installAllTools(
    async (id) => {
      calls.push(id);
      if (id === "sem") return { ok: false, version: null, log: "boom" };
      if (id === "ripwire") return { ok: false, version: null };
      if (id === "xerj") return null;
      return { ok: true, version: `${id} 1.0`, log: "installed" };
    },
    ["sem", "ripwire", "xerj", "cymbal"],
  );
  assert.deepEqual(result.ok, ["cymbal"], "falsy results never read as ok");
  assert.equal(result.failed.sem, "boom", "an installer log survives");
  assert.equal(result.failed.ripwire, "Install failed.", "a log-less refusal gets the stable fallback");
  assert.equal(result.failed.xerj, "Install failed.", "a null result gets the stable fallback");
  assert.ok(!calls.includes("unexpected"), "unknown ids dispatch nothing");
}
{
  const calls = [];
  const result = await installAllTools(
    async (id) => {
      calls.push(id);
      return { ok: true, version: `${id} 1.0`, log: "installed" };
    },
    ["ast-grep", "unexpected", "cymbal"],
  );
  assert.deepEqual(calls, ["ast-grep", "cymbal"], "unknown ids are skipped, not dispatched");
  assert.deepEqual(result, { ok: ["ast-grep", "cymbal"], failed: {} }, "unknown ids leave no trace");
}

console.log("host tools install-all ok: order, per-tool failure, unknown skip, and never-throw hold");
