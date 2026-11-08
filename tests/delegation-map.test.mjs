import assert from "node:assert/strict";
import { getDelegationSite, assertDisposableSpawn } from "../lib/delegation-map.mjs";

// Registry reads: every site names tier, preset source, spawn path,
// write behavior, and judge. Unknown sites refuse before any SDK call.
assert.equal(getDelegationSite("draft-burst").tier, "generation", "drafts resolve");
assert.equal(getDelegationSite("worker-spawn").spawn, "direct", "workers route by cascade, documented here");
assert.throws(() => getDelegationSite("teleport"), /Register it in lib\/delegation-map\.mjs/, "unknown sites fail fast with the fix");

// Guardrails: hidden visibility, never full permission, real args object,
// disposable sites only. Each is a live invariant of every disposable
// spawn — removing one fails here before a worker's internals leak.
const hiddenReadOnly = { visibility: "hidden", permissionMode: "accept-edits" };
assert.deepEqual(assertDisposableSpawn({ site: "draft-burst", args: hiddenReadOnly }), hiddenReadOnly, "compliant args pass through untouched");
assert.throws(() => assertDisposableSpawn({ site: "draft-burst", args: { ...hiddenReadOnly, visibility: "visible" } }), /must spawn hidden/, "visible disposables refuse");
assert.throws(() => assertDisposableSpawn({ site: "review", args: { ...hiddenReadOnly, permissionMode: "full" } }), /must not spawn with full permission/, "full permission refuses");
assert.throws(() => assertDisposableSpawn({ site: "draft-burst", args: null }), /needs a spawn args object/, "missing args refuse");
assert.throws(() => assertDisposableSpawn({ site: "worker-spawn", args: hiddenReadOnly }), /not disposable/, "direct sites never route through the disposable wrapper");
assert.throws(
  () => getDelegationSite("preset-judge"),
  /Register it in lib\/delegation-map\.mjs/,
  "the hidden preset-judge thread is gone: no delegation site",
);

console.log("delegation map test ok: registry and guardrails");
