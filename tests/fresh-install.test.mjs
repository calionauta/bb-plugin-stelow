import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// Fresh-install contract: a brand-new user installs from the marketplace
// (git semver tag) and bb builds with `bb plugin build` only — postbuild
// never runs there. So every file the server reads from the source root
// must be (a) tracked in git, (b) carried by the package, and (c) present
// here. Anything else is a first-boot ENOENT for a lay user.
const root = new URL("../", import.meta.url);
const exists = (path) => existsSync(new URL(path, root));
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

// Entry points the marketplace build consumes.
assert.equal(exists("server.ts"), true, "server entry is tracked");
assert.equal(exists("app.tsx"), true, "app entry is tracked");
assert.deepEqual(manifest.bb.server, "./server.ts", "manifest server entry resolves");
assert.deepEqual(manifest.bb.app, "./app.tsx", "manifest app entry resolves");
for (const dir of manifest.bb.skills) {
  assert.equal(exists(dir), true, `manifest skills dir ${dir} is tracked`);
}

// Runtime reads from the unified plugin root (lib/plugin-paths.mjs):
// the transitions marker, the helper script, the upstream version, the
// strategy registry, and the About logo.
for (const file of [
  "skills/stelow-workflow-orchestrator/references/transitions.md",
  "data/stelow",
  "data/stelow-package.json",
  "data/product-strategies.json",
  "assets/stelow-logo.png",
]) {
  assert.equal(exists(file), true, `first-boot read ${file} is tracked`);
}

// The same set must survive packaging (git installs carry the tree;
// npm installs carry only `files`).
const packed = new Set(manifest.files);
const covered = (file) => [...packed].some((entry) => file === entry || file.startsWith(entry + "/"));
for (const file of ["server.ts", "app.tsx", "skills/", "data/", "assets/", "lib/", "components/", "hooks/"]) {
  assert.equal(covered(file), true, `first-boot read ${file} survives packaging`);
}

// Migrations must be fresh-safe and upgrade-safe: conditional creates plus
// guarded ALTERs only — never a bare CREATE TABLE that crashes reinstalls.
const server = readFileSync(new URL("server.ts", root), "utf8");
assert.doesNotMatch(server, /"CREATE TABLE (?!IF NOT EXISTS)/, "migrations never crash a fresh database");
assert.match(server, /CREATE TABLE IF NOT EXISTS cards/, "first boot creates the cards table");
assert.match(server, /CREATE TABLE IF NOT EXISTS presets/, "first boot creates the presets table");

// Sync safety: a truncated GitHub tree must refuse the whole sync instead
// of pruning valid local skills as "retired".
const syncLib = readFileSync(new URL("lib/workflow-skills-sync.mjs", root), "utf8");
assert.match(syncLib, /if \(data\.truncated\) throw/, "truncated upstream tree refuses the sync");

// Engine floors must stay satisfiable: the marketplace entry resolves only
// compatible tags, and managed installs validate these ranges.
assert.match(manifest.engines.bb, />=\d+\.\d+/, "bb engine floor is declared");
assert.match(manifest.engines.bbPluginSdk, />=\d+\.\d+/, "SDK engine floor is declared");

console.log("fresh install test ok: entries, first-boot reads, packaging, and migrations");
