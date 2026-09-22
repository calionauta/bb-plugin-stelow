import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactRole, isReconReceiptArtifact, shouldAutoOpenEvidence, splitArtifactsByRole } from "../lib/artifact-roles.mjs";

// Machine receipts are evidence, never deliverables: the portable
// audit-trail.md and the recon-receipt.json stay in the bundle and the
// trailer, but must not inflate the file count or sit unlabeled. The
// host's audit.md stays a deliverable — it records acceptance criteria,
// tests, and checkout for humans.
assert.equal(artifactRole({ kind: "audit-trail", path: "x/audit-trail.md" }), "evidence", "audit-trail kind reads evidence");
assert.equal(artifactRole({ kind: "document", path: ".stelow/2026-01-01/abc/audit-trail.md" }), "evidence", "audit-trail basename reads evidence whatever the kind");
assert.equal(artifactRole({ kind: "document", path: ".stelow/2026-01-01/abc/context/recon-receipt.json" }), "evidence", "recon receipt reads evidence");
assert.equal(artifactRole({ kind: "document", path: "x/audit.md" }), "deliverable", "the host audit receipt stays a deliverable");
assert.equal(artifactRole({ kind: "document", path: "x\\context\\recon-receipt.json" }), "evidence", "windows separators read evidence too");
assert.equal(artifactRole({ kind: "document", path: "x/spec-tech_v1.md" }), "deliverable", "specs stay deliverables");
assert.equal(artifactRole({ kind: "unregistered", path: "x/notes.md" }), "deliverable", "unregistered strays stay visible as deliverables");
assert.equal(artifactRole(null), "deliverable", "junk never hides");
assert.equal(artifactRole({ kind: "document", path: null }), "deliverable", "missing path never hides");

// The recon receipt is debug context, never a file row: the card lists it
// as one line in the audit-trail status row instead of the Evidence group.
assert.equal(isReconReceiptArtifact({ path: ".stelow/2026-01-01/abc/context/recon-receipt.json" }), true, "recon receipt matches by basename");
assert.equal(isReconReceiptArtifact({ path: "x\\context\\recon-receipt.json" }), true, "windows separators match too");
assert.equal(isReconReceiptArtifact({ path: "x/audit-trail.md" }), false, "the audit trail is not the recon receipt");
assert.equal(isReconReceiptArtifact({ path: "x/spec-tech_v1.md" }), false, "deliverables are not the recon receipt");
assert.equal(isReconReceiptArtifact(null), false, "junk never matches");
assert.equal(isReconReceiptArtifact({ path: null }), false, "missing path never matches");

// The collapsed trail file list auto-opens only when the trail needs
// attention; verified trails (and unknown states) stay collapsed.
assert.equal(shouldAutoOpenEvidence("verified"), false, "verified stays collapsed");
assert.equal(shouldAutoOpenEvidence("changed"), true, "stale trails open");
assert.equal(shouldAutoOpenEvidence("missing"), true, "missing trails open");
assert.equal(shouldAutoOpenEvidence("unsupported"), true, "unreadable trails open");
assert.equal(shouldAutoOpenEvidence(null), false, "unknown stays collapsed");
assert.equal(shouldAutoOpenEvidence(undefined), false, "unknown stays collapsed");

const { deliverables, evidence } = splitArtifactsByRole([
  { kind: "document", path: "spec-tech_v1.md" },
  { kind: "audit-trail", path: "audit-trail.md" },
  { kind: "document", path: "audit.md" },
]);
assert.deepEqual(deliverables.map((entry) => entry.path), ["spec-tech_v1.md", "audit.md"], "deliverables keep order minus evidence");
assert.deepEqual(evidence.map((entry) => entry.path), ["audit-trail.md"], "evidence partitions out");
assert.deepEqual(splitArtifactsByRole(null), { deliverables: [], evidence: [] }, "junk partitions empty");

// Wiring pins (topology, not copy): the card detail stamps the role, the
// progress count excludes evidence, and the Artifacts section renders the
// evidence group apart from deliverables.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
assert.match(server, /artifactRole\(/, "card detail stamps the artifact role");
assert.match(server, /role: z\.enum\(\["deliverable", "evidence"\]\)/, "the card detail contract carries the role");
const app = readFileSync(join(root, "app.tsx"), "utf8");
assert.match(app, /\.filter\(\(artifact\) => artifact\.role !== "evidence"\)/, "the file count excludes evidence");
assert.match(app, /Evidence — machine receipts/, "the Artifacts section groups evidence apart");
assert.match(app, /isReconReceiptArtifact/, "the recon receipt is partitioned out of the file rows");
assert.match(app, /Open receipt/, "the recon receipt opens from a context line in the status row");
assert.match(app, /Audit trail file/, "the audit trail file sits collapsed until it needs attention");
assert.match(app, /ReconStatusLine/, "active cards surface degraded recon as an alarm-only line");
assert.match(app, /shouldAutoOpenEvidence/, "the collapsed trail auto-opens on policy, not render luck");

console.log("artifact roles test ok: receipt roles, partition, wiring");
