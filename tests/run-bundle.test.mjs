import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assignBundleNames, parseBundleManifest, staleBundleEntries, unbundledSources } from "../lib/run-bundle.mjs";
import { renderBundleManifest } from "../lib/artifact-manifest.mjs";

// Filename assignment: stable basenames, stage prefix on collision, numeric
// suffix when even that collides — a repeated basename must never silently
// overwrite its sibling in the bundle.
assert.deepEqual(
  assignBundleNames([{ stage: "shape", path: "spec-product.md" }, { stage: "plan", path: "spec-tech.md" }]),
  [
    { name: "spec-product.md", stage: "shape", sourcePath: "spec-product.md" },
    { name: "spec-tech.md", stage: "plan", sourcePath: "spec-tech.md" },
  ],
  "distinct basenames keep their names",
);
assert.deepEqual(
  assignBundleNames([{ stage: "shape", path: "a/notes.md" }, { stage: "plan", path: "b/notes.md" }]).map((entry) => entry.name),
  ["notes.md", "plan-notes.md"],
  "a repeated basename gets a stage prefix, not an overwrite",
);
assert.deepEqual(
  assignBundleNames([
    { stage: "plan", path: "a/notes.md" },
    { stage: "plan", path: "b/notes.md" },
    { stage: "plan", path: "c/notes.md" },
  ]).map((entry) => entry.name),
  ["notes.md", "plan-notes.md", "plan-notes.md-2"],
  "a triple collision still yields unique names",
);
assert.deepEqual(
  assignBundleNames([null, "x", 42, {}, { stage: "s" }, { path: "" }, { path: "ok.md" }]),
  [{ name: "ok.md", stage: null, sourcePath: "ok.md" }],
  "junk registrations are skipped, never bundled",
);
assert.deepEqual(
  assignBundleNames([{ stage: "s", path: "dir\\win.md" }]),
  [{ name: "win.md", stage: "s", sourcePath: "dir\\win.md" }],
  "windows separators split the basename but the source path is preserved",
);

// Manifest round-trip: what renderBundleManifest writes, parseBundleManifest
// reads back — --check compares against exactly this shape.
const rendered = renderBundleManifest({
  cardId: "card1",
  cardName: "Card One",
  stage: "audit",
  generatedAt: "2026-09-19T00:00:00.000Z",
  files: [
    { name: "spec-product.md", stage: "shape", sha8: "a1b2c3d4", sourcePath: "spec-product.md" },
    { name: "plan-notes.md", stage: "plan", sha8: "e5f6a7b8", sourcePath: "b/notes.md" },
  ],
  missing: ["gone.md"],
  gapTotals: null,
});
assert.deepEqual(
  parseBundleManifest(rendered),
  [
    { name: "spec-product.md", stage: "shape", sha8: "a1b2c3d4", sourcePath: "spec-product.md" },
    { name: "plan-notes.md", stage: "plan", sha8: "e5f6a7b8", sourcePath: "b/notes.md" },
  ],
  "rendered manifest rows parse back exactly",
);
assert.deepEqual(parseBundleManifest(""), [], "empty content parses to nothing bundled");
assert.deepEqual(parseBundleManifest("# Notes\n| a | b |\n"), [], "foreign markdown never parses as bundle rows");

// Staleness: same SHA is fresh; changed, unreadable, and unknown SHAs are
// stale with a reason that names the fix.
const manifestEntries = [
  { name: "a.md", stage: "shape", sha8: "a1b2c3d4", sourcePath: "a.md" },
  { name: "b.md", stage: "plan", sha8: "e5f6a7b8", sourcePath: "b.md" },
];
assert.deepEqual(
  staleBundleEntries(manifestEntries, { "a.md": "a1b2c3d4", "b.md": "e5f6a7b8" }),
  [],
  "matching SHAs are fresh",
);
assert.deepEqual(
  staleBundleEntries(manifestEntries, new Map([["a.md", "a1b2c3d4"], ["b.md", "ffffffff"]])),
  [{ name: "b.md", stage: "plan", sha8: "e5f6a7b8", sourcePath: "b.md", reason: "changed" }],
  "a changed source is stale with reason changed (Maps work too)",
);
assert.deepEqual(
  staleBundleEntries(manifestEntries, { "a.md": "a1b2c3d4", "b.md": null }),
  [{ name: "b.md", stage: "plan", sha8: "e5f6a7b8", sourcePath: "b.md", reason: "missing" }],
  "an unreadable source is stale with reason missing",
);
assert.deepEqual(
  staleBundleEntries([{ name: "c.md", stage: "s", sha8: "????????", sourcePath: "c.md" }], { "c.md": "12345678" }),
  [{ name: "c.md", stage: "s", sha8: "????????", sourcePath: "c.md", reason: "changed" }],
  "an unknown bundled SHA can never compare fresh",
);

// New sources: registered after the last export reads as drift, bundled
// sources do not.
assert.deepEqual(
  unbundledSources([{ path: "a.md" }, { path: "fresh.md" }], manifestEntries),
  ["fresh.md"],
  "a registered source with no manifest row is drift",
);
assert.deepEqual(unbundledSources([{ path: "a.md" }], manifestEntries), [], "fully bundled sources report no drift");
assert.deepEqual(unbundledSources(null, null), [], "empty inputs report no drift");

console.log("run bundle test ok: stable names, manifest round-trip, changed/missing/new drift");

// Wiring: every done path refreshes the bundle before completing, export
// failures refuse with a retry, and --check exists for drift between dones.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server/plugin-runtime.ts"), "utf8");
assert.equal(
  (server.match(/await exportRunBundle\(card, \{\}\)/g) ?? []).length,
  3,
  "build, research, and explore done each refresh the bundle before completing",
);
assert.match(server, /run-bundle export failed \(.*\) — retry done\./, "a failed bundle refresh refuses done with its retry");
assert.match(server, /Run bundle refreshed at \$\{bundle\.dir\}/, "completion output names the refreshed bundle dir");
assert.match(server, /paste below the commit subject:`?, \.\.\.bundle\.trailer/, "completion output carries the paste-ready trailer");
assert.match(server, /stelow export \[--json\] \[--check\] \[--card <card_id>\]/, "export usage advertises --check");
assert.match(server, /`bb stelow export --check` reports changed/, "the done protocol teaches drift-checking between completions");
assert.match(server, /\["status", "--porcelain", "--", targetRel\]/, "commit-awareness is a read-only git status on the bundle dir");
assert.match(server, /differs from HEAD — commit it with the work/, "an uncommitted bundle names its fix");
assert.match(server, /No registered artifacts — nothing to bundle\./, "an empty registration skips the write instead of committing noise");
assert.match(server, /committed: bundle\.committed/, "--check JSON carries the commit dimension alongside freshness");

console.log("run bundle wiring test ok: done refreshes on all tracks, failure refuses, --check advertised");
