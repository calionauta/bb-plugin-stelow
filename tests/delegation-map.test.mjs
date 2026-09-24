import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
assert.throws(() => assertDisposableSpawn({ site: "preset-judge", args: hiddenReadOnly }), /not disposable/, "preset judges keep their own retry/timeout path");

// Topology: every direct spawn carries a marker, every marker names a
// registered site, and disposable callers pass registered disposable ids.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = readFileSync(join(root, "server.ts"), "utf8");
const workerFiles = readdirSync(join(root, "server"))
  .filter((file) => /^workers.*\.ts$/.test(file))
  .sort();
const workerSource = workerFiles
  .map((file) => readFileSync(join(root, "server", file), "utf8"))
  .join("\n");
const server = `${serverRoot}\n${workerSource}`;
const directSpawns = [
  ...(serverRoot.match(/bb\.sdk\.threads\.spawn\(\{/g) ?? []),
  ...(workerSource.match(/bb\.sdk\.threads\.spawn\(/g) ?? []),
];
assert.doesNotMatch(serverRoot, /delegation-site: worker-spawn/, "server.ts cannot reintroduce a direct worker spawn");
assert.doesNotMatch(server, /workers\.spawn\(\{/, "the worker facade has no generic spawn escape hatch");
assert.equal((serverRoot.match(/bb\.sdk\.threads\.spawn\(\{/g) ?? []).length, 1, "only the preset judge remains in server.ts");
assert.equal((workerSource.match(/bb\.sdk\.threads\.spawn\(/g) ?? []).length, 1, "worker support modules own one SDK spawn implementation");
assert.equal((server.match(/bb\.sdk\.threads\.spawn\(/g) ?? []).length, 4, "two disposable-helper calls, one judge, and one worker implementation are pinned");
const markers = [...server.matchAll(/\/\/ delegation-site: (\S+)/g)].map((match) => match[1]);
assert.equal(markers.length, directSpawns.length, "every direct spawn carries exactly one site marker");
for (const site of markers) {
  assert.ok(getDelegationSite(site), `${site} is registered`);
}
const disposableCalls = [...server.matchAll(/spawnDisposable\(\{[\s\S]*?\}, "([a-z-]+)"\)/g)].map((match) => match[1]);
assert.ok(disposableCalls.length >= 2, "disposable callers name their site");
for (const site of disposableCalls) {
  assert.equal(getDelegationSite(site).spawn, "disposable", `${site} is a disposable site`);
}

console.log("delegation map test ok: registry, guardrails, spawn topology");
