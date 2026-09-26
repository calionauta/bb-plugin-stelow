import assert from "node:assert/strict";
import {
  buildArtifactTrailer,
  isDeliverableArtifactPath,
  isPublishableArtifactContent,
  parseArtifactManifest,
  renderBundleManifest,
  resolveArtifactPath,
  unregisteredArtifactPaths,
} from "../lib/artifact-manifest.mjs";

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
assert.equal(isPublishableArtifactContent("# Ready\n"), true, "non-empty Markdown is publishable");
assert.equal(isPublishableArtifactContent("  \n\t "), false, "whitespace-only placeholders are not publishable");
assert.equal(isPublishableArtifactContent(null), false, "missing content is not publishable");

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
assert.deepEqual(unregisteredArtifactPaths(["/w/.stelow/x/drafts/draft-1.md"], []), [], "disposable drafts never surface as unregistered");

// The same bar, named: the board read filters its own listing with this, so
// the two surfaces cannot drift into disagreeing about what a document is.
for (const [path, deliverable] of [
  ["audit.md", true],
  ["plans/spec-product_v1.md", true],
  ["explore/card_z9r4k/spec-product.md", true],
  ["reviews/review-2026-09-26T09-40-00Z.md", true],
  ["state.md", false],
  ["state.md.bak", false],
  ["context/state.md", false],
  ["drafts/draft-1.md", false],
  ["plans/nested/drafts/draft-2.md", false],
  ["plans\\spec-tech_v1.md", true],
  ["context/recon-receipt.json", false],
  ["session.log", false],
  ["", false],
]) {
  assert.equal(isDeliverableArtifactPath(path), deliverable, `isDeliverableArtifactPath(${JSON.stringify(path)})`);
}
assert.equal(isDeliverableArtifactPath(null), false, "off-shape input is not a deliverable path");
assert.deepEqual(
  stateDirPaths.filter(isDeliverableArtifactPath),
  ["/w/.stelow/2026-09-15/sw-x/audit.md", "/w/.stelow/2026-09-15/sw-x/plans/spec-tech_v1.md"],
  "the named bar and the sweep accept exactly the same files in a real state dir listing",
);

// Commit trailer: the audit link between a commit and the run that produced it.
assert.deepEqual(
  buildArtifactTrailer("card-1", [{ stage: "shape", path: ".stelow/x/spec.md" }, { stage: null, path: "" }], { fixed: 1, documented: 2, escalated: 0 }),
  ["Stelow-Card: card-1", "Stelow-Artifacts: 1", "Stelow-Artifact: [shape] .stelow/x/spec.md", "Stelow-Gaps: 1 fixed / 2 documented / 0 escalated"],
  "blank paths dropped, gap line appended",
);
assert.deepEqual(
  buildArtifactTrailer("card-2", [], null),
  ["Stelow-Card: card-2", "Stelow-Artifacts: 0"],
  "empty run still names the card with a zero count",
);

// Run bundle manifest: stable names, SHA pins, missing listed, trailer embedded.
const bundle = renderBundleManifest({
  cardId: "card-1",
  cardName: "Login",
  stage: "audit",
  generatedAt: "2026-09-19T00:00:00.000Z",
  files: [{ name: "audit.md", stage: "audit", sha8: "abc12345", sourcePath: ".stelow/x/audit.md" }],
  missing: [".stelow/x/gone.md"],
  gapTotals: { fixed: 1, documented: 0, escalated: 2 },
});
assert.ok(bundle.includes("| audit.md | audit | `abc12345` | .stelow/x/audit.md |"), "file row pins name, stage, SHA, source");
assert.ok(bundle.includes("- .stelow/x/gone.md"), "missing entries listed, never hidden");
assert.ok(bundle.includes("1 fixed / 0 documented / 2 escalated"), "gap counts rendered");
assert.ok(bundle.includes("Stelow-Card: card-1"), "trailer embedded for pasting");

// Token evidence is optional and honest: omitted entirely reads unknown,
// never zero; reported legs render exact locale numbers for the audit.
const withTokens = renderBundleManifest({
  cardId: "card-1", cardName: "Login", stage: "audit", generatedAt: "2026-09-19T00:00:00.000Z",
  files: [], missing: [], gapTotals: null,
  tokens: { input: 80000, output: 20000, cached: null, reasoning: 5000, total: 105000 },
});
assert.ok(withTokens.includes("## Tokens"), "token evidence gets its own section");
assert.ok(withTokens.includes("105,000 total"), "totals render exact, never compacted");
assert.ok(withTokens.includes("input 80,000"), "reported legs render");
assert.ok(!withTokens.includes("cached"), "unreported legs never render as zero");
const withoutTokens = renderBundleManifest({
  cardId: "card-1", cardName: "Login", stage: "audit", generatedAt: "2026-09-19T00:00:00.000Z",
  files: [], missing: [], gapTotals: null,
});
assert.ok(withoutTokens.includes("Unknown — no provider token reports at export time."), "missing evidence reads unknown");

console.log("artifact-manifest test ok: typed manifests parsed and artifact paths stay inside the project");
