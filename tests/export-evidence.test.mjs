// Evidence integrity at export: a document the card registered must be findable in
// the committed bundle, as a copied file or as a named gap. Nothing may vanish.
//
// The failure this guards is quiet by construction. `context/triage-items.md` in the
// fixture is registered in `state.md`, present on disk, and readable — but the block
// that registered it carries no `stage:`, and the reader required one. The entry was
// dropped before the copy pass ran, so it was in neither the file table nor
// `## Missing`: `7 registered in state.md (2 copied)` read as complete while a
// document the ledger named was gone. Nobody could tell from the bundle, and the
// state file it lived in isn't committed with the run.
//
// So the check is an accounting, and the accounting is read BACK from the rendered
// manifest. A count computed from the same list that decided the copy is
// `plan == plan` — it stays green the day the render stops emitting a row.
import assert from "node:assert/strict";

import {
  EVIDENCE_FIXTURE,
  evidenceLost,
  evidenceReport,
  ledgerArtifactPaths,
  missingRows,
  simulateExport,
} from "../lib/export-evidence.mjs";
import { parseArtifactManifest } from "../lib/artifact-manifest.mjs";

const report = evidenceReport();

// The claim and the reader must agree. The second reader exists precisely so that a
// path the parser never returned cannot disappear from the comparison.
const ledgerPaths = ledgerArtifactPaths(EVIDENCE_FIXTURE.ledger);
assert.equal(ledgerPaths.length, 8, "the fixture ledger registers 8 artifacts");
assert.deepEqual(report.registered, ledgerPaths, "the reader sees every path the ledger records, in order");

// A registration needs a path, not a stage. `stage` is absent here because the block
// was appended by hand, and every consumer already renders an absent stage as "?".
const stageLess = parseArtifactManifest("artifacts:\n  - kind: document\n    path: context/triage-items.md\n");
assert.deepEqual(stageLess, [{ kind: "document", path: "context/triage-items.md" }], "a path-only registration is an artifact");
assert.deepEqual(parseArtifactManifest("artifacts:\n  - stage: shape\n    kind: document\n"), [], "a stage with no path is not");
assert.deepEqual(parseArtifactManifest("history:\n  - stage: setup\n    path: nope.md\n"), [], "history is not a manifest");

// Copied: root-relative, staging-relative (retried against the state dir), and the
// stage-less one, each under a stable bundle name with the SHA of its own content.
assert.deepEqual(report.copied.map((file) => file.name), ["spec-product.md", "spec-tech.md", "triage-items.md"]);
assert.deepEqual(report.copied.map((file) => file.stage), ["shape", "plan", null]);
for (const file of report.copied) {
  assert.match(file.sha8, /^[0-9a-f]{8}$/, `${file.name} carries a verifiable SHA-8`);
}
assert.ok(report.manifest.includes("| triage-items.md | ? |"), "the stage-less artifact renders as a row with an unknown stage");

// Unreadable at export: never written, written blank, copy failed, absolute, traversal.
// Each is named under `## Missing` rather than silently skipped.
assert.deepEqual(report.missing, [
  "plans/spec-critique.md",
  "plans/blank.md",
  "/etc/passwd",
  "../outside.md",
  "audits/verification.md",
]);
assert.deepEqual(missingRows(report.manifest), report.missing, "the missing list is what the manifest says it is");
// Both refusals are load-bearing: a manifest is agent-produced input and must not be
// able to name a file outside the workspace, and a refused path is still evidence.
assert.ok(!report.copied.some((file) => file.sourcePath.startsWith("/")), "an absolute path is never copied");

// The measurement itself: zero ledger registrations unaccounted for in the bundle.
assert.deepEqual(report.lost, [], "every registered artifact is copied or named missing");

// Unknown tokens are labelled unknown, never rendered as a figure. A card with no
// provider report is the common case, and `0 total` is a claim the host cannot make.
assert.ok(report.manifest.includes("Unknown — no token reports at export time."), "an absent token report is stated as unknown");
assert.doesNotMatch(report.manifest, /\b0 total\b/, "an absent token report is never rendered as a number");

// The accounting is not vacuous: render the same export with the `## Missing` section
// removed — the shape of the regression this file exists for — and every unreadable
// registration must come back as lost.
const withoutGaps = report.manifest.replace(/## Missing \(registered but unreadable at export\)[\s\S]*?## Trailer/, "## Trailer");
assert.equal(missingRows(withoutGaps).length, 0, "the fixture manifest really has no missing rows");
assert.deepEqual(
  evidenceLost(EVIDENCE_FIXTURE.ledger, withoutGaps).slice().sort(),
  report.missing.slice().sort(),
  "a bundle that drops the missing section is caught, not read as complete",
);
// And a render that keeps the section but loses a copied row fails on that row.
const withoutRow = report.manifest.replace(/\n\| triage-items\.md .*\n/, "\n");
assert.deepEqual(evidenceLost(EVIDENCE_FIXTURE.ledger, withoutRow), ["context/triage-items.md"], "a dropped copy row is caught");

// Off-shape input stays an empty accounting, never a throw: export runs on cards whose
// state file may be absent or hand-broken, and a crash there would hide the bundle.
assert.deepEqual(evidenceLost(null, null), [], "off-shape ledger and manifest account for nothing");
assert.deepEqual(evidenceLost("", ""), [], "an empty ledger registers nothing to lose");
assert.deepEqual(simulateExport({ ...EVIDENCE_FIXTURE, ledger: "", files: {} }).registered, [], "an empty ledger exports none");

console.log(
  `export evidence test ok: ${ledgerPaths.length} registrations accounted for, `
    + `${report.copied.length} copied, ${report.missing.length} named missing`,
);
