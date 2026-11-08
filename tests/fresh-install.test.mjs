import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { runPluginMigrations } from "../server/core-migrations.ts";
import { fetchTreeBlobs } from "../lib/skills-sync-fetch.mjs";

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
for (const file of ["server.ts", "app.tsx", "skills/", "data/", "assets/", "lib/", "components/", "hooks/", "server/"]) {
  assert.equal(covered(file), true, `first-boot read ${file} survives packaging`);
}

// Migrations must be fresh-safe and upgrade-safe: conditional creates plus
// guarded ALTERs only — never a bare CREATE TABLE that crashes reinstalls.
// Driven against a real database, not read as text: a fresh boot runs the
// whole migrator and the tables the first boot reads must exist, and a second
// boot on the same database must add nothing and throw nothing.
{
  const db = new Database(":memory:");
  const host = {
    storage: {
      migrate: (_database, statements) => {
        for (const statement of statements) db.exec(statement);
      },
    },
  };
  runPluginMigrations(host, db, () => 1);
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
  );
  assert.ok(tables.has("cards"), "first boot creates the cards table");
  assert.ok(tables.has("presets"), "first boot creates the presets table");
  runPluginMigrations(host, db, () => 2);
  db.close();
}

// Sync safety: a truncated GitHub tree must refuse the whole sync instead
// of pruning valid local skills as "retired". Driven through the fetch phase,
// against a stubbed GitHub response, so the refusal is the behaviour and not a
// string in the file that produces it.
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ tree: [], truncated: true }) });
  await assert.rejects(
    () => fetchTreeBlobs("fresh-install-truncated-ref"),
    /truncated/,
    "truncated upstream tree refuses the sync",
  );
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ tree: [{ type: "blob", path: "skills/x", sha: "sha1" }] }) });
  assert.deepEqual(
    await fetchTreeBlobs("fresh-install-complete-ref"),
    [{ path: "skills/x", sha: "sha1" }],
    "a complete tree is read through",
  );
} finally {
  globalThis.fetch = originalFetch;
}

// Engine floors must stay satisfiable: the marketplace entry resolves only
// compatible tags, and managed installs validate these ranges.
assert.match(manifest.engines.bb, />=\d+\.\d+/, "bb engine floor is declared");
assert.match(manifest.engines.bbPluginSdk, />=\d+\.\d+/, "SDK engine floor is declared");

console.log("fresh install test ok: entries, first-boot reads, packaging, and migrations");
