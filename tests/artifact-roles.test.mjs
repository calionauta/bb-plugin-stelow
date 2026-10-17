import assert from "node:assert/strict";
import { artifactRole, splitArtifactsByRole, artifactRoleCounts } from "../lib/artifact-roles.mjs";

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

const { deliverables, evidence } = splitArtifactsByRole([
  { kind: "document", path: "spec-tech_v1.md" },
  { kind: "audit-trail", path: "audit-trail.md" },
  { kind: "document", path: "audit.md" },
]);
assert.deepEqual(deliverables.map((entry) => entry.path), ["spec-tech_v1.md", "audit.md"], "deliverables keep order minus evidence");
assert.deepEqual(evidence.map((entry) => entry.path), ["audit-trail.md"], "evidence partitions out");
assert.deepEqual(splitArtifactsByRole(null), { deliverables: [], evidence: [] }, "junk partitions empty");

// The number a card section states to the reader. This is the only place
// "how many files did this card produce" becomes a claim, and it is the claim
// Explore got wrong: it counted everything it received, so a card with two
// deliverables and one receipt said "3 files".
const mixed = [
  { kind: "document", path: "spec-tech_v1.md" },
  { kind: "audit-trail", path: "audit-trail.md" },
  { kind: "document", path: "audit.md" },
  { kind: "document", path: "context/recon-receipt.json" },
];
assert.deepEqual(artifactRoleCounts(mixed), { deliverables: 2, evidence: 2 }, "a receipt is never counted as a produced file");
assert.deepEqual(artifactRoleCounts([]), { deliverables: 0, evidence: 0 }, "no artifacts means no claim");
assert.deepEqual(artifactRoleCounts(null), { deliverables: 0, evidence: 0 }, "junk counts zero rather than throwing");
assert.deepEqual(
  artifactRoleCounts([{ kind: "document", path: "a.md" }]),
  { deliverables: 1, evidence: 0 },
  "a deliverables-only list still counts",
);
assert.equal(
  mixed.length,
  artifactRoleCounts(mixed).deliverables + artifactRoleCounts(mixed).evidence,
  "the counts account for every artifact received, so none is silently dropped",
);

console.log("artifact roles test ok: receipt roles, partition, counts");
