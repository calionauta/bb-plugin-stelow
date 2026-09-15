import assert from "node:assert/strict";
import { parseArtifactManifest, resolveArtifactPath, unregisteredArtifactPaths } from "../lib/artifact-manifest.mjs";

const manifest = parseArtifactManifest(`---
name: workflow
artifacts:
  - stage: shape
    kind: document
    label: product spec
    path: .stelow/example/plans/spec-product_v1.md
  - stage: shape
    kind: document
    label: ui alternatives
    path: .stelow/example/interfaces/ui-alternatives.md
history: []
---`);

assert.deepEqual(manifest, [
  { stage: "shape", kind: "document", label: "product spec", path: ".stelow/example/plans/spec-product_v1.md" },
  { stage: "shape", kind: "document", label: "ui alternatives", path: ".stelow/example/interfaces/ui-alternatives.md" },
]);
assert.deepEqual(parseArtifactManifest("artifacts:\n  - stage: shape\n    path: .stelow/example/spec.md\n    generated_at: 2026-09-02T09:00:00Z\n"), [{ stage: "shape", path: ".stelow/example/spec.md" }], "timestamps are file metadata, not manifest data");
assert.deepEqual(parseArtifactManifest("artifacts:\n  shape: .stelow/example/spec.md\nhistory: []"), []);

assert.equal(resolveArtifactPath("/workspace/project", ".stelow/example/spec.md"), "/workspace/project/.stelow/example/spec.md");
assert.equal(resolveArtifactPath("/workspace/project", "/etc/passwd"), null, "absolute artifact paths are rejected");
assert.equal(resolveArtifactPath("/workspace/project", "../outside.md"), null, "parent traversal is rejected");
assert.equal(resolveArtifactPath("/workspace/project", ".stelow/../outside.md"), null, "embedded parent traversal is rejected");

// The audit trail must not depend on the agent remembering to register its
// own output: whatever the manifest missed is still listed.
const stateDirPaths = [
  "/w/.stelow/2026-09-15/sw-x/state.md",
  "/w/.stelow/2026-09-15/sw-x/state.md.bak.20260915",
  "/w/.stelow/2026-09-15/sw-x/audit.md",
  "/w/.stelow/2026-09-15/sw-x/plans/spec-tech_v1.md",
  "/w/.stelow/2026-09-15/sw-x/session.log",
  "/w/.stelow/2026-09-15/sw-x/invariants.json",
];
assert.deepEqual(unregisteredArtifactPaths(stateDirPaths, ["/w/.stelow/2026-09-15/sw-x/plans/spec-tech_v1.md"]), ["/w/.stelow/2026-09-15/sw-x/audit.md"], "an unregistered document is listed; the registered one is not repeated");
assert.deepEqual(unregisteredArtifactPaths(stateDirPaths, []), ["/w/.stelow/2026-09-15/sw-x/audit.md", "/w/.stelow/2026-09-15/sw-x/plans/spec-tech_v1.md"], "state.md, its backups, logs, and json bookkeeping are never artifacts");
assert.deepEqual(unregisteredArtifactPaths(["/w/a.md", "/w/a.md"], []), ["/w/a.md"], "duplicates collapse");
assert.deepEqual(unregisteredArtifactPaths(null, null), [], "off-shape input is an empty list, never a throw");

console.log("artifact-manifest test ok: typed manifests parsed and artifact paths stay inside the project");
