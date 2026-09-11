import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePluginRoot } from "../lib/plugin-paths.mjs";

const packageManifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const postbuild = readFileSync(new URL("../scripts/postbuild.mjs", import.meta.url), "utf8");

// App images are served from dist/ at runtime and must also be in the npm
// package. Both contracts are explicit, so an About logo cannot silently 404.
assert.equal(existsSync(new URL("../assets/stelow-logo.png", import.meta.url)), true, "Stelow logo is tracked as a plugin asset");
assert.equal(packageManifest.files.includes("assets"), true, "plugin package includes assets");
assert.match(postbuild, /copyTree\(join\(pluginRoot, "assets"\), join\(dist, "assets"\)\);/, "postbuild copies assets into the runtime directory");

// Regression: managed installs run dist/server.js, so import.meta.url points
// at dist/ and every skills/* read 404s (ENOENT on transitions.md at card
// creation). The root must resolve to wherever transitions.md lives.
const root = mkdtempSync(join(tmpdir(), "stelow-paths-test-"));
try {
  const marker = ["skills", "stelow-workflow-orchestrator", "references", "transitions.md"];
  mkdirSync(join(root, "dist"), { recursive: true });
  mkdirSync(join(root, ...marker.slice(0, -1)), { recursive: true });
  writeFileSync(join(root, ...marker), "# transitions");

  // Source layout: entry dir already holds the marker.
  assert.equal(resolvePluginRoot(root), root, "source layout resolves to itself");
  // Bundled layout: dist/ falls back one level up.
  assert.equal(resolvePluginRoot(join(root, "dist")), root, "dist layout resolves to parent");
  // Unknown layout: fail-open to the entry dir (previous behavior).
  const empty = mkdtempSync(join(tmpdir(), "stelow-paths-empty-"));
  try {
    assert.equal(resolvePluginRoot(empty), empty, "unknown layout falls back to entry dir");
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
  // Degenerate input never throws.
  assert.equal(resolvePluginRoot(""), "", "empty dir passes through");

  console.log("plugin paths test ok: source, dist, and unknown layouts");
} finally {
  rmSync(root, { recursive: true, force: true });
}
