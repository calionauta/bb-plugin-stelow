import assert from "node:assert/strict";
import { parseArtifactManifest } from "../lib/artifact-manifest.mjs";

const manifest = parseArtifactManifest(`---
name: workflow
artifacts:
  - stage: shape
    kind: document
    label: product spec
    path: .stelow/example/plans/spec-product_v1.md
    generated_at: 2026-09-02T09:00:00Z
  - stage: shape
    kind: document
    label: ui alternatives
    path: .stelow/example/interfaces/ui-alternatives.md
    generated_at: 2026-09-02T09:01:00Z
history: []
---`);

assert.deepEqual(manifest, [
  { stage: "shape", kind: "document", label: "product spec", path: ".stelow/example/plans/spec-product_v1.md", generated_at: "2026-09-02T09:00:00Z" },
  { stage: "shape", kind: "document", label: "ui alternatives", path: ".stelow/example/interfaces/ui-alternatives.md", generated_at: "2026-09-02T09:01:00Z" },
]);
assert.deepEqual(parseArtifactManifest("artifacts:\n  shape: .stelow/example/spec.md\nhistory: []"), []);

console.log("artifact-manifest test ok: typed multi-artifact manifest parsed; legacy map rejected");
