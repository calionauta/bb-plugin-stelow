import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactRole, splitArtifactsByRole } from "../lib/artifact-roles.mjs";

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

// Wiring pins (topology, not copy): the card detail stamps the role, the
// progress count excludes evidence, and the Artifacts section renders the
// evidence group apart from deliverables.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = readFileSync(join(root, "server/plugin-runtime.ts"), "utf8");
const contract = readFileSync(join(root, "server/card-detail-rpc-contract.ts"), "utf8");
assert.match(runtime, /artifactRole\(/, "card detail stamps the artifact role");
assert.match(contract, /role: z\.enum\(\["deliverable", "evidence"\]\)/, "the card detail contract carries the role");
const progress = readFileSync(join(root, "components/detail/build-detail-progress.tsx"), "utf8");
assert.match(progress, /\.filter\(\s*\(artifact\) => artifact\.role !== "evidence",/, "the file count excludes evidence");
assert.match(progress, /Evidence — machine receipts/, "the Artifacts section groups evidence apart");
assert.equal((progress.match(/<ArtifactGroups/g) ?? []).length, 2, "deliverables and evidence each mount one artifact group");

console.log("artifact roles test ok: receipt roles, partition, wiring");
