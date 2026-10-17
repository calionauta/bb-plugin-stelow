import assert from "node:assert/strict";
import {
  PREVIEW_START_TIMEOUT_MS,
  createPreviewRuntime,
} from "../lib/preview-runtime.mjs";

// Preview wiring: the lifecycle itself lives in lib/preview-runtime and is
// driven for real by preview-runtime.test.mjs. What remains here are the
// invariants only the host wiring can break: the runtime constructs from
// injected effects alone, and a start that never announces an address fails
// instead of sitting in "Starting…" forever.
assert.equal(PREVIEW_START_TIMEOUT_MS, 60_000, "a silent dev server fails after 60s, never spins forever");
assert.equal(typeof createPreviewRuntime, "function", "the host builds the runtime from effects");

const runtime = createPreviewRuntime({
  readFile: async () => null,
  listDirs: () => [],
  joinPath: (...parts) => parts.join("/"),
  spawnProcess: () => { throw new Error("no process in wiring test"); },
  runConnect: async () => null,
  now: () => 0,
  baseEnv: {},
});
assert.equal(typeof runtime.start, "function", "the constructed runtime exposes start");
assert.equal(typeof runtime.stop, "function", "the constructed runtime exposes stop");
assert.equal(typeof runtime.view, "function", "the constructed runtime exposes view");
assert.equal(typeof runtime.dispose, "function", "the constructed runtime exposes dispose for the plugin lifetime");

console.log("preview wiring test ok: host effects injected, start timeout bounded, dispose exposed");
